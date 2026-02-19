import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findOrCreateUser } from '../../utils/userDb.js';

type QueryCall = { text: string; params?: unknown[] };

function createMockPoolForUniqueRace() {
  const calls: QueryCall[] = [];
  let inRetryTransaction = false;

  const userRow = {
    id: 'user-race-1',
    email: 'race@example.com',
    display_name: 'Race User',
    created_at: new Date('2024-01-01T00:00:00Z'),
    last_seen_at: new Date('2024-01-01T00:00:00Z'),
    auth_providers: [{ provider: 'google', provider_user_id: 'google-123' }],
    preferences: {},
    is_internal: false,
    plan_override: null,
    deleted_at: null,
    plan_tier: 'free',
    effective_plan_tier: 'free',
    stripe_customer_id: '',
    stripe_subscription_id: '',
    billing_status: 'active',
    current_period_start: new Date('2024-01-01T00:00:00Z'),
    current_period_end: new Date('2024-02-01T00:00:00Z'),
    monthly_quota: 200,
    balance: 200,
    daily_cap: 25,
    daily_used: 0,
    last_daily_reset_at: new Date('2024-01-01T00:00:00Z'),
    last_monthly_reset_at: new Date('2024-01-01T00:00:00Z')
  };

  const client = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });

      if (text === 'BEGIN') {
        return { rows: [] };
      }
      if (text === 'ROLLBACK') {
        inRetryTransaction = true;
        return { rows: [] };
      }
      if (text === 'COMMIT') {
        return { rows: [] };
      }
      if (text.startsWith('SELECT pg_advisory_xact_lock')) {
        return { rows: [] };
      }

      if (text.includes('FROM users u') && text.includes('LIMIT 1')) {
        return { rows: inRetryTransaction ? [userRow] : [] };
      }

      if (text.startsWith('INSERT INTO users')) {
        const err = new Error('duplicate key value violates unique constraint "users_email_key"') as Error & { code?: string };
        err.code = '23505';
        throw err;
      }

      if (text.startsWith('INSERT INTO billing')) {
        return { rows: [] };
      }

      if (text.startsWith('INSERT INTO credits')) {
        return { rows: [] };
      }

      if (text.includes('FROM users u') && text.includes('WHERE u.id = $1')) {
        return { rows: [userRow] };
      }

      return { rows: [] };
    },
    release() {}
  };

  return {
    pool: {
      async connect() {
        return client;
      }
    },
    calls
  };
}

test('findOrCreateUser retries safely on unique violations and returns existing user', async () => {
  const mock = createMockPoolForUniqueRace();

  const user = await findOrCreateUser({
    email: 'race@example.com',
    provider: 'google',
    providerUserId: 'google-123',
    displayName: 'Race User',
    planTier: 'free',
    monthlyCredits: 200,
    dailyCap: 25,
    pool: mock.pool as unknown as { connect: () => Promise<unknown> }
  });

  assert.equal(user.email, 'race@example.com');
  assert.equal(user.auth_provider, 'google');

  const statements = mock.calls.map((call) => call.text);
  assert.ok(statements.some((text) => text.startsWith('SELECT pg_advisory_xact_lock')));
  assert.ok(statements.filter((text) => text === 'BEGIN').length >= 2);
  assert.ok(statements.includes('ROLLBACK'));
  assert.ok(statements.includes('COMMIT'));
});
