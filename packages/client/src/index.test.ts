import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, connectStream, createClient, parseResponse, parseStreamFrame } from './index.ts';

const wallet = { mode: 'play', currency: 'PLAY', balance_minor: 10_000, org_id: null, org_name: null };
const bet = { bet_id: 'bet_1', round_id: 'sim-1:h1', selection_id: 'hand-class:pair', stake_minor: 100, odds_centi: 550, potential_payout_minor: 550, mode: 'play', currency: 'PLAY', status: 'accepted' };

function respond(status: number, body: string, statusText = '') {
  const fetchMock = vi.fn(async () => new Response(body, { status, statusText }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

async function apiError(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}

describe('responses that are not JSON', () => {
  it('a proxy HTML 502 becomes an ApiError, not a SyntaxError', async () => {
    respond(502, '<html><body><h1>502 Bad Gateway</h1></body></html>', 'Bad Gateway');
    const e = await apiError(createClient({ baseUrl: 'https://api.test' }).lobby());
    expect(e.status).toBe(502);
    expect(e.type).toBe('http_error');
    expect(e.message).toBe('Bad Gateway');
  });

  it('a 200 with an HTML body (SPA fallback, captive portal) is invalid_response', async () => {
    respond(200, '<!doctype html><title>Login to Wi-Fi</title>');
    const e = await apiError(createClient({ baseUrl: 'https://api.test' }).wallets());
    expect(e.type).toBe('invalid_response');
  });

  it('a problem+json error keeps its type, and 401 still signs out', async () => {
    respond(401, JSON.stringify({ type: 'unauthorized', title: 'sign in', status: 401 }));
    const onUnauthorized = vi.fn();
    const e = await apiError(createClient({ baseUrl: 'https://api.test', onUnauthorized }).me());
    expect(e.type).toBe('unauthorized');
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('a JSON error body without a problem type falls back to http_error', () => {
    expect(() => parseResponse(500, 'Internal Server Error', '"oops"')).toThrow(ApiError);
    try { parseResponse(500, '', '[1,2]'); } catch (e) { expect((e as ApiError).problem).toMatchObject({ type: 'http_error', title: 'HTTP 500', status: 500 }); }
  });
});

describe('money-bearing responses are validated', () => {
  it('accepts well-formed wallets and bets, extra fields included', async () => {
    respond(200, JSON.stringify({ wallets: [{ ...wallet, new_field: 1 }] }));
    const c = createClient({ baseUrl: 'https://api.test' });
    expect((await c.wallets()).wallets[0]?.balance_minor).toBe(10_000);
    respond(201, JSON.stringify(bet));
    expect((await c.placeBet({ round_id: 'sim-1:h1', selection_id: 'hand-class:pair', stake_minor: 100, odds_centi: 550 })).bet_id).toBe('bet_1');
  });

  it.each([
    ['a balance as a string', { wallets: [{ ...wallet, balance_minor: '10000' }] }],
    ['a fractional balance', { wallets: [{ ...wallet, balance_minor: 10.5 }] }],
    ['a missing currency', { wallets: [{ mode: 'play', balance_minor: 1 }] }],
    ['an unknown mode', { wallets: [{ ...wallet, mode: 'casino' }] }],
    ['no wallets array', { wallet }],
  ])('rejects %s with invalid_response', async (_, body) => {
    respond(200, JSON.stringify(body));
    const e = await apiError(createClient({ baseUrl: 'https://api.test' }).wallets());
    expect(e.type).toBe('invalid_response');
    expect(e.problem.issues).toBeInstanceOf(Array);
  });

  it('rejects a bet response with a negative stake or missing odds', async () => {
    const c = createClient({ baseUrl: 'https://api.test' });
    respond(201, JSON.stringify({ ...bet, stake_minor: -100 }));
    expect((await apiError(c.placeBet({ round_id: 'r', selection_id: 's', stake_minor: 100, odds_centi: 550 }))).type).toBe('invalid_response');
    const { odds_centi: _, ...noOdds } = bet;
    respond(201, JSON.stringify(noOdds));
    expect((await apiError(c.placeBet({ round_id: 'r', selection_id: 's', stake_minor: 100, odds_centi: 550 }))).type).toBe('invalid_response');
  });

  it('validates bet lists, payments and tournament numbers', async () => {
    const c = createClient({ baseUrl: 'https://api.test' });
    respond(200, JSON.stringify({ bets: [{ ...bet, payout_minor: 'lots', placed_at: 'x', settled_at: null, hand_no: 1, table_id: 't', table_name: 'T', flop: null }] }));
    expect((await apiError(c.myBets())).type).toBe('invalid_response');
    respond(200, JSON.stringify({ payments: [{ id: 'p', kind: 'deposit', method: 'card', currency: 'EUR', amount_minor: null, status: 'ok', created_at: 'x' }] }));
    expect((await apiError(c.payments())).type).toBe('invalid_response');
    respond(200, JSON.stringify({ tournaments: [{ id: 't', mode: 'play', currency: 'PLAY', prize_pool_minor: '5' }], server_time: 'x' }));
    expect((await apiError(c.tournaments())).type).toBe('invalid_response');
  });

  it('leaves endpoints without a schema unchecked', async () => {
    respond(200, JSON.stringify({ anything: true }));
    expect(await createClient({ baseUrl: 'https://api.test' }).lobby()).toEqual({ anything: true });
  });
});

describe('stream', () => {
  it('parses frames and drops what is not an event', () => {
    expect(parseStreamFrame('{"type":"round.opened","data":{"a":1},"at":1}')).toMatchObject({ type: 'round.opened', data: { a: 1 } });
    expect(parseStreamFrame('{"type":"hello","user":false}')).toMatchObject({ type: 'hello', data: {} });
    expect(parseStreamFrame('not json')).toBeNull();
    expect(parseStreamFrame('{"data":{}}')).toBeNull();
    expect(parseStreamFrame('{"type":"x","data":"str"}')).toBeNull();
    expect(parseStreamFrame('null')).toBeNull();
  });

  it('keeps the token out of the URL and sends it as the first frame', () => {
    const sockets: FakeWs[] = [];
    class FakeWs {
      sent: string[] = [];
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((m: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      constructor(readonly url: string) { sockets.push(this); }
      send(s: string) { this.sent.push(s); }
      close() { this.onclose?.(); }
    }
    vi.stubGlobal('WebSocket', FakeWs);
    const events: unknown[] = [];
    const s = connectStream({ url: 'wss://api.test/v1/stream', topics: ['table:t1'], token: 'sess-secret', onEvent: (e) => events.push(e) });
    const ws = sockets[0]!;
    expect(ws.url).toBe('wss://api.test/v1/stream');
    expect(ws.url).not.toContain('sess-secret');
    ws.readyState = 1;
    ws.onopen?.();
    expect(ws.sent.map((x) => JSON.parse(x))).toEqual([{ type: 'auth', token: 'sess-secret' }, { subscribe: ['table:t1'] }]);
    ws.onmessage?.({ data: '<html>' });
    ws.onmessage?.({ data: '{"type":"bet.settled","data":{"betId":"b"}}' });
    expect(events).toEqual([{ type: 'bet.settled', data: { betId: 'b' } }]);
    s.close();
  });

  it('sends no auth frame without a token', () => {
    const sent: string[] = [];
    class FakeWs { readyState = 1; onopen: (() => void) | null = null; onmessage = null; onclose: (() => void) | null = null; constructor(readonly url: string) { queueMicrotask(() => this.onopen?.()); } send(x: string) { sent.push(x); } close() { /* closed */ } }
    vi.stubGlobal('WebSocket', FakeWs);
    const s = connectStream({ url: 'wss://api.test/v1/stream', topics: ['lobby'], onEvent: () => {} });
    return Promise.resolve().then(() => {
      expect(sent.map((x) => JSON.parse(x))).toEqual([{ subscribe: ['lobby'] }]);
      s.close();
    });
  });
});
