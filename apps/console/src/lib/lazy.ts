import { type ComponentType, type LazyExoticComponent, lazy } from 'react';

/** sessionStorage flag: this tab already reloaded once for a missing chunk (never loop on a real outage). */
export const CHUNK_RELOAD_KEY = 'pf.chunkReload';

function flag(): string | null {
  try { return sessionStorage.getItem(CHUNK_RELOAD_KEY); } catch { return null; }
}
function setFlag(v: string | null) {
  try { if (v === null) sessionStorage.removeItem(CHUNK_RELOAD_KEY); else sessionStorage.setItem(CHUNK_RELOAD_KEY, v); } catch { /* storage unavailable */ }
}

/**
 * Imports a route chunk. After a deploy the chunk hashes an open tab knows no longer exist, so the
 * first failed import reloads the page once (the fresh index names the new chunks) and never
 * settles: the Suspense fallback stays up until the reload. A second failure in the same tab is a
 * real outage and is rethrown to the error boundary. A successful load clears the flag.
 */
export function loadChunk<M>(load: () => Promise<M>): Promise<M> {
  return load().then((m) => {
    setFlag(null);
    return m;
  }, (e: unknown) => {
    if (flag()) throw e;
    setFlag('1');
    // Blocked or full storage: the flag would be missing again after the reload, so every boot would
    // reload once more. Without a stored flag, go straight to the error boundary instead.
    if (flag() !== '1') throw e;
    window.location.reload();
    return new Promise<M>(() => {});
  });
}

/**
 * React.lazy for a named export: the route groups (admin, org, club, partner, organizer, growth,
 * agent) load as separate same-origin chunks the first time one of their pages opens.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, name: K): LazyExoticComponent<M[K] & ComponentType<any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return lazy(() => loadChunk(load).then((m) => ({ default: m[name] as M[K] & ComponentType<any> })));
}
