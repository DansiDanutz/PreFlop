import { createClient } from '@preflop/client';
import { KEYS, readString, writeString } from './storage.ts';

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';
export const WS_URL = `${API_URL.replace(/^http/, 'ws')}/v1/stream`;

/** Partner iframes (/embed/…) keep their token in sessionStorage, never in the site's localStorage. */
export const isEmbed = () => typeof window !== 'undefined' && window.location.pathname.startsWith('/embed');

export function getToken(): string | null {
  return isEmbed() ? readString(KEYS.embedToken, 'session') : readString(KEYS.token);
}

export function setToken(token: string | null) {
  if (isEmbed()) writeString(KEYS.embedToken, token, 'session');
  else writeString(KEYS.token, token);
  listeners.forEach((l) => l());
}

const listeners = new Set<() => void>();
export function onTokenChange(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

let unauthorizedHandler: (() => void) | null = null;
export const setUnauthorizedHandler = (h: (() => void) | null) => (unauthorizedHandler = h);

export const api = createClient({
  baseUrl: API_URL,
  getToken,
  onUnauthorized: () => unauthorizedHandler?.(),
});
