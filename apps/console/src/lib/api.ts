import { createClient } from '@preflop/client';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
export const WEB_URL: string = import.meta.env.VITE_WEB_URL ?? 'http://localhost:5173';

const TOKEN_KEY = 'pf.console.token';
const LAST_PORTAL_KEY = 'pf.console.lastPortal';

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string | null) {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage unavailable */ }
}

let token: string | null = safeGet(TOKEN_KEY);
const listeners = new Set<() => void>();

export const session = {
  get token() { return token; },
  set(t: string | null) {
    token = t;
    safeSet(TOKEN_KEY, t);
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  get lastPortal() { return safeGet(LAST_PORTAL_KEY); },
  rememberPortal(key: string) { safeSet(LAST_PORTAL_KEY, key); },
};

export const api = createClient({
  baseUrl: API_URL,
  getToken: () => token,
  onUnauthorized: () => { if (token) session.set(null); },
});

export type Api = typeof api;
