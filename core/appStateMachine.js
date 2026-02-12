import { persistAgentsState } from './persistence.js';

export const APP_STATES = {
  BOOTING: 'BOOTING',
  INIT_NETWORK: 'INIT_NETWORK',
  INIT_SESSION: 'INIT_SESSION',
  INIT_USAGE: 'INIT_USAGE',
  READY: 'READY',
  DEGRADED: 'DEGRADED',
  OFFLINE: 'OFFLINE',
  ERROR: 'ERROR'
};

export const AGENT_ROOT_STATES = {
  IDLE: 'IDLE',
  PREPARING: 'PREPARING',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
};

export const AGENT_ACTIVE_SUBSTATES = {
  RUNNING: 'RUNNING',
  STREAMING: 'STREAMING'
};

export const AGENT_STREAM_PHASES = {
  TOKENIZING: 'TOKENIZING',
  RECEIVING: 'RECEIVING',
  RENDERING: 'RENDERING',
  FINALIZING: 'FINALIZING'
};

export const EVENTS = {
  START: 'START',
  NETWORK_OK: 'NETWORK_OK',
  NETWORK_FAIL: 'NETWORK_FAIL',
  SESSION_OK: 'SESSION_OK',
  SESSION_FAIL: 'SESSION_FAIL',
  USAGE_OK: 'USAGE_OK',
  USAGE_FAIL: 'USAGE_FAIL',
  FATAL: 'FATAL',
  AGENT_START: 'AGENT_START',
  AGENT_READY: 'AGENT_READY',
  AGENT_STREAM: 'AGENT_STREAM',
  STREAM_TOKEN: 'STREAM_TOKEN',
  STREAM_CHUNK: 'STREAM_CHUNK',
  STREAM_RENDER: 'STREAM_RENDER',
  STREAM_DONE: 'STREAM_DONE',
  AGENT_COMPLETE: 'AGENT_COMPLETE',
  AGENT_FAIL: 'AGENT_FAIL',
  AGENT_CANCEL: 'AGENT_CANCEL',
  AGENT_RESET: 'AGENT_RESET'
};

export function createAgentState(agentId) {
  return {
    agentId,
    serverRunId: null,
    lastServerEventId: 0,
    root: AGENT_ROOT_STATES.IDLE,
    active: null,
    streamPhase: null,
    taskId: null,
    startedAt: null,
    resumeToken: null,
    partialOutput: '',
    lastEventAt: null,
    error: null,
    eventLog: []
  };
}

const appTransitions = {
  BOOTING: { START: 'INIT_NETWORK' },
  INIT_NETWORK: { NETWORK_OK: 'INIT_SESSION', NETWORK_FAIL: 'DEGRADED' },
  INIT_SESSION: { SESSION_OK: 'INIT_USAGE', SESSION_FAIL: 'DEGRADED' },
  INIT_USAGE: { USAGE_OK: 'READY', USAGE_FAIL: 'DEGRADED' },
  DEGRADED: { START: 'INIT_NETWORK' },
  READY: {},
  OFFLINE: {},
  ERROR: {}
};

const agentRootTransitions = {
  IDLE: { AGENT_START: 'PREPARING' },
  PREPARING: { AGENT_READY: 'ACTIVE', AGENT_FAIL: 'FAILED', AGENT_CANCEL: 'CANCELLED' },
  ACTIVE: { AGENT_COMPLETE: 'COMPLETED', AGENT_FAIL: 'FAILED', AGENT_CANCEL: 'CANCELLED' },
  COMPLETED: { AGENT_RESET: 'IDLE' },
  FAILED: { AGENT_RESET: 'IDLE' },
  CANCELLED: { AGENT_RESET: 'IDLE' }
};

const agentActiveTransitions = {
  RUNNING: { AGENT_STREAM: AGENT_ACTIVE_SUBSTATES.STREAMING },
  STREAMING: {
    STREAM_TOKEN: AGENT_STREAM_PHASES.TOKENIZING,
    STREAM_CHUNK: AGENT_STREAM_PHASES.RECEIVING,
    STREAM_RENDER: AGENT_STREAM_PHASES.RENDERING,
    STREAM_DONE: AGENT_STREAM_PHASES.FINALIZING
  }
};

export class AppStateMachine {
  constructor() {
    this.state = {
      app: APP_STATES.BOOTING,
      agents: { byId: {}, activeAgentId: null }
    };
    this.listeners = [];
  }

  getOrCreateAgent(agentId) {
    if (!agentId) {
      return null;
    }
    if (!this.state.agents.byId[agentId]) {
      this.state.agents.byId[agentId] = createAgentState(agentId);
    }
    return this.state.agents.byId[agentId];
  }

  applyAgentTransitions(agent, evt) {
    if (!agent || !evt?.type) {
      return false;
    }

    if (!Array.isArray(agent.eventLog)) {
      agent.eventLog = [];
    }

    agent.eventLog.push({
      type: evt.type,
      timestamp: Date.now(),
      payload: evt.payload || null
    });

    if (agent.eventLog.length > 200) {
      agent.eventLog.shift();
    }

    let changed = false;
    const root = agent.root;
    const rootNext = agentRootTransitions[root]?.[evt.type];

    if (rootNext) {
      agent.root = rootNext;
      agent.lastEventAt = Date.now();
      changed = true;

      if (rootNext === AGENT_ROOT_STATES.ACTIVE) {
        agent.active = AGENT_ACTIVE_SUBSTATES.RUNNING;
      }

      if (rootNext !== AGENT_ROOT_STATES.ACTIVE) {
        agent.active = null;
        agent.streamPhase = null;
      }

      if (rootNext === AGENT_ROOT_STATES.IDLE) {
        agent.taskId = null;
        agent.startedAt = null;
        agent.resumeToken = null;
        agent.partialOutput = '';
        agent.error = null;
      }

      if ([AGENT_ROOT_STATES.COMPLETED, AGENT_ROOT_STATES.FAILED, AGENT_ROOT_STATES.CANCELLED].includes(rootNext)) {
        agent.resumeToken = null;
        agent.streamPhase = null;
        agent.active = null;
      }
    }

    if (agent.root === AGENT_ROOT_STATES.ACTIVE) {
      const active = agent.active;
      const activeNext = agentActiveTransitions[active]?.[evt.type];
      if (activeNext) {
        if (active === AGENT_ACTIVE_SUBSTATES.RUNNING && activeNext === AGENT_ACTIVE_SUBSTATES.STREAMING) {
          agent.active = AGENT_ACTIVE_SUBSTATES.STREAMING;
        } else {
          agent.streamPhase = activeNext;
        }
        agent.lastEventAt = Date.now();
        changed = true;
      }
    }

    if (evt.type === EVENTS.AGENT_FAIL) {
      agent.error = evt.payload?.error || 'Unknown error';
      changed = true;
    }

    return changed;
  }

  dispatch(evt) {
    const event = typeof evt === 'string' ? { type: evt } : evt;
    if (!event?.type) {
      return;
    }

    let changed = false;
    const appNext = appTransitions[this.state.app]?.[event.type];
    if (appNext) {
      this.state.app = appNext;
      changed = true;
    }

    if (event.agentId) {
      const agent = this.getOrCreateAgent(event.agentId);
      changed = this.applyAgentTransitions(agent, event) || changed;
    }

    if (changed) {
      this.notify();
    }
  }

  subscribe(fn) {
    this.listeners.push(fn);
  }

  notify() {
    persistAgentsState(this.state.agents);
    for (const fn of this.listeners) {
      fn(this.state);
    }
  }

  getState() { return this.state; }
  getAppState() { return this.state.app; }
  getAgent(agentId) { return this.state.agents.byId[agentId] || null; }
  getAllAgents() { return Object.values(this.state.agents.byId); }
  setActiveAgent(agentId) {
    this.state.agents.activeAgentId = agentId;
    this.notify();
  }
  getActiveAgent() { return this.getAgent(this.state.agents.activeAgentId); }

  // Backward-compatible accessors now resolve against active agent.
  getAgentState() { return this.getActiveAgent(); }
  getAgentRoot() { return this.getActiveAgent()?.root || AGENT_ROOT_STATES.IDLE; }
  getAgentActive() { return this.getActiveAgent()?.active || null; }
  getAgentStreamPhase() { return this.getActiveAgent()?.streamPhase || null; }
}
