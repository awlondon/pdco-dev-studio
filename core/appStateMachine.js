import { clearAgentState, persistAgentState } from './persistence.js';

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

const appTransitions = {
  BOOTING: {
    START: 'INIT_NETWORK'
  },
  INIT_NETWORK: {
    NETWORK_OK: 'INIT_SESSION',
    NETWORK_FAIL: 'DEGRADED'
  },
  INIT_SESSION: {
    SESSION_OK: 'INIT_USAGE',
    SESSION_FAIL: 'DEGRADED'
  },
  INIT_USAGE: {
    USAGE_OK: 'READY',
    USAGE_FAIL: 'DEGRADED'
  },
  DEGRADED: {
    START: 'INIT_NETWORK'
  },
  READY: {},
  OFFLINE: {},
  ERROR: {}
};

const agentRootTransitions = {
  IDLE: { AGENT_START: 'PREPARING' },
  PREPARING: {
    AGENT_READY: 'ACTIVE',
    AGENT_FAIL: 'FAILED'
  },
  ACTIVE: {
    AGENT_COMPLETE: 'COMPLETED',
    AGENT_FAIL: 'FAILED',
    AGENT_CANCEL: 'CANCELLED'
  },
  COMPLETED: { AGENT_RESET: 'IDLE' },
  FAILED: { AGENT_RESET: 'IDLE' },
  CANCELLED: { AGENT_RESET: 'IDLE' }
};

const agentActiveTransitions = {
  RUNNING: {
    AGENT_STREAM: AGENT_ACTIVE_SUBSTATES.STREAMING
  },
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
      agent: {
        root: AGENT_ROOT_STATES.IDLE,
        active: null,
        streamPhase: null,
        taskId: null,
        startedAt: null,
        resumeToken: null,
        partialOutput: ''
      }
    };
    this.listeners = [];
  }

  dispatch(event) {
    let changed = false;

    const appNext = appTransitions[this.state.app]?.[event];
    if (appNext) {
      this.state.app = appNext;
      changed = true;
    }

    const root = this.state.agent.root;
    const rootNext = agentRootTransitions[root]?.[event];
    if (rootNext) {
      this.state.agent.root = rootNext;

      if (rootNext !== AGENT_ROOT_STATES.ACTIVE) {
        this.state.agent.active = null;
        this.state.agent.streamPhase = null;
      }

      if (rootNext === AGENT_ROOT_STATES.IDLE) {
        this.state.agent.taskId = null;
        this.state.agent.startedAt = null;
        this.state.agent.resumeToken = null;
        this.state.agent.partialOutput = '';
      }

      if ([AGENT_ROOT_STATES.COMPLETED, AGENT_ROOT_STATES.FAILED, AGENT_ROOT_STATES.CANCELLED].includes(rootNext)) {
        clearAgentState();
      }

      changed = true;
    }

    if (root === AGENT_ROOT_STATES.PREPARING && event === EVENTS.AGENT_READY) {
      this.state.agent.active = AGENT_ACTIVE_SUBSTATES.RUNNING;
      changed = true;
    }

    if (this.state.agent.root === AGENT_ROOT_STATES.ACTIVE) {
      const active = this.state.agent.active;
      const activeNext = agentActiveTransitions[active]?.[event];

      if (activeNext) {
        if (active === AGENT_ACTIVE_SUBSTATES.RUNNING && activeNext === AGENT_ACTIVE_SUBSTATES.STREAMING) {
          this.state.agent.active = AGENT_ACTIVE_SUBSTATES.STREAMING;
        } else {
          this.state.agent.streamPhase = activeNext;
        }
        changed = true;
      }
    }

    if (changed) {
      this.notify();
    }
  }

  subscribe(fn) {
    this.listeners.push(fn);
  }

  notify() {
    persistAgentState(this.state.agent);

    for (const fn of this.listeners) {
      fn(this.state);
    }
  }

  getState() {
    return this.state;
  }

  getAppState() {
    return this.state.app;
  }

  getAgentState() {
    return this.state.agent;
  }

  getAgentRoot() {
    return this.state.agent.root;
  }

  getAgentActive() {
    return this.state.agent.active;
  }

  getAgentStreamPhase() {
    return this.state.agent.streamPhase;
  }
}
