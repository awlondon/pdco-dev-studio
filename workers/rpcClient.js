export function createWorkerRpcClient(workerUrl) {
  const worker = new Worker(workerUrl, { type: 'module' });
  const pending = new Map();
  let nextId = 1;

  worker.addEventListener('message', (event) => {
    const { id, result, error } = event.data || {};
    if (!id || !pending.has(id)) {
      return;
    }
    const entry = pending.get(id);
    pending.delete(id);
    if (error) {
      entry.reject(new Error(error.message || 'Worker request failed'));
      return;
    }
    entry.resolve(result);
  });

  worker.addEventListener('error', (error) => {
    for (const [, entry] of pending) {
      entry.reject(error instanceof Error ? error : new Error('Worker crashed'));
    }
    pending.clear();
  });

  function invoke(method, params, { signal } = {}) {
    const id = nextId;
    nextId += 1;

    return new Promise((resolve, reject) => {
      const cleanupAbort = () => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const onAbort = () => {
        worker.postMessage({ type: 'cancel', id });
        pending.delete(id);
        cleanupAbort();
        reject(new DOMException('Request aborted', 'AbortError'));
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }

      pending.set(id, {
        resolve: (value) => {
          cleanupAbort();
          resolve(value);
        },
        reject: (err) => {
          cleanupAbort();
          reject(err);
        }
      });

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      worker.postMessage({ type: 'request', id, method, params });
    });
  }

  function terminate() {
    for (const [, entry] of pending) {
      entry.reject(new Error('Worker terminated'));
    }
    pending.clear();
    worker.terminate();
  }

  return {
    invoke,
    terminate
  };
}
