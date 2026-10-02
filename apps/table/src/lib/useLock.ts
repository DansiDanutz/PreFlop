import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Identity } from './keystore.ts';
import { DEFAULT_IDLE_MIN, TabletLock, type UnlockResult, localLockoutStore, setSigningGate } from './lock.ts';

const CHECK_MS = 5_000;

/**
 * The live tablet lock for an enrolled identity: registers the signing gate, counts touches and
 * key presses as activity, locks after the idle time (checked every 5 s, on every signature and
 * when the tablet comes back to the foreground).
 */
export function useTabletLock(id: Identity, startLocked: boolean) {
  const idRef = useRef(id);
  idRef.current = id;
  const lock = useMemo(
    () => new TabletLock({ now: Date.now(), idleMs: (id.idleMinutes ?? DEFAULT_IDLE_MIN) * 60_000, locked: !!id.pin && startLocked, store: localLockoutStore() }),
    // One lock per enrolled credential; PIN and idle changes are applied below.
    [id.config.credentialId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [locked, setLocked] = useState(lock.locked);

  useEffect(() => { lock.setIdleMs((id.idleMinutes ?? DEFAULT_IDLE_MIN) * 60_000); }, [lock, id.idleMinutes]);

  useEffect(() => {
    const sync = () => {
      if (!idRef.current.pin) return true;
      lock.check(Date.now());
      setLocked(lock.locked);
      return !lock.locked;
    };
    setSigningGate(sync);
    const activity = () => lock.activity(Date.now());
    const visible = () => { if (document.visibilityState === 'visible') sync(); };
    window.addEventListener('pointerdown', activity, true);
    window.addEventListener('keydown', activity, true);
    document.addEventListener('visibilitychange', visible);
    const h = setInterval(sync, CHECK_MS);
    return () => {
      setSigningGate(() => true);
      window.removeEventListener('pointerdown', activity, true);
      window.removeEventListener('keydown', activity, true);
      document.removeEventListener('visibilitychange', visible);
      clearInterval(h);
    };
  }, [lock]);

  const lockNow = useCallback(() => { lock.lock(); setLocked(true); }, [lock]);
  const unlock = useCallback(async (pin: string): Promise<UnlockResult> => {
    const rec = idRef.current.pin;
    if (!rec) return { ok: true };
    const r = await lock.unlock(pin, rec, Date.now());
    setLocked(lock.locked);
    return r;
  }, [lock]);
  return { locked: locked && !!id.pin, lockNow, unlock, waitMs: (now: number) => lock.waitMs(now) };
}
