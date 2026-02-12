import { computeLineDiff } from '../utils/lineDiff.js';
import { createWorkerRpcClient } from './rpcClient.js';

let diffWorkerClient = null;
let workerUnavailable = false;

function getDiffWorkerClient() {
  if (workerUnavailable || typeof Worker === 'undefined') {
    return null;
  }

  if (!diffWorkerClient) {
    try {
      const workerUrl = new URL('./diff.worker.js', import.meta.url);
      diffWorkerClient = createWorkerRpcClient(workerUrl);
    } catch (error) {
      console.warn('Diff worker unavailable. Falling back to main thread.', error);
      workerUnavailable = true;
      diffWorkerClient = null;
    }
  }

  return diffWorkerClient;
}

export function computeLineDiffAsync(source = '', target = '', { signal } = {}) {
  const client = getDiffWorkerClient();
  if (!client) {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Request aborted', 'AbortError'));
    }
    return Promise.resolve(computeLineDiff(source, target));
  }

  return client.invoke('computeLineDiff', { source, target }, { signal });
}
