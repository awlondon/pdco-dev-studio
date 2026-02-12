const STORAGE_KEY = 'pdco_agent_state_v1';

export function persistAgentState(agentState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(agentState));
  } catch (e) {
    console.warn('Persistence failed:', e);
  }
}

export function loadAgentState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearAgentState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures while clearing.
  }
}
