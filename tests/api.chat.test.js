import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/chat.js';

function createMockRes() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
    send(body) {
      this.payload = body;
      return this;
    }
  };
}

test('chat endpoint rejects non-POST requests', async () => {
  const req = { method: 'GET', body: {} };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.payload, { error: 'Method not allowed' });
});

test('chat endpoint validates messages payload', async () => {
  const req = { method: 'POST', body: {} };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: 'Missing messages.' });
});

test('chat endpoint returns server error without OPENAI_API_KEY', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const req = { method: 'POST', body: { messages: [{ role: 'user', content: 'hello' }] } };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.payload, { error: 'Missing OPENAI_API_KEY on the server.' });

  if (originalApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test('chat endpoint forwards successful upstream responses', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-key';

  global.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(init.method, 'POST');
    assert.match(init.headers.Authorization, /Bearer test-key/);
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'gpt-4.1-mini');
    return {
      ok: true,
      status: 200,
      async json() {
        return { id: 'cmpl_123', choices: [{ message: { role: 'assistant', content: 'ok' } }] };
      }
    };
  };

  const req = {
    method: 'POST',
    body: { messages: [{ role: 'user', content: 'hello' }] }
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.id, 'cmpl_123');

  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

test('chat endpoint proxies upstream non-OK body text', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-key';

  global.fetch = async () => ({
    ok: false,
    status: 429,
    async text() {
      return 'rate limited';
    }
  });

  const req = {
    method: 'POST',
    body: { messages: [{ role: 'user', content: 'hello' }] }
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 429);
  assert.equal(res.payload, 'rate limited');

  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});


test('chat endpoint wraps latest user prompt when playable mode is enabled', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-key';

  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const latest = body.messages[body.messages.length - 1];
    assert.equal(latest.role, 'user');
    assert.match(latest.content, /objective \(win condition\)/i);
    assert.match(latest.content, /keyboard and\/or mouse inputs/i);
    assert.match(latest.content, /build something cool/i);
    assert.match(latest.content, /function draw\(\)/i);
    return {
      ok: true,
      status: 200,
      async json() {
        return { id: 'cmpl_playable', choices: [{ message: { role: 'assistant', content: 'ok' } }] };
      }
    };
  };

  const req = {
    method: 'POST',
    body: {
      playableMode: true,
      userPrompt: 'build something cool',
      currentCode: 'function draw() { return 1; }',
      messages: [{ role: 'user', content: 'build something cool' }]
    }
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.id, 'cmpl_playable');

  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

test('chat endpoint injects retry prompt when retry mode is enabled', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-key';

  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const latest = body.messages[body.messages.length - 1];
    assert.equal(latest.role, 'user');
    assert.match(latest.content, /significantly improved alternative response/i);
    assert.match(latest.content, /Original user request:\nCreate onboarding copy/i);
    assert.match(latest.content, /Previous response \(trimmed for efficiency\):/i);
    return {
      ok: true,
      status: 200,
      async json() {
        return { id: 'cmpl_retry', choices: [{ message: { role: 'assistant', content: 'ok' } }] };
      }
    };
  };

  const req = {
    method: 'POST',
    body: {
      retryMode: true,
      originalPrompt: 'Create onboarding copy',
      previousResponse: 'Short answer',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Create onboarding copy' }
      ]
    }
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.id, 'cmpl_retry');

  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});
