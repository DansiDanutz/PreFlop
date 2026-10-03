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
  howToPlaySeen: 'pf.howToPlay.seen',
} as const;

let firstRunHelpTaken = false;
/**
 * First-run onboarding: true exactly once per device (and at most once per page load when storage
 * is blocked), so How to play opens by itself on a player's first visit and never again.
 */
export function takeFirstRunHelp(): boolean {
  if (firstRunHelpTaken || readString(KEYS.howToPlaySeen) === '1') return false;
  firstRunHelpTaken = true;
  writeString(KEYS.howToPlaySeen, '1');
  return true;
}
/** Test hook: forget the in-memory flag. */
export const resetFirstRunHelp = () => { firstRunHelpTaken = false; };
