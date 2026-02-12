import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createAgentRouter } from '../../agent/routes.js';

function createMemoryStore() {
  const runs = new Map();
  const events = [];
  let runSeq = 0;
  let eventSeq = 0;

  return {
    async createAgentRun({ userId }) {
      runSeq += 1;
      const id = `run-${runSeq}`;
      const now = Date.now();
      const run = { id, user_id: userId, status: 'PREPARING', active: null, phase: null, started_at: now, updated_at: now, last_event_id: 0 };
      runs.set(id, run);
      return run;
    },
    async appendEvent({ runId, userId, type, payload = {} }) {
      eventSeq += 1;
      const evt = { id: eventSeq, run_id: runId, user_id: userId, type, ts: Date.now(), payload };
      events.push(evt);
      const run = runs.get(runId);
      if (run) {
        run.last_event_id = evt.id;
        run.updated_at = Date.now();
        if (type === 'AGENT_CANCEL') {
          run.status = 'CANCELLED';
          run.active = null;
          run.phase = null;
        }
      }
      return evt;
    },
    async listAgentRunsByUserId({ userId }) {
      return [...runs.values()].filter((run) => run.user_id === userId);
    },
    async getAgentRunById({ runId, userId }) {
      const run = runs.get(runId);
      return run && run.user_id === userId ? run : null;
    },
    async getAgentRunByIdAny({ runId }) {
      return runs.get(runId) || null;
    },
    async listAgentEventsAfter({ runId, after }) {
      return events.filter((evt) => evt.run_id === runId && evt.id > after).sort((a, b) => a.id - b.id);
    },
    async insertAgentFindings() { return []; },
    async markAgentRunFinished({ runId }) { return runs.get(runId); },
    async getFindingsByRunId() { return []; },
    async getFindingById() { return null; }
  };
}

async function createServer(sessionByToken, store) {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', createAgentRouter({
    verifyStripeSignature: () => ({}),
    store,
    getSessionFromRequest: async (req) => {
      const token = req.headers['x-test-auth'];
      return sessionByToken[token] || null;
    }
  }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

test('unauthenticated requests return 401', async () => {
  const store = createMemoryStore();
  const { server, baseUrl } = await createServer({}, store);
  const res = await fetch(`${baseUrl}/api/agent/runs`);
  assert.equal(res.status, 401);
  server.close();
});

test('create run returns snapshot and lastEventId', async () => {
  const store = createMemoryStore();
  const { server, baseUrl } = await createServer({ user1: { sub: 'user-1' } }, store);
  const res = await fetch(`${baseUrl}/api/agent/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-auth': 'user1' },
    body: JSON.stringify({ simulate: false })
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.run?.id);
  assert.equal(body.lastEventId, 1);
  server.close();
});

test('events endpoint returns ordered events', async () => {
  const store = createMemoryStore();
  const { server, baseUrl } = await createServer({ user1: { sub: 'user-1' } }, store);
  const createRes = await fetch(`${baseUrl}/api/agent/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-auth': 'user1' },
    body: JSON.stringify({ simulate: false })
  });
  const created = await createRes.json();
  await fetch(`${baseUrl}/api/agent/runs/${created.run.id}/cancel`, {
    method: 'POST',
    headers: { 'x-test-auth': 'user1' }
  });
  const eventsRes = await fetch(`${baseUrl}/api/agent/runs/${created.run.id}/events?after=0&limit=500`, {
    headers: { 'x-test-auth': 'user1' }
  });
  const body = await eventsRes.json();
  assert.deepEqual(body.events.map((e) => e.id), [1, 2]);
  server.close();
});

test('accessing another user run returns 403', async () => {
  const store = createMemoryStore();
  const { server, baseUrl } = await createServer({ user1: { sub: 'user-1' }, user2: { sub: 'user-2' } }, store);
  const createRes = await fetch(`${baseUrl}/api/agent/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-auth': 'user1' },
    body: JSON.stringify({ simulate: false })
  });
  const created = await createRes.json();
  const res = await fetch(`${baseUrl}/api/agent/runs/${created.run.id}`, {
    headers: { 'x-test-auth': 'user2' }
  });
  assert.equal(res.status, 403);
  server.close();
});

test('cancel run marks status as CANCELLED and appends an event', async () => {
  const store = createMemoryStore();
  const { server, baseUrl } = await createServer({ user1: { sub: 'user-1' } }, store);
  const createRes = await fetch(`${baseUrl}/api/agent/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-auth': 'user1' },
    body: JSON.stringify({ simulate: false })
  });
  const created = await createRes.json();
  const cancelRes = await fetch(`${baseUrl}/api/agent/runs/${created.run.id}/cancel`, {
    method: 'POST',
    headers: { 'x-test-auth': 'user1' }
  });
  assert.equal(cancelRes.status, 200);
  const runRes = await fetch(`${baseUrl}/api/agent/runs/${created.run.id}`, {
    headers: { 'x-test-auth': 'user1' }
  });
  const runBody = await runRes.json();
  assert.equal(runBody.run.status, 'CANCELLED');
  assert.equal(runBody.run.lastEventId, 2);
  server.close();
});
