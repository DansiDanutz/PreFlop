import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectStream } from './index.ts';

class FakeWs {
  static all: FakeWs[] = [];
  readyState = 0;
  sent: string[] = [];
  closeCalls = 0;
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) { FakeWs.all.push(this); }
  send(x: string) { this.sent.push(x); }
  close() { this.closeCalls++; this.readyState = 3; }
  /** The server or the network drops the connection. */
  drop() { this.readyState = 3; this.onclose?.(); }
  accept() { this.readyState = 1; this.onopen?.(); }
}

beforeEach(() => {
  FakeWs.all = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWs);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a disposed stream never reconnects', () => {
  it('reconnects with backoff after a drop while it is in use', () => {
    const status: string[] = [];
    const s = connectStream({ url: 'wss://api.test/v1/stream', topics: ['lobby'], onEvent: () => {}, onStatus: (x) => status.push(x) });
    FakeWs.all[0]!.accept();
    FakeWs.all[0]!.drop();
    expect(FakeWs.all).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(FakeWs.all).toHaveLength(2);
    expect(status).toEqual(['open', 'closed']);
    s.close();
  });

  it('disconnect, then close() during the backoff, then the timer fires: no new socket', () => {
    const s = connectStream({ url: 'wss://api.test/v1/stream', topics: ['lobby'], onEvent: () => {} });
    FakeWs.all[0]!.accept();
    FakeWs.all[0]!.drop(); // reconnect scheduled
    s.close(); // unmount / logout while waiting
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.all).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logout or a token change during the backoff: the old stream stays dead, only the new one connects', () => {
    const old = connectStream({ url: 'wss://api.test/v1/stream', topics: ['table:t1'], token: 'old-token', onEvent: () => {} });
    FakeWs.all[0]!.accept();
    FakeWs.all[0]!.drop();
    // useStream re-runs its effect: close the old stream, open one with the new token (or none).
    old.close();
    const fresh = connectStream({ url: 'wss://api.test/v1/stream', topics: ['table:t1'], token: 'new-token', onEvent: () => {} });
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.all).toHaveLength(2);
    const sock = FakeWs.all[1]!;
    sock.accept();
    expect(sock.sent.map((x) => JSON.parse(x))[0]).toEqual({ type: 'auth', token: 'new-token' });
    // No socket opened after the logout ever sent the old token.
    expect(FakeWs.all.slice(1).some((w) => w.sent.some((x) => x.includes('old-token')))).toBe(false);
    fresh.close();
  });

  it('a socket that opens after close() is shut and sends nothing (no stale auth frame)', () => {
    const status: string[] = [];
    const s = connectStream({ url: 'wss://api.test/v1/stream', topics: ['lobby'], token: 't', onEvent: () => {}, onStatus: (x) => status.push(x) });
    const sock = FakeWs.all[0]!;
    s.close();
    sock.accept(); // a late open event
    expect(sock.sent).toEqual([]);
    expect(status).toEqual([]);
    sock.onclose?.();
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.all).toHaveLength(1);
  });

  it('messages that arrive after close() are dropped', () => {
    const events: unknown[] = [];
    const s = connectStream({ url: 'wss://api.test/v1/stream', topics: ['lobby'], onEvent: (e) => events.push(e) });
    const sock = FakeWs.all[0]!;
    sock.accept();
    s.close();
    sock.onmessage?.({ data: '{"type":"round.locked","data":{}}' });
    expect(events).toEqual([]);
  });
});

describe('a half-open connection is noticed and replaced', () => {
  const start = (status: string[] = []) => connectStream({ url: 'wss://api.test/v1/stream', topics: ['lobby'], onEvent: () => {}, onStatus: (x) => status.push(x) });

  it('probes a quiet socket and reconnects when nothing comes back', () => {
    const status: string[] = [];
    const s = start(status);
    const first = FakeWs.all[0]!;
    first.accept();
    const sentAfterOpen = first.sent.length;
    vi.advanceTimersByTime(25_000);
    expect(first.sent.length).toBe(sentAfterOpen + 1); // the probe: a re-subscribe the server always answers
    vi.advanceTimersByTime(5_000); // no answer: the socket never fired onclose, yet it is dead
    expect(first.closeCalls).toBe(1);
    expect(status).toEqual(['open', 'closed']);
    vi.advanceTimersByTime(1_000);
    expect(FakeWs.all).toHaveLength(2);
    s.close();
  });

  it('keeps a socket that answers its probe', () => {
    const status: string[] = [];
    const s = start(status);
    const first = FakeWs.all[0]!;
    first.accept();
    vi.advanceTimersByTime(25_000);
    first.onmessage?.({ data: JSON.stringify({ type: 'subscribed', topics: ['lobby'] }) });
    vi.advanceTimersByTime(20_000);
    expect(first.closeCalls).toBe(0);
    expect(FakeWs.all).toHaveLength(1);
    expect(status).toEqual(['open']);
    s.close();
  });

  it('close() stops the probes', () => {
    const s = start();
    const first = FakeWs.all[0]!;
    first.accept();
    s.close();
    const sent = first.sent.length;
    vi.advanceTimersByTime(120_000);
    expect(first.sent.length).toBe(sent);
    expect(FakeWs.all).toHaveLength(1);
  });
});

describe('reconnect timing', () => {
  it('spreads reconnects: the wait is between half and all of the backoff step', () => {
    const waitFor = (random: number): number => {
      FakeWs.all = [];
      vi.spyOn(Math, 'random').mockReturnValue(random);
      const s = connectStream({ url: 'wss://api.test/v1/stream', topics: ['lobby'], onEvent: () => {} });
      FakeWs.all[0]!.accept();
      FakeWs.all[0]!.drop();
      let waited = 0;
      while (FakeWs.all.length < 2 && waited < 5_000) { vi.advanceTimersByTime(10); waited += 10; }
      s.close();
      vi.restoreAllMocks();
      return waited;
    };
    expect(waitFor(0)).toBe(500);
    expect(waitFor(0.999)).toBe(1_000);
  });

  it('reconnects at once when the browser comes back online during the backoff', () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('addEventListener', (type: string, fn: () => void) => listeners.set(type, fn));
    vi.stubGlobal('removeEventListener', (type: string) => listeners.delete(type));
    const s = connectStream({ url: 'wss://api.test/v1/stream', topics: ['lobby'], onEvent: () => {} });
    FakeWs.all[0]!.accept();
    FakeWs.all[0]!.drop();
    expect(FakeWs.all).toHaveLength(1);
    listeners.get('online')!();
    expect(FakeWs.all).toHaveLength(2);
    s.close();
    expect(listeners.has('online')).toBe(false);
  });
});
