import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiProblem, TableApi } from '../src/lib/api.ts';
import { generateCredentialKey } from '../src/lib/envelope.ts';
import type { Identity } from '../src/lib/keystore.ts';
import { setSigningGate } from '../src/lib/lock.ts';

const SKEW_MS = 30_000;
/** The server's clock runs this far ahead of the tablet's. */
const AHEAD_MS = 5 * 60_000;

let id: Identity;
beforeAll(async () => {
  const keys = await generateCredentialKey();
  id = { keys, config: { apiUrl: 'https://api.test', tableId: 't1', personId: 'Ana', role: 'floor_manager', credentialId: 'cred-1', publicKeyPem: '', fingerprint: '', createdAt: 0 } };
});
afterEach(() => { vi.unstubAllGlobals(); setSigningGate(() => true); });

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const stale = () => json({ type: 'stale_request', title: 'timestamp outside the 30 s window', status: 401 }, 401);
const tsOf = (init: RequestInit | undefined) => Number(/ts=(\d+)/.exec((init?.headers as Record<string, string>)['x-preflop-auth']!)![1]);
const nonceOf = (init: RequestInit | undefined) => /nonce=([^,]+)/.exec((init?.headers as Record<string, string>)['x-preflop-auth']!)![1];

/** A fake server whose clock is AHEAD_MS ahead; it checks signed timestamps like the real one. */
function server(o: { health?: (now: number) => Response } = {}) {
  const calls: { url: string; init?: RequestInit | undefined }[] = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const now = Date.now() + AHEAD_MS;
    if (String(url).endsWith('/v1/health')) return o.health ? o.health(now) : json({ ok: true, time: new Date(now).toISOString() });
    if (Math.abs(now - tsOf(init)) > SKEW_MS) return stale();
    // Each write answers with its own acknowledgement (lib/api.ts isAck).
    if (String(url).endsWith('/pause')) return json({ status: 'paused' });
    if (String(url).endsWith('/resume')) return json({ status: 'active' });
    return json({ state: 'VOID' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls, signed: () => calls.filter((c) => !c.url.endsWith('/v1/health')) };
}

describe('stale_request: re-sync the clock, then retry once', () => {
  it('re-syncs from /v1/health and the retry succeeds, keeping the Idempotency-Key and body', async () => {
    const s = server();
    const api = new TableApi(id);
    const seen: number[] = [];
    api.onClockSync = (o) => seen.push(o);
    const a = api.voidHand(4, 'misdeal');
    await expect(api.send(a)).resolves.toEqual({ state: 'VOID' });
    const signed = s.signed();
    expect(signed).toHaveLength(2);
    expect(s.calls.filter((c) => c.url.endsWith('/v1/health'))).toHaveLength(1);
    // Same action, fresh signature.
    for (const c of signed) {
      expect((c.init!.headers as Record<string, string>)['idempotency-key']).toBe(a.key);
      expect(c.init!.body).toBe(a.body);
    }
    expect(nonceOf(signed[0]!.init)).not.toBe(nonceOf(signed[1]!.init));
    expect(tsOf(signed[1]!.init) - tsOf(signed[0]!.init)).toBeGreaterThan(AHEAD_MS - 2_000);
    expect(api.clockOffsetMs).toBeGreaterThan(AHEAD_MS - 2_000);
    expect(seen).toEqual([api.clockOffsetMs]);
  });

  it('later requests are signed with the corrected clock (no stale round-trip)', async () => {
    const s = server();
    const api = new TableApi(id);
    await api.send(api.pause('dealer change'));
    s.calls.length = 0;
    await api.send(api.resume());
    expect(s.signed()).toHaveLength(1);
  });

  it('falls back to the HTTP Date header when the health body has no time', async () => {
    const s = server({ health: (now) => json({ ok: true }, 200, { date: new Date(now).toUTCString() }) });
    const api = new TableApi(id);
    await expect(api.send(api.resume())).resolves.toEqual({ status: 'active' });
    expect(s.signed()).toHaveLength(2);
  });

  it('shows stale_request only when the retry is refused too', async () => {
    // Health reports the tablet's own (wrong) time, so the re-sync cannot fix anything.
    const s = server({ health: () => json({ ok: true, time: new Date().toISOString() }) });
    const api = new TableApi(id);
    const err = await api.send(api.resume()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiProblem);
    expect((err as ApiProblem).type).toBe('stale_request');
    expect((err as ApiProblem).message).toMatch(/even after re-syncing/);
    expect(s.signed()).toHaveLength(2); // exactly one retry, never a loop
  });

  it('keeps the original problem when the server time cannot be read', async () => {
    const s = server({ health: () => new Response('down', { status: 503 }) });
    const api = new TableApi(id);
    const err = await api.state().catch((e: unknown) => e);
    expect((err as ApiProblem).type).toBe('stale_request');
    expect(s.signed()).toHaveLength(1);
    expect(api.clockOffsetMs).toBe(0);
  });

  it('does not re-sync or retry other refusals', async () => {
    const fetchMock = vi.fn(async () => json({ type: 'credential_revoked', status: 401 }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const api = new TableApi(id);
    await expect(api.send(api.resume())).rejects.toMatchObject({ type: 'credential_revoked' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('concurrent stale requests share one clock measurement', async () => {
    const s = server();
    const api = new TableApi(id);
    await Promise.all([api.state().catch(() => null), api.send(api.resume()), api.send(api.pause('other'))]);
    expect(s.calls.filter((c) => c.url.endsWith('/v1/health'))).toHaveLength(1);
  });

  it('a locked tablet neither signs nor retries', async () => {
    const s = server();
    setSigningGate(() => false);
    const api = new TableApi(id);
    await expect(api.send(api.resume())).rejects.toMatchObject({ type: 'tablet_locked' });
    expect(s.fetchMock).not.toHaveBeenCalled();
  });
});
