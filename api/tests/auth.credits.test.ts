import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCreditDeduction, resetUserCreditsIfNeeded } from '../../utils/userDb.js';

type QueryCall = { text: string; params?: unknown[] };

function createMockPool({
  startingBalance = 100,
  monthlyQuota = 500,
  dailyUsed = 0,
  lastDailyResetAt = new Date(),
  lastMonthlyResetAt = new Date(),
  planTier = 'free',
  existingLedger = null as null | { balance_after: number }
} = {}) {
  const calls: QueryCall[] = [];
  let balance = startingBalance;
  let currentDailyUsed = dailyUsed;
  let lastDaily = lastDailyResetAt;
  let lastMonthly = lastMonthlyResetAt;

  const client = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      if (text.startsWith('SELECT balance_after')) {
        return { rows: existingLedger ? [existingLedger] : [] };
      }
      if (text.startsWith('SELECT') && text.includes('FROM credits c')) {
        return {
          rows: [{
            balance,
            monthly_quota: monthlyQuota,
            daily_used: currentDailyUsed,
            last_daily_reset_at: lastDaily,
            last_monthly_reset_at: lastMonthly,
            plan_tier: planTier
          }]
        };
      }
      if (text.startsWith('UPDATE credits')) {
        balance = Number(params?.[0] ?? balance);
        currentDailyUsed = Number(params?.[1] ?? currentDailyUsed);
        lastDaily = (params?.[2] as Date) ?? lastDaily;
        lastMonthly = (params?.[3] as Date) ?? lastMonthly;
        return { rows: [{ balance }] };
      }
      if (text.startsWith('UPDATE billing')) {
        return { rows: [] };
      }
      if (text.includes('FROM users u')) {
        return {
          rows: [{
            id: 'user-1',
            email: 'test@example.com',
            display_name: 'Test User',
            created_at: new Date('2024-01-01T00:00:00Z'),
            last_seen_at: new Date('2024-01-01T00:00:00Z'),
            auth_providers: [],
            plan_tier: planTier,
            stripe_customer_id: '',
            stripe_subscription_id: '',
            billing_status: 'active',
            current_period_start: new Date('2024-01-01T00:00:00Z'),
            current_period_end: new Date('2024-02-01T00:00:00Z'),
            monthly_quota: monthlyQuota,
            balance,
            daily_cap: 100,
            daily_used: currentDailyUsed,
            last_daily_reset_at: lastDaily,
            last_monthly_reset_at: lastMonthly
          }]
        };
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
    calls,
    getBalance() {
      return balance;
    },
    getDailyUsed() {
      return currentDailyUsed;
    }
  };
}

test('applyCreditDeduction updates balance in a transaction', async () => {
  const mock = createMockPool();
  const result = await applyCreditDeduction({
    userId: 'user-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    creditsToCharge: 10,
    creditsTotal: 500,
    metadata: 'model:gpt-4',
    pool: mock.pool as unknown as { connect: () => Promise<unknown> }
  });

  assert.equal(result.nextBalance, 90);
  assert.equal(mock.getBalance(), 90);
  assert.equal(mock.getDailyUsed(), 10);

  const statements = mock.calls.map((call) => call.text);
  assert.ok(statements[0]?.startsWith('BEGIN'));
  assert.ok(statements.some((text) => text.includes('FOR UPDATE')));
  assert.ok(statements.some((text) => text.startsWith('INSERT INTO credit_ledger')));
  assert.ok(statements[statements.length - 1]?.startsWith('COMMIT'));
});

test('applyCreditDeduction is idempotent when a ledger entry exists', async () => {
  const mock = createMockPool({
    startingBalance: 120,
    existingLedger: { balance_after: 80 }
  });

  const result = await applyCreditDeduction({
    userId: 'user-2',
    sessionId: 'session-2',
    turnId: 'turn-2',
    creditsToCharge: 10,
    creditsTotal: 500,
    metadata: 'model:gpt-4',
    pool: mock.pool as unknown as { connect: () => Promise<unknown> }
  });

  assert.equal(result.nextBalance, 80);
  assert.equal(mock.getBalance(), 80);

  const statements = mock.calls.map((call) => call.text);
  assert.ok(statements.some((text) => text.startsWith('SELECT balance_after')));
  assert.ok(!statements.some((text) => text.startsWith('INSERT INTO credit_ledger')));
});

test('resetUserCreditsIfNeeded resets daily and monthly credits for free users', async () => {
  const now = new Date('2024-02-01T00:00:00Z');
  const mock = createMockPool({
    startingBalance: 25,
    monthlyQuota: 500,
    dailyUsed: 40,
    lastDailyResetAt: new Date('2024-01-30T00:00:00Z'),
    lastMonthlyResetAt: new Date('2023-12-15T00:00:00Z'),
    planTier: 'free'
  });

  const result = await resetUserCreditsIfNeeded({
    userId: 'user-3',
    now,
    pool: mock.pool as unknown as { connect: () => Promise<unknown> }
  });

  assert.equal(Number(result.user?.credits_remaining ?? 0), 500);
  assert.equal(result.daily_used, 0);
  assert.equal(mock.getBalance(), 500);
  assert.equal(mock.getDailyUsed(), 0);
});
