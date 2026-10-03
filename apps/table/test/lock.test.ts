import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem, TableApi } from '../src/lib/api.ts';
import { generateCredentialKey } from '../src/lib/envelope.ts';
import type { Identity } from '../src/lib/keystore.ts';
import { FREE_TRIES, type Lockout, type LockoutStore, TabletLock, backoffMs, localLockoutStore, setSigningGate, signingAllowed } from '../src/lib/lock.ts';
import { type PinRecord, hashPin, pinProblem, verifyPin } from '../src/lib/pin.ts';
import { isRetryable } from '../src/lib/problems.ts';

const FAST = { iterations: 1_000 };
const MIN = 60_000;

function memoryStore(): LockoutStore & { v: Lockout | null } {
  const s = { v: null as Lockout | null, get: () => s.v, set: (v: Lockout | null) => { s.v = v; } };
  return s;
}

describe('PIN', () => {
  it('accepts 6–8 digits that are not trivially guessable', () => {
    expect(pinProblem('402817')).toBeNull();
    expect(pinProblem('40281739')).toBeNull();
    expect(pinProblem('4028')).toMatch(/6 to 8/);
    expect(pinProblem('402817391')).toMatch(/6 to 8/);
    expect(pinProblem('40a817')).toMatch(/digits only/);
    expect(pinProblem('111111')).toMatch(/same/);
    expect(pinProblem('123456')).toMatch(/run/);
    expect(pinProblem('876543')).toMatch(/run/);
  });

  it('stores only a salted PBKDF2-SHA-256 hash and verifies it', async () => {
    const rec = await hashPin('402817', FAST);
    expect(rec).toMatchObject({ v: 1, alg: 'PBKDF2-SHA-256', iterations: 1_000 });
    expect(JSON.stringify(rec)).not.toContain('402817');
    expect(atob(rec.salt)).toHaveLength(16);
    expect(atob(rec.hash)).toHaveLength(32);
    expect(await verifyPin('402817', rec)).toBe(true);
    expect(await verifyPin('402818', rec)).toBe(false);
    expect(await verifyPin('402817', { ...rec, alg: 'MD5' as 'PBKDF2-SHA-256' })).toBe(false);
  });

  it('salts every hash', async () => {
    const [a, b] = [await hashPin('402817', FAST), await hashPin('402817', FAST)];
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    const fixed = new Uint8Array(16).fill(7);
    expect((await hashPin('402817', { ...FAST, salt: fixed })).hash).toBe((await hashPin('402817', { ...FAST, salt: fixed })).hash);
  });

  it('defaults to a strong iteration count', async () => {
    const { PIN_ITERATIONS } = await import('../src/lib/pin.ts');
    expect(PIN_ITERATIONS).toBeGreaterThanOrEqual(200_000);
  });
});

describe('tablet lock', () => {
  let rec: PinRecord;
  const lockAt = (now = 0, o: Partial<{ locked: boolean; store: LockoutStore }> = {}) => new TabletLock({ now, idleMs: 5 * MIN, locked: o.locked ?? false, store: o.store });

  it('locks after the idle time, and activity keeps it awake', () => {
    const l = lockAt(0);
    expect(l.check(4 * MIN)).toBe(false);
    l.activity(4 * MIN);
    expect(l.check(8 * MIN)).toBe(false);
    expect(l.check(9 * MIN)).toBe(true);
    expect(l.locked).toBe(true);
    // Activity while locked does not count (only the PIN unlocks).
    l.activity(9 * MIN + 1);
    expect(l.lastActivity).toBe(4 * MIN);
  });

  it('locks when the tablet comes back to the foreground after being idle (same check)', () => {
    const l = lockAt(0);
    // Hidden at 1 min, timers paused while asleep, visible again at 30 min.
    l.activity(1 * MIN);
    expect(l.check(30 * MIN)).toBe(true);
  });

  it('follows a new idle time', () => {
    const l = lockAt(0);
    l.setIdleMs(2 * MIN);
    expect(l.check(2 * MIN)).toBe(true);
  });

  it('unlocks with the right PIN only', async () => {
    rec = await hashPin('402817', FAST);
    const l = lockAt(0, { locked: true });
    expect(await l.unlock('000000', rec, 1000)).toMatchObject({ ok: false, reason: 'wrong', failures: 1 });
    expect(l.locked).toBe(true);
    expect(await l.unlock('402817', rec, 2000)).toEqual({ ok: true });
    expect(l.locked).toBe(false);
    expect(l.lastActivity).toBe(2000);
    expect(l.failures).toBe(0);
  });

  it('backs off after repeated wrong PINs, and the count survives a reload', async () => {
    rec ??= await hashPin('402817', FAST);
    expect(backoffMs(FREE_TRIES - 1)).toBe(0);
    expect(backoffMs(FREE_TRIES)).toBe(30_000);
    expect(backoffMs(FREE_TRIES + 1)).toBe(60_000);
    expect(backoffMs(99)).toBe(15 * MIN);

    const store = memoryStore();
    const l = lockAt(0, { locked: true, store });
    for (let i = 1; i < FREE_TRIES; i++) expect((await l.unlock('000000', rec, i)).ok).toBe(false);
    expect(l.waitMs(10)).toBe(0);
    const fifth = await l.unlock('000000', rec, 100);
    expect(fifth).toMatchObject({ ok: false, reason: 'wrong', waitMs: 30_000 });
    // Even the right PIN waits.
    expect(await l.unlock('402817', rec, 101)).toMatchObject({ ok: false, reason: 'wait' });
    expect(store.v).toEqual({ failures: FREE_TRIES, until: 30_100 });

    const reloaded = lockAt(200, { locked: true, store });
    expect(reloaded.waitMs(200)).toBe(29_900);
    expect(await reloaded.unlock('402817', rec, 30_100)).toEqual({ ok: true });
    expect(store.v).toBeNull();
  });

  it('keeps counting when the browser refuses to save the attempts (no reset to zero)', async () => {
    rec ??= await hashPin('402817', FAST);
    // Storage that reads nothing and throws on every write (private mode, quota).
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => {} });
    try {
      const l = lockAt(0, { locked: true, store: localLockoutStore('pf.test.nosave') });
      for (let i = 1; i < FREE_TRIES; i++) expect((await l.unlock('000000', rec, i)).ok).toBe(false);
      expect(await l.unlock('000000', rec, 100)).toMatchObject({ ok: false, reason: 'wrong', waitMs: 30_000 });
      expect(await l.unlock('000000', rec, 101)).toMatchObject({ ok: false, reason: 'wait' });
      // A second lock on the same key (e.g. the change-PIN form) sees the same count.
      expect(lockAt(0, { locked: true, store: localLockoutStore('pf.test.nosave') }).failures).toBe(FREE_TRIES);
      expect(await l.unlock('402817', rec, 30_100)).toEqual({ ok: true });
      expect(l.failures).toBe(0);
    } finally { vi.unstubAllGlobals(); }
  });

  it('a correct PIN in another tab clears the count for this tab too', async () => {
    rec ??= await hashPin('402817', FAST);
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } });
    try {
      const tabA = lockAt(0, { locked: true, store: localLockoutStore('pf.test.tabs') });
      const tabB = lockAt(0, { locked: true, store: localLockoutStore('pf.test.tabs') });
      for (let i = 1; i < FREE_TRIES; i++) expect((await tabA.unlock('000000', rec, i)).ok).toBe(false);
      expect(await tabB.unlock('402817', rec, 10)).toEqual({ ok: true });
      // Tab A's next wrong PIN is the first again, not the fifth: no wait.
      expect(await tabA.unlock('000000', rec, 11)).toMatchObject({ ok: false, reason: 'wrong', failures: 1, waitMs: 0 });
    } finally { vi.unstubAllGlobals(); }
  });

  it('a PIN change on an unlocked tablet counts against the same attempts and backoff', async () => {
    rec ??= await hashPin('402817', FAST);
    const store = memoryStore();
    const screen = lockAt(0, { locked: false, store }); // the live lock, unlocked
    const change = lockAt(0, { locked: false, store }); // the change-PIN form's check
    for (let i = 1; i < FREE_TRIES; i++) expect((await change.verify('000000', rec, i)).ok).toBe(false);
    expect(await change.verify('000000', rec, 100)).toMatchObject({ ok: false, reason: 'wrong', waitMs: 30_000 });
    expect(await change.verify('402817', rec, 101)).toMatchObject({ ok: false, reason: 'wait' });
    // The lock screen sees the same count at once, without a reload.
    expect(screen.waitMs(101)).toBe(29_999);
    expect(screen.locked).toBe(false); // verify never unlocks or locks by itself
    expect(await change.verify('402817', rec, 30_100)).toEqual({ ok: true });
    expect(screen.failures).toBe(0);
  });
});

describe('signing gate', () => {
  afterEach(() => { setSigningGate(() => true); vi.unstubAllGlobals(); });

  it('a locked tablet signs nothing: no request leaves, and the action can be retried after unlock', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const keys = await generateCredentialKey();
    const id: Identity = { keys, config: { apiUrl: 'https://api.test', tableId: 't1', personId: 'Ana', role: 'dealer', credentialId: 'cred-1', publicKeyPem: '', fingerprint: '', createdAt: 0 } };
    const api = new TableApi(id);
    const sign = vi.spyOn(crypto.subtle, 'sign');

    let locked = true;
    setSigningGate(() => !locked);
    expect(signingAllowed()).toBe(false);
    const err = await api.send(api.hand(1, 'start', 'Start hand 1')).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApiProblem);
    expect((err as ApiProblem).type).toBe('tablet_locked');
    expect(isRetryable('tablet_locked')).toBe(true);
    await expect(api.state()).rejects.toMatchObject({ type: 'tablet_locked' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();

    locked = false;
    await api.send(api.hand(1, 'start', 'Start hand 1'));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sign).toHaveBeenCalled();
    sign.mockRestore();
  });
});
