const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (window.location.hostname === 'localhost' ? 'http://localhost:8080' : null);

const WS_BASE =
  import.meta.env.VITE_WS_BASE ||
  (window.location.hostname === 'localhost' ? 'ws://localhost:8080/ws' : null);

export function requireApiBase() {
  if (!API_BASE) throw new Error('Missing API base URL in production.');
  return API_BASE;
}

export function requireWsBase() {
  if (!WS_BASE) throw new Error('Missing WebSocket base URL in production.');
  return WS_BASE;
}

export { API_BASE, WS_BASE };
