import { appendAgentEvent } from './store.js';

export async function appendEvent({ runId, userId, type, payload = {} }) {
  return appendAgentEvent({ runId, userId, type, payload });
}
