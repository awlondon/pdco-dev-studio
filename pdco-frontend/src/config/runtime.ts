const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (window.location.hostname === 'localhost' ? 'http://localhost:3000' : '');

const WS_BASE =
  import.meta.env.VITE_WS_BASE ||
  (window.location.hostname === 'localhost' ? 'ws://localhost:3000/ws' : '');

export function requireApiBase() {
  if (!API_BASE) throw new Error('VITE_API_BASE missing in production');
  return API_BASE;
}

export function requireWsBase() {
  if (!WS_BASE) throw new Error('VITE_WS_BASE missing in production');
  return WS_BASE;
}

export { API_BASE, WS_BASE };
