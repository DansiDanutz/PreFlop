/** Storage wrappers that never throw (private windows, blocked storage). */

function safe(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string, kind: 'local' | 'session' = 'local'): T | null {
  try {
    const raw = safe(kind)?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown, kind: 'local' | 'session' = 'local') {
  try {
    safe(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function readString(key: string, kind: 'local' | 'session' = 'local'): string | null {
  try {
    return safe(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string | null, kind: 'local' | 'session' = 'local') {
  try {
    const s = safe(kind);
    if (value === null) s?.removeItem(key);
    else s?.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export const KEYS = {
  token: 'pf.token',
  embedToken: 'pf.embed.token',
  favorites: 'pf.favorites',
  favoriteClubs: 'pf.favoriteClubs',
  savedTables: 'pf.savedTables',
  lastTable: 'pf.lastTable',
  stake: 'pf.stake',
} as const;
