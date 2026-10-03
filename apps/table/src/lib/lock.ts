import { type PinRecord, verifyPin } from './pin.ts';

/**
 * The tablet lock: locked at start (when a PIN is set), after `idleMs` without a touch, and when
 * the tablet comes back to the foreground after being idle that long. While locked, NOTHING is
 * signed: TableApi checks signingAllowed() before every signature, so even a stale button or a
 * retry cannot reach the server. Wrong PINs back off: after 5, each try waits 30 s, doubling up to
 * 15 min; the count survives a reload.
 */

export const IDLE_CHOICES_MIN = [2, 5, 10, 15] as const;
export const DEFAULT_IDLE_MIN = 5;
export const FREE_TRIES = 5;
const BASE_WAIT_MS = 30_000;
const MAX_WAIT_MS = 15 * 60_000;

export interface Lockout { failures: number; until: number }
export interface LockoutStore { get(): Lockout | null; set(v: Lockout | null): void }

/** Wait before the next try after `failures` wrong PINs in a row. */
export function backoffMs(failures: number): number {
  if (failures < FREE_TRIES) return 0;
  return Math.min(MAX_WAIT_MS, BASE_WAIT_MS * 2 ** (failures - FREE_TRIES));
}

export type UnlockResult = { ok: true } | { ok: false; reason: 'wrong' | 'wait'; waitMs: number; failures: number };

export class TabletLock {
  locked: boolean;
  lastActivity: number;
  private lockout: Lockout;

  constructor(private o: { now: number; idleMs: number; locked: boolean; store?: LockoutStore | undefined; verify?: typeof verifyPin }) {
    this.locked = o.locked;
    this.lastActivity = o.now;
    this.lockout = o.store?.get() ?? { failures: 0, until: 0 };
  }

  get idleMs() { return this.o.idleMs; }
  setIdleMs(ms: number) { this.o.idleMs = ms; }
  get failures() { return this.current().failures; }

  /** A touch or key press while unlocked keeps the tablet awake. */
  activity(now: number) {
    if (!this.locked) this.lastActivity = now;
  }

  /** Periodic check, and the check when the page becomes visible again. Returns true when it just locked. */
  check(now: number): boolean {
    if (this.locked || now - this.lastActivity < this.o.idleMs) return false;
    this.locked = true;
    return true;
  }

  lock() { this.locked = true; }

  /** Milliseconds until the next PIN try is allowed (0 = now). */
  waitMs(now: number) { return Math.max(0, this.current().until - now); }

  async unlock(pin: string, rec: PinRecord, now: number): Promise<UnlockResult> {
    const r = await this.verify(pin, rec, now);
    if (r.ok) {
      this.locked = false;
      this.lastActivity = now;
    }
    return r;
  }

  /**
   * One PIN try, counted against the same stored attempts and backoff whatever asks for it: the
   * lock screen, or the current-PIN step of a PIN change on an unlocked tablet.
   */
  async verify(pin: string, rec: PinRecord, now: number): Promise<UnlockResult> {
    const wait = this.waitMs(now);
    if (wait > 0) return { ok: false, reason: 'wait', waitMs: wait, failures: this.current().failures };
    const ok = await (this.o.verify ?? verifyPin)(pin, rec);
    if (ok) {
      this.save({ failures: 0, until: 0 });
      return { ok: true };
    }
    const failures = this.current().failures + 1;
    this.save({ failures, until: now + backoffMs(failures) });
    return { ok: false, reason: 'wrong', waitMs: backoffMs(failures), failures };
  }

  /** The stored count is re-read each time, so every TabletLock on this device shares it. */
  private current(): Lockout {
    if (this.o.store) this.lockout = this.o.store.get() ?? { failures: 0, until: 0 };
    return this.lockout;
  }

  private save(v: Lockout) {
    this.lockout = v;
    this.o.store?.set(v.failures === 0 ? null : v);
  }
}

// ------------------------------------------------------------------ signing gate

let gate: () => boolean = () => true;
/** The app registers the live lock here; TableApi asks before signing anything. */
export function setSigningGate(allowed: () => boolean) { gate = allowed; }
export const signingAllowed = () => gate();

/** localStorage-backed wrong-PIN counter (survives reloads; a reload also locks the tablet). */
/** In-page copies of records the browser refused to save, by key (absent while saving works). */
const unsaved = new Map<string, Lockout | null>();
const stronger = (a: Lockout | null, b: Lockout | null): Lockout | null =>
  !a ? b : !b ? a : (b.failures > a.failures || (b.failures === a.failures && b.until > a.until) ? b : a);

/**
 * The attempt record in localStorage. Storage is the shared truth (another tab's correct PIN clears
 * it for every tab); only while a write fails (private mode, quota) does an in-page copy keep
 * counting, so a failed save can never reset the backoff.
 */
export function localLockoutStore(key = 'pf.table.lockout'): LockoutStore {
  return {
    get() {
      let saved: Lockout | null = null;
      try {
        const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Lockout | null;
        saved = v && Number.isFinite(v.failures) && Number.isFinite(v.until) ? v : null;
      } catch { /* unreadable: only an unsaved copy can count */ }
      return unsaved.has(key) ? stronger(saved, unsaved.get(key) ?? null) : saved;
    },
    set(v) {
      try {
        if (v) localStorage.setItem(key, JSON.stringify(v)); else localStorage.removeItem(key);
        unsaved.delete(key);
      } catch { unsaved.set(key, v); }
    },
  };
}
