const getWindowString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const normalizeApiBase = (value: string): string =>
  value
    .replace(/\/$/, '')
    .replace(/\/api$/i, '');

const defaultApiBase =
  window.location.hostname === 'localhost'
    ? 'http://localhost:8080'
    : window.location.origin;

const runtimeApiBase =
  getWindowString(import.meta.env.VITE_API_BASE) ||
  getWindowString((window as Window & { API_BASE?: unknown }).API_BASE) ||
  defaultApiBase;

const API_BASE = normalizeApiBase(runtimeApiBase);

const defaultWsBase =
  window.location.hostname === 'localhost'
    ? 'ws://localhost:8080/ws'
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

const runtimeWsBase =
  getWindowString(import.meta.env.VITE_WS_BASE) ||
  getWindowString((window as Window & { WS_BASE?: unknown }).WS_BASE) ||
  defaultWsBase;
const WS_BASE = runtimeWsBase;

export function requireApiBase() {
  if (!API_BASE) throw new Error('Missing API base URL in production.');
  return API_BASE;
}

export function requireWsBase() {
  if (!WS_BASE) throw new Error('Missing WebSocket base URL in production.');
  return WS_BASE;
}

export { API_BASE, WS_BASE };
