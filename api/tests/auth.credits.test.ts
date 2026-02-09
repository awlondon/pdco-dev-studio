import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCreditDeduction } from '../../utils/userDb.js';

type QueryCall = { text: string; params?: unknown[] };

function createMockPool({
  startingBalance = 100,
  monthlyQuota = 500,
  existingLedger = null as null | { balance_after: number }
} = {}) {
  const calls: QueryCall[] = [];
  let balance = startingBalance;

  const client = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      if (text.startsWith('SELECT balance_after')) {
        return { rows: existingLedger ? [existingLedger] : [] };
      }
      if (text.startsWith('SELECT balance, monthly_quota')) {
        return { rows: [{ balance, monthly_quota: monthlyQuota }] };
      }
      if (text.startsWith('UPDATE credits SET balance')) {
        balance = Number(params?.[0] ?? balance);
        return { rows: [{ balance }] };
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
