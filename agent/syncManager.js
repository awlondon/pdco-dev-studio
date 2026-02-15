import { AGENT_ROOT_STATES, EVENTS, createAgentState } from '../core/appStateMachine.js';

function mapServerRoot(status) {
  return AGENT_ROOT_STATES[status] || AGENT_ROOT_STATES.IDLE;
}

export function createAgentSyncManager({ apiBase, appMachine, fetchImpl = fetch }) {
  let endpointUnavailable = false;

  function isJsonResponse(res) {
    const contentType = res.headers.get('content-type') || '';
    return /application\/json|text\/json/i.test(contentType);
  }

  async function fetchJson(path) {
    if (endpointUnavailable) {
      return null;
    }

    const res = await fetchImpl(`${apiBase}${path}`, { credentials: 'include' });
    if ([404, 405, 501].includes(res.status)) {
      endpointUnavailable = true;
      return null;
    }
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status}`);
    }
    if (!isJsonResponse(res)) {
      endpointUnavailable = true;
      return null;
    }

    try {
      return await res.json();
    } catch {
      endpointUnavailable = true;
      return null;
    }
  }

  function findOrCreateAgentForRun(serverRunId) {
    const existing = appMachine.getAllAgents().find((agent) => agent.serverRunId === serverRunId);
    if (existing) return existing;
    const localId = `server:${serverRunId}`;
    let agent = appMachine.getAgent(localId);
    if (!agent) {
      appMachine.state.agents.byId[localId] = createAgentState(localId);
      agent = appMachine.state.agents.byId[localId];
    }
    agent.serverRunId = serverRunId;
    return agent;
  }

  function applySnapshotToLocal(run) {
    const agent = findOrCreateAgentForRun(run.id);
    agent.serverRunId = run.id;
    agent.root = mapServerRoot(run.status);
    agent.active = run.active || null;
    agent.streamPhase = run.phase || null;
    agent.startedAt = run.startedAt || null;
    agent.lastEventAt = run.updatedAt || Date.now();
    agent.lastServerEventId = run.lastEventId || 0;
    agent.stale = false;
    appMachine.notify();
    return agent;
  }

  function applyEventsToLocal(runId, events = []) {
    const agent = findOrCreateAgentForRun(runId);
    for (const event of events) {
      if (event.id <= (agent.lastServerEventId || 0)) {
        continue;
      }
      if (event.type === EVENTS.STREAM_CHUNK && event.payload?.text) {
        agent.partialOutput += event.payload.text;
      }
      appMachine.dispatch({ type: event.type, agentId: agent.agentId, payload: event.payload || {} });
      agent.lastServerEventId = event.id;
    }
    appMachine.notify();
    return agent;
  }

  async function syncRun(runId) {
    const snapshot = await fetchJson(`/api/agent/runs/${runId}`);
    if (!snapshot?.run) {
      return;
    }
    const agent = applySnapshotToLocal(snapshot.run);
    const after = agent.lastServerEventId || 0;
    const delta = await fetchJson(`/api/agent/runs/${runId}/events?after=${after}&limit=500`);
    if (!delta) {
      return;
    }
    applyEventsToLocal(runId, delta.events || []);
    agent.lastServerEventId = delta.lastEventId || agent.lastServerEventId || 0;
    appMachine.notify();
  }

  async function syncAllRuns() {
    const list = await fetchJson('/api/agent/runs');
    if (!list) {
      return;
    }
    const runs = Array.isArray(list.runs) ? list.runs : [];
    await Promise.all(runs.map((run) => syncRun(run.id).catch(() => {
      const agent = findOrCreateAgentForRun(run.id);
      agent.stale = true;
      appMachine.notify();
    })));
  }

  return {
    syncRun,
    syncAllRuns,
    applySnapshotToLocal,
    applyEventsToLocal,
    isAvailable: () => !endpointUnavailable
  };
}
