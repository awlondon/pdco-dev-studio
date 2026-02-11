import crypto from 'node:crypto';
import { insertUsageEvent } from '../utils/usageAnalytics.js';

export function buildUsageSourceHash({ userId, requestId, status }) {
  if (!userId || !requestId) {
    return null;
  }
  return crypto.createHash('sha256').update(`${userId}:${requestId}:${status || 'unknown'}`).digest('hex');
}

export async function recordUsageEvent(event) {
  const sourceHash = event.sourceHash || buildUsageSourceHash({
    userId: event.userId,
    requestId: event.requestId,
    status: event.status
  });
  return insertUsageEvent({
    ...event,
    sourceHash
  });
}
