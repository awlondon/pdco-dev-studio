import { getDbPool } from '../utils/queryLayer.js';

export const USER_STORE_DRIVERS = {
  POSTGRES: 'postgres',
  CSV: 'csv'
};

export function resolveUserStoreDriver(env = process.env) {
  const raw = String(env.USER_STORE_DRIVER || '').trim().toLowerCase();
  if (raw === USER_STORE_DRIVERS.CSV) {
    return USER_STORE_DRIVERS.CSV;
  }
  return USER_STORE_DRIVERS.POSTGRES;
}

export function isCsvUserStoreDriver(env = process.env) {
  return resolveUserStoreDriver(env) === USER_STORE_DRIVERS.CSV;
}

export function isPostgresUserStoreDriver(env = process.env) {
  return resolveUserStoreDriver(env) === USER_STORE_DRIVERS.POSTGRES;
}

export function requirePostgresPool() {
  const pool = getDbPool();
  if (!pool) {
    throw new Error('DATABASE_URL is required when USER_STORE_DRIVER=postgres.');
  }
  return pool;
}
