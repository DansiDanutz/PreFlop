/**
 * Browser session hygiene shared by the web app and the console: following a sign-out made in
 * another tab, and signing out after a period without use. Both take the event target (window) as
 * an argument, so they run in tests without a DOM.
 */
type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * Calls `onChange` with the key's new value whenever ANOTHER tab of the same origin changes it in
 * localStorage (`null` when it was removed or the storage was cleared). The browser does not send
 * the event to the tab that made the change.
 */
export function watchStorageKey(target: Listenable, key: string, onChange: (value: string | null) => void): () => void {
  const handler = (e: Event) => {
    const ev = e as Event & { key?: string | null; newValue?: string | null };
    if (ev.key === key) onChange(ev.newValue ?? null);
    else if (ev.key === null || ev.key === undefined) onChange(null);
  };
  target.addEventListener('storage', handler);
  return () => target.removeEventListener('storage', handler);
}

/** What counts as someone using the page. */
export const ACTIVITY_EVENTS: readonly string[] = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
/** Activity is recorded at most this often: the handlers run on every key press and pointer press. */
export const ACTIVITY_THROTTLE_MS = 5_000;

export interface IdleWatchOptions {
  timeoutMs: number;
  /** Called once when nobody used the page (or, with `shared`, any tab) for `timeoutMs`. */
  onIdle: () => void;
  target: Listenable;
  events?: readonly string[];
  /** The time of the last activity in any tab, kept where every tab can read it (localStorage). */
  shared?: { read: () => number | null; write: (at: number) => void };
}

/** Watches for activity and calls `onIdle` once after `timeoutMs` without any. Returns a stop function. */
export function watchIdle(o: IdleWatchOptions): () => void {
  const events = o.events ?? ACTIVITY_EVENTS;
  let last = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lastActive = () => Math.max(last, o.shared?.read() ?? 0);
  const check = () => {
    const idleFor = Date.now() - lastActive();
    if (idleFor >= o.timeoutMs) o.onIdle();
    else timer = setTimeout(check, o.timeoutMs - idleFor);
  };
  const active = () => {
    const now = Date.now();
    if (now - last < ACTIVITY_THROTTLE_MS) return;
    last = now;
    o.shared?.write(now);
  };
  for (const name of events) o.target.addEventListener(name, active, { passive: true });
  timer = setTimeout(check, o.timeoutMs);
  return () => {
    clearTimeout(timer);
    for (const name of events) o.target.removeEventListener(name, active);
  };
}

/** The part of a query cache (TanStack's QueryClient) that forgetting a session needs. */
export interface SessionCache {
  clear: () => void;
  resetQueries: () => unknown;
}

/**
 * Drops what was cached for the previous session when the token changes under a tab. Signed out:
 * everything goes. Replaced by another sign-in: queries are reset and the mounted ones fetched
 * again with the new token. Clearing in that case would also remove, without notice, the queries
 * the new session has already started, and leave their screens waiting forever.
 */
export function forgetPreviousSession(cache: SessionCache, previous: string | null, current: string | null): void {
  if (!previous || previous === current) return;
  if (current === null) cache.clear();
  else void cache.resetQueries();
}

/**
 * Signs out locally at once, then tells the server. The local step never waits for the network: an
 * API that does not answer must not keep an unattended session usable.
 */
export function signOutThenRevoke(token: string | null, clearLocal: () => void, revoke: (token: string) => Promise<unknown>): void {
  clearLocal();
  if (token) void revoke(token).catch(() => { /* the session may already be gone, or the API unreachable; the server's idle limit still ends it */ });
}
