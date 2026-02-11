import { Pool } from 'pg';

let pool = null;

export function getDbPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }
  if (!pool) {
    pool = new Pool({ connectionString });
  }
  return pool;
}

export function requireDbPool() {
  const dbPool = getDbPool();
  if (!dbPool) {
    throw new Error('DATABASE_URL is required for database access.');
  }
  return dbPool;
}

export async function withTransaction(work) {
  const dbPool = requireDbPool();
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
