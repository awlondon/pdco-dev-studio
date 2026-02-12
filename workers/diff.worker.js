import { computeLineDiff } from '../utils/lineDiff.js';

const canceledRequestIds = new Set();

self.addEventListener('message', (event) => {
  const { type, id, method, params } = event.data || {};

  if (!id) {
    return;
  }

  if (type === 'cancel') {
    canceledRequestIds.add(id);
    return;
  }

  if (type !== 'request') {
    return;
  }

  if (canceledRequestIds.has(id)) {
    canceledRequestIds.delete(id);
    return;
  }

  try {
    if (method !== 'computeLineDiff') {
      throw new Error(`Unknown method: ${method}`);
    }

    const result = computeLineDiff(params?.source, params?.target);
    if (canceledRequestIds.has(id)) {
      canceledRequestIds.delete(id);
      return;
    }

    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({
      id,
      error: {
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }
});
