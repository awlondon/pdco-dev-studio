import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const csvPath = process.argv[2] || path.join(__dirname, '..', 'data', 'users.csv');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to import users.');
  process.exit(1);
}

function parseCSV(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed.split('\n');
  const headers = lines.shift().split(',');
  return lines.map((line) => {
    const values = line.split(',');
    const entry = {};
    headers.forEach((header, index) => {
      entry[header] = values[index] ?? '';
    });
    return entry;
  });
}

function toNullable(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

async function main() {
  const text = await fs.readFile(csvPath, 'utf8');
  const rows = parseCSV(text);
  if (!rows.length) {
    console.log('No users found to import.');
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    for (const row of rows) {
      const userId = row.user_id;
      const email = row.email?.toLowerCase() || '';
      const displayName = row.display_name || email.split('@')[0] || 'User';
      const createdAt = toNullable(row.created_at) || new Date().toISOString();
      const lastSeenAt = toNullable(row.last_login_at) || createdAt;

      const authProviders = row.auth_provider
        ? [{ provider: row.auth_provider, provider_user_id: row.provider_user_id || '' }]
        : [];

      await client.query(
        `INSERT INTO users (id, email, display_name, created_at, last_seen_at, auth_providers)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           display_name = EXCLUDED.display_name,
           last_seen_at = EXCLUDED.last_seen_at,
           auth_providers = EXCLUDED.auth_providers`,
        [
          userId,
          email,
          displayName,
          createdAt,
          lastSeenAt,
          JSON.stringify(authProviders)
        ]
      );

      await client.query(
        `INSERT INTO billing
          (user_id, plan_tier, stripe_customer_id, stripe_subscription_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id) DO UPDATE SET
           plan_tier = EXCLUDED.plan_tier,
           stripe_customer_id = EXCLUDED.stripe_customer_id,
           stripe_subscription_id = EXCLUDED.stripe_subscription_id,
           status = EXCLUDED.status,
           current_period_start = EXCLUDED.current_period_start,
           current_period_end = EXCLUDED.current_period_end`,
        [
          userId,
          row.plan_tier || 'free',
          row.stripe_customer_id || '',
          row.stripe_subscription_id || '',
          row.billing_status || 'active',
          toNullable(row.credits_last_reset) || createdAt,
          toNullable(row.monthly_reset_at) || null
        ]
      );

      const creditsTotal = Number(row.credits_total || 0) || 0;
      const creditsBalance = Number(row.credits_balance || row.credits_remaining || 0) || 0;
      const dailyCap = row.daily_credit_limit ? Number(row.daily_credit_limit) : null;

      await client.query(
        `INSERT INTO credits
          (user_id, monthly_quota, balance, daily_cap, daily_used, last_daily_reset_at, last_monthly_reset_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id) DO UPDATE SET
           monthly_quota = EXCLUDED.monthly_quota,
           balance = EXCLUDED.balance,
           daily_cap = EXCLUDED.daily_cap,
           last_daily_reset_at = EXCLUDED.last_daily_reset_at,
           last_monthly_reset_at = EXCLUDED.last_monthly_reset_at`,
        [
          userId,
          creditsTotal,
          creditsBalance,
          dailyCap,
          0,
          toNullable(row.credits_last_reset) || createdAt,
          toNullable(row.credits_last_reset) || createdAt
        ]
      );
    }
    await client.query('COMMIT');
    console.log(`Imported ${rows.length} users from ${csvPath}.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Import failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
