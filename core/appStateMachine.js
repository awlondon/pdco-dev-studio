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

export const EVENTS = {
  START: 'START',
  NETWORK_OK: 'NETWORK_OK',
  NETWORK_FAIL: 'NETWORK_FAIL',
  SESSION_OK: 'SESSION_OK',
  SESSION_FAIL: 'SESSION_FAIL',
  USAGE_OK: 'USAGE_OK',
  USAGE_FAIL: 'USAGE_FAIL',
  FATAL: 'FATAL'
};

const transitions = {
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

export class AppStateMachine {
  constructor() {
    this.state = APP_STATES.BOOTING;
    this.listeners = [];
  }

  dispatch(event) {
    const next = transitions[this.state]?.[event];
    if (next) {
      this.state = next;
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
}
