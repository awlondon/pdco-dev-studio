import assert from 'node:assert/strict';
import { test } from 'node:test';

const API = process.env.TEST_API_BASE ?? 'https://dev.primarydesignco.com/api';

async function expectJson(res: Response) {
  const contentType = res.headers.get('content-type') || '';
  assert.ok(contentType.includes('application/json'), 'Expected JSON response');
  return res.json();
}

test('health, debug env, /me and llm plumbing', async () => {
  const healthRes = await fetch(`${API}/health`);
  assert.equal(healthRes.status, 200);
  await expectJson(healthRes);

  const debugRes = await fetch(`${API}/debug/env`);
  if (debugRes.status !== 404) {
    assert.equal(debugRes.status, 200);
    const debugBody = await expectJson(debugRes);
    assert.equal(debugBody.ok, true);
    const envPresent = debugBody.env_present || {};
    const required = ['GOOGLE_CLIENT_ID', 'SESSION_SECRET', 'EMAIL_TOKEN_SECRET'];
    for (const key of required) {
      assert.equal(envPresent[key], true, `Missing env: ${key}`);
    }
  }

  const meRes = await fetch(`${API}/me`, { method: 'GET' });
  assert.equal(meRes.status, 401);
  await expectJson(meRes);

  const llmRes = await fetch(`${API}/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ping: true })
  });
  assert.equal(llmRes.status, 200);
  const llmBody = await expectJson(llmRes);
  assert.equal(llmBody.ok, true);
});
