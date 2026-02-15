const STORAGE_KEY = 'pdco_agents_state_v2';
const LEGACY_STORAGE_KEY = 'pdco_agent_state_v1';
let persistenceDisabled = false;

function compactAgentsState(agentsState) {
  if (!agentsState || typeof agentsState !== 'object' || !agentsState.byId) {
    return agentsState;
  }

  const compactById = {};
  for (const [agentId, agent] of Object.entries(agentsState.byId)) {
    if (!agent || typeof agent !== 'object') {
      compactById[agentId] = agent;
      continue;
    }

    compactById[agentId] = {
      ...agent,
      partialOutput: typeof agent.partialOutput === 'string'
        ? agent.partialOutput.slice(-4000)
        : '',
      eventLog: Array.isArray(agent.eventLog)
        ? agent.eventLog.slice(-40)
        : []
    };
  }

  return {
    ...agentsState,
    byId: compactById
  };
}

export function persistAgentsState(agentsState) {
  if (persistenceDisabled) {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(agentsState));
  } catch (e) {
    const isQuotaError = e?.name === 'QuotaExceededError';
    if (!isQuotaError) {
      console.warn('Persist failed:', e);
      return;
    }

    try {
      const compactState = compactAgentsState(agentsState);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(compactState));
      console.warn('Persist exceeded quota; stored a compact agent state snapshot instead.');
    } catch (retryError) {
      persistenceDisabled = true;
      console.warn('Persist disabled: localStorage quota exceeded repeatedly.', retryError);
    }
  }
}

export function loadAgentsState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearAgentsState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures while clearing.
  }
}

export function migrateLegacyAgentState() {
  try {
    const old = localStorage.getItem(LEGACY_STORAGE_KEY);
    const hasNew = localStorage.getItem(STORAGE_KEY);
    if (!old || hasNew) {
      return;
    }

    const legacyAgent = JSON.parse(old);
    if (!legacyAgent || typeof legacyAgent !== 'object') {
      return;
    }

    const agentId = legacyAgent.agentId || 'agent-1';
    persistAgentsState({
      byId: { [agentId]: { ...legacyAgent, agentId } },
      activeAgentId: agentId
    });
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore migration failures.
  }
}
