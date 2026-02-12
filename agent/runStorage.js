const DB_NAME = 'maya_agent_runs';
const DB_VERSION = 1;
const STORE_NAME = 'runs';

let dbPromise;

function requestToPromise(request, fallback = null) {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result ?? fallback);
    request.onerror = () => resolve(fallback);
  });
}

async function openRunsDb() {
  if (!window.indexedDB) {
    return null;
  }
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const runs = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        runs.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

  return dbPromise;
}

export async function saveAgentRunLocal(run) {
  const db = await openRunsDb();
  if (!db) {
    return false;
  }
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(run);
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

export async function listAgentRunsLocal() {
  const db = await openRunsDb();
  if (!db) {
    return [];
  }
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const records = await requestToPromise(store.getAll(), []);
  return records.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

export async function exportAgentRunBundle() {
  const runs = await listAgentRunsLocal();
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    runs
  };
}

export async function saveAgentRunServer(run) {
  try {
    const response = await fetch('/api/agent/runs', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        simulate: false,
        config_json: {
          harness_run: run
        }
      })
    });
    return response.ok;
  } catch {
    return false;
  }
}
