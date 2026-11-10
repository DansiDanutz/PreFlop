import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchIdle, watchStorageKey } from './session.ts';

/** A storage event as a browser delivers it to the other tabs of the same origin. */
const storageEvent = (key: string | null, newValue: string | null) => Object.assign(new Event('storage'), { key, newValue });

describe('watchStorageKey', () => {
  it('reports a change another tab made to the key, including its removal', () => {
    const target = new EventTarget();
    const seen: (string | null)[] = [];
    watchStorageKey(target, 'pf.token', (v) => seen.push(v));
    target.dispatchEvent(storageEvent('pf.token', 'abc'));
    target.dispatchEvent(storageEvent('pf.token', null));
    expect(seen).toEqual(['abc', null]);
  });

  it('ignores other keys, treats a cleared storage as a removal, and stops when asked', () => {
    const target = new EventTarget();
    const seen: (string | null)[] = [];
    const stop = watchStorageKey(target, 'pf.token', (v) => seen.push(v));
    target.dispatchEvent(storageEvent('pf.stake', '10'));
    target.dispatchEvent(storageEvent(null, null)); // localStorage.clear() in another tab
    stop();
    target.dispatchEvent(storageEvent('pf.token', 'late'));
    expect(seen).toEqual([null]);
  });
});

describe('watchIdle', () => {
  const MINUTE = 60_000;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires once after the timeout without activity', () => {
    const onIdle = vi.fn();
    watchIdle({ timeoutMs: 30 * MINUTE, onIdle, target: new EventTarget() });
    vi.advanceTimersByTime(30 * MINUTE - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120 * MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('activity postpones it by the full timeout', () => {
    const onIdle = vi.fn();
    const target = new EventTarget();
    watchIdle({ timeoutMs: 30 * MINUTE, onIdle, target });
    vi.advanceTimersByTime(20 * MINUTE);
    target.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(29 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('activity in another tab, shared through storage, counts too', () => {
    const onIdle = vi.fn();
    let sharedAt: number | null = null;
    const shared = { read: () => sharedAt, write: (at: number) => { sharedAt = at; } };
    const here = new EventTarget();
    watchIdle({ timeoutMs: 30 * MINUTE, onIdle, target: here, shared });
    vi.advanceTimersByTime(25 * MINUTE);
    sharedAt = Date.now(); // the other tab was used just now
    vi.advanceTimersByTime(10 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20 * MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
    // And this tab publishes its own activity for the others.
    const other = { read: () => sharedAt, write: vi.fn() };
    const tab = new EventTarget();
    watchIdle({ timeoutMs: 30 * MINUTE, onIdle: vi.fn(), target: tab, shared: other });
    vi.advanceTimersByTime(MINUTE);
    tab.dispatchEvent(new Event('pointerdown'));
    expect(other.write).toHaveBeenCalledWith(Date.now());
  });

  it('stops watching when asked', () => {
    const onIdle = vi.fn();
    const stop = watchIdle({ timeoutMs: 30 * MINUTE, onIdle, target: new EventTarget() });
    stop();
    vi.advanceTimersByTime(60 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
