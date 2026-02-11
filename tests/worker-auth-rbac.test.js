import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { __test } from '../worker.js';

class MemoryKv {
  constructor() { this.map = new Map(); }
  async get(key, opts = {}) {
    const value = this.map.get(key);
    if (value == null) return null;
    if (opts.type === 'json') return JSON.parse(value);
    return value;
  }
  async put(key, value) {
    this.map.set(key, String(value));
  }
  async delete(key) {
    this.map.delete(key);
  }
}

function encodeBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

function makeEnv() {
  return {
    ENVIRONMENT: 'development',
    SESSION_SECRET: 'test-secret',
    AUTH_KV: new MemoryKv(),
    GITHUB_TOKEN: 't',
    GITHUB_REPO: 'owner/repo',
    LEGACY_USERS_CSV: 'true'
  };
}

function installUsageFetchMock() {
  const usageCsv = [
    'timestamp_utc,user_id,status,credits_charged,latency_ms,intent_type',
    '2026-01-01T00:00:00.000Z,email:user@example.com,success,1,100,chat',
    '2026-01-01T00:00:00.000Z,email:admin@example.com,success,2,120,chat'
  ].join('\n');

  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ content: encodeBase64(usageCsv) }), { status: 200 });
  return () => {
    global.fetch = originalFetch;
  };
}

async function createSessionCookie(env, email) {
  const token = `token-${email}`;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hashHex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.AUTH_KV.put(`magic:${hashHex}`, JSON.stringify({ email, created: Date.now() }));

  const res = await worker.fetch(new Request('https://example.com/auth/magic/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token })
  }), env, { waitUntil() {} });

  return res.headers.get('set-cookie')?.split(';')[0];
}

test('non-admin cannot access admin analytics scope', async () => {
  const env = makeEnv();
  const cleanup = installUsageFetchMock();
  const cookie = await createSessionCookie(env, 'user@example.com');

  const res = await worker.fetch(new Request('https://example.com/usage/analytics?scope=admin', {
    headers: { cookie }
  }), env, { waitUntil() {} });

  cleanup();
  assert.equal(res.status, 403);
});

test('user cannot access another user analytics in user scope', async () => {
  const env = makeEnv();
  const cleanup = installUsageFetchMock();
  const cookie = await createSessionCookie(env, 'user@example.com');

  const res = await worker.fetch(new Request('https://example.com/usage/analytics?scope=user&user_id=email:other@example.com', {
    headers: { cookie }
  }), env, { waitUntil() {} });

  cleanup();
  assert.equal(res.status, 403);
});

test('admin can access admin analytics scope', async () => {
  const env = makeEnv();
  env.ADMIN_EMAILS = 'admin@example.com';
  const cleanup = installUsageFetchMock();
  const cookie = await createSessionCookie(env, 'admin@example.com');

  const res = await worker.fetch(new Request('https://example.com/usage/analytics?scope=admin', {
    headers: { cookie }
  }), env, { waitUntil() {} });

  cleanup();
  assert.equal(res.status, 200);
});

test('rate limiter returns 429 when limiter rejects request', async () => {
  const request = new Request('https://example.com/auth/google', { method: 'POST' });
  const env = {
    MY_RATE_LIMITER: {
      async limit() {
        return { success: false };
      }
    }
  };

  const response = await __test.enforceAuthRateLimit(request, env, 'google');
  assert.equal(response.status, 429);
});
