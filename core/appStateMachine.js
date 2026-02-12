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

export const AGENT_STATES = {
  IDLE: 'IDLE',
  PREPARING: 'PREPARING',
  RUNNING: 'RUNNING',
  STREAMING: 'STREAMING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
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

const agentTransitions = {
  IDLE: {
    AGENT_START: 'PREPARING'
  },
  PREPARING: {
    AGENT_READY: 'RUNNING',
    AGENT_FAIL: 'FAILED'
  },
  RUNNING: {
    AGENT_STREAM: 'STREAMING',
    AGENT_COMPLETE: 'COMPLETED',
    AGENT_FAIL: 'FAILED',
    AGENT_CANCEL: 'CANCELLED'
  },
  STREAMING: {
    AGENT_COMPLETE: 'COMPLETED',
    AGENT_FAIL: 'FAILED',
    AGENT_CANCEL: 'CANCELLED'
  },
  COMPLETED: {
    AGENT_RESET: 'IDLE'
  },
  FAILED: {
    AGENT_RESET: 'IDLE'
  },
  CANCELLED: {
    AGENT_RESET: 'IDLE'
  }
};

export class AppStateMachine {
  constructor() {
    this.state = {
      app: APP_STATES.BOOTING,
      agent: AGENT_STATES.IDLE
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

    const agentNext = agentTransitions[this.state.agent]?.[event];
    if (agentNext) {
      this.state.agent = agentNext;
      changed = true;
    }

    if (changed) {
      this.notify();
    }
  }

  subscribe(fn) {
    this.listeners.push(fn);
  }

  notify() {
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
}
