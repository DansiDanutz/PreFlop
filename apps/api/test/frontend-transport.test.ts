import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import * as S from '@preflop/client/schemas';
import { buildApp, redactUrl } from '../src/app.ts';
import { tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, bet, harness, ownedOrg } from './helpers.ts';

/** WebSocket stream auth, API security headers, log redaction, partner widget settings, client response schemas. */
let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await harness('frontend_transport');
  await tx(h.db, (c) => seedAdmin(c, 'admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'admin@test.dev', password: 'admin-pass-1' })).body.token;
});
afterAll(async () => h?.close());

type Frame = { type: string; [k: string]: unknown };
async function socket(path = '/v1/stream') {
  const ws = await (h.app as FastifyInstance & { injectWS: (path: string) => Promise<WebSocket> }).injectWS(path);
  const frames: Frame[] = [];
  ws.on('message', (b: Buffer) => frames.push(JSON.parse(b.toString()) as Frame));
  const until = async (pred: (f: Frame) => boolean, ms = 3000): Promise<Frame | undefined> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const f = frames.find(pred);
      if (f) return f;
      await new Promise((r) => setTimeout(r, 20));
    }
    return undefined;
  };
  return { ws, frames, until, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

async function openRound() {
  await h.sim.heartbeat();
  await h.work();
  const n = await h.sim.openHand();
  if (n === null) throw new Error('no open round');
  return `sim-1:h${n}`;
}

describe('WS /v1/stream authentication', () => {
  it('ignores a ?token= in the URL and delivers private events only after first-frame auth', async () => {
    const p = await h.register('Streamer');
    const other = await h.register('Bystander');
    const roundId = await openRound();

    const viaQuery = await socket(`/v1/stream?token=${encodeURIComponent(p.token)}`);
    viaQuery.send({ subscribe: ['table:sim-1'] });

    const viaFrame = await socket();
    viaFrame.send({ type: 'auth', token: p.token });
    viaFrame.send({ subscribe: ['table:sim-1'] });
    expect(await viaFrame.until((f) => f.type === 'auth')).toMatchObject({ ok: true });
    await viaFrame.until((f) => f.type === 'subscribed');
    await viaQuery.until((f) => f.type === 'subscribed');

    const res = await bet(h, p.token, roundId, 'paired-board:yes', 100);
    expect(res.status).toBe(201);
    const mine = await viaFrame.until((f) => f.type === 'bet.accepted');
    expect(mine).toMatchObject({ type: 'bet.accepted', round_id: roundId, data: { betId: res.body.bet_id } });
    // The query-string socket is anonymous: no private events, ever.
    await new Promise((r) => setTimeout(r, 150));
    expect(viaQuery.frames.some((f) => f.type.startsWith('bet.'))).toBe(false);

    // Another player's bet never reaches this socket.
    await bet(h, other.token, roundId, 'paired-board:no', 100);
    await new Promise((r) => setTimeout(r, 150));
    expect(viaFrame.frames.filter((f) => f.type === 'bet.accepted')).toHaveLength(1);
    viaQuery.ws.terminate();
    viaFrame.ws.terminate();
  });

  it('accepts auth only as the first frame, refuses bad tokens, and keeps public topics working', async () => {
    const p = await h.register('Late');
    const late = await socket();
    late.send({ subscribe: ['lobby'] });
    await late.until((f) => f.type === 'subscribed');
    late.send({ type: 'auth', token: p.token });
    expect(await late.until((f) => f.type === 'auth')).toMatchObject({ ok: false });

    const bad = await socket();
    bad.send({ type: 'auth', token: 'not-a-session' });
    expect(await bad.until((f) => f.type === 'auth')).toMatchObject({ ok: false });

    // Public round events still flow to the anonymous sockets.
    const roundId = await openRound();
    await h.sim.playHand(Number(roundId.split(':h')[1]));
    await h.work();
    expect(await late.until((f) => f.type.startsWith('round.'), 5000)).toBeDefined();
    late.ws.terminate();
    bad.ws.terminate();
  });
});

describe('API security headers', () => {
  it('sets nosniff, no-store, no-referrer and a deny-all CSP on every answer', async () => {
    const p = await h.register('Headers');
    for (const [url, token] of [['/v1/health', undefined], ['/v1/me/wallets', p.token], ['/v1/me/wallets', undefined], ['/v1/nope', undefined]] as const) {
      const r = await h.app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
      expect(r.headers['x-content-type-options'], url).toBe('nosniff');
      expect(r.headers['cache-control'], url).toBe('no-store');
      expect(r.headers['referrer-policy'], url).toBe('no-referrer');
      expect(r.headers['x-frame-options'], url).toBe('DENY');
      expect(String(r.headers['content-security-policy']), url).toContain("default-src 'none'");
    }
  });

  it('never logs a token sent in the query string', async () => {
    expect(redactUrl('/v1/stream?token=abc&x=1')).toBe('/v1/stream?token=[redacted]&x=1');
    expect(redactUrl('/a?x=1&client_secret=s3cr3t')).toBe('/a?x=1&client_secret=[redacted]');
    const stream = new PassThrough();
    let out = '';
    stream.on('data', (b: Buffer) => { out += b.toString(); });
    const app = await buildApp(h.db, h.config, { logStream: stream });
    await app.inject({ method: 'GET', url: '/v1/health?token=super-secret-session' });
    await app.close();
    expect(out).toContain('/v1/health?token=[redacted]');
    expect(out).not.toContain('super-secret-session');
  });
});

describe('partner widget settings', () => {
  let org: string;
  let owner: { token: string; email: string };
  beforeAll(async () => {
    const email = `widget-${Date.now()}@test.dev`;
    const r = await h.api('POST', '/v1/auth/register', undefined, { email, password: 'correct horse', display_name: 'Widget owner' });
    owner = { token: r.body.token, email };
    org = await ownedOrg(h, admin, { kind: 'partner', name: 'Widget Partner' }, owner);
  });
  const put = (settings: unknown) => h.api('PUT', `/v1/org/${org}/widget`, owner.token, { settings });

  it('validates accent, markets, stakes and the default table', async () => {
    expect((await put({ accent: 'red' })).status).toBe(400);
    expect((await put({ accent: '#12345' })).status).toBe(400);
    expect((await put({ markets: ['no-such-market'] })).status).toBe(400);
    expect((await put({ markets: ['hand-class', 'hand-class'] })).status).toBe(400);
    expect((await put({ stake_presets: [0] })).status).toBe(400);
    expect((await put({ stake_presets: [1.5] })).status).toBe(400);
    expect((await put({ stake_presets: [1, 2, 3, 4, 5, 6] })).status).toBe(400);
    expect((await put({ default_table_id: 'missing-table' })).status).toBe(422);
    expect((await put({ default_table: 'sim-1' })).status).toBe(400); // unknown key
  });

  it('saves valid settings and builds the snippet from default_table_id and the saved params', async () => {
    const r = await put({ accent: '#ff8800', default_table_id: 'sim-1', markets: ['hand-class', 'colour'], stake_presets: [10, 50, 200] });
    expect(r.status).toBe(200);
    const g = await h.api('GET', `/v1/org/${org}/widget`, owner.token);
    expect(g.body.settings).toMatchObject({ accent: '#ff8800', default_table_id: 'sim-1' });
    const src = /src="([^"]+)"/.exec(g.body.snippet as string)![1]!.replace(/&amp;/g, '&');
    const u = new URL(src);
    expect(u.pathname).toBe('/embed/table/sim-1');
    expect(u.searchParams.get('accent')).toBe('#ff8800');
    expect(u.searchParams.get('markets')).toBe('hand-class,colour');
    expect(u.searchParams.get('stakes')).toBe('10,50,200');
    expect(u.searchParams.has('token')).toBe(false);
    expect(u.hash).toBe('#token=PLAYER_SESSION_TOKEN');
  });
});

describe('client response schemas match the API', () => {
  it('accepts real wallets, me, bets, stats and payments responses', async () => {
    const p = await h.register('Contract');
    const roundId = await openRound();
    const placed = await bet(h, p.token, roundId, 'paired-board:yes', 100);
    expect(S.betViewSchema.safeParse(placed.body).error?.issues).toBeUndefined();
    const check = async (url: string, schema: { safeParse: (d: unknown) => { success: boolean; error?: { issues: unknown } } }) => {
      const r = await h.api('GET', url, p.token);
      expect(r.status, url).toBe(200);
      expect(schema.safeParse(r.body).error?.issues, url).toBeUndefined();
    };
    await check('/v1/me', S.meSchema);
    await check('/v1/me/wallets', S.walletsSchema);
    await check('/v1/me/bets', S.myBetsSchema);
    await check('/v1/me/stats', S.myStatsSchema);
    await check('/v1/me/payments', S.paymentsSchema);
    await check('/v1/tournaments', S.tournamentsSchema);
    const reset = await h.api('POST', '/v1/me/play/reset', p.token, {});
    expect(S.balanceSchema.safeParse(reset.body).success).toBe(true);
  });

  it('accepts real tournament entry, bet and dashboard responses', async () => {
    const p = await h.register('Contestant');
    const t = (await h.api('POST', '/v1/admin/tournaments', admin, {
      name: 'Contract cup', mode: 'play', currency: 'PLAY', buy_in_minor: 1_000, fee_bps: 0, starting_stack: 10_000, bets_allowed: 5,
      min_stake: 100, starts_at: new Date(Date.now() - 30_000).toISOString(), duration_minutes: 30, late_reg_minutes: 20, payout_bps: [10_000], min_entries: 1,
    })).body;
    expect(S.tournamentSchema.safeParse(t).error?.issues).toBeUndefined();
    const reg = await h.api('POST', `/v1/tournaments/${t.id}/register`, p.token);
    expect(S.tournamentDetailSchema.safeParse(reg.body).error?.issues).toBeUndefined();
    const roundId = await openRound();
    const book = (await h.api('GET', '/v1/book')).body;
    const sel = book.markets.flatMap((m: any) => m.selections).find((s: any) => s.id === 'paired-board:no');
    const b = await h.api('POST', `/v1/tournaments/${t.id}/bets`, p.token, { round_id: roundId, selection_id: sel.id, stake: 1_000, odds_centi: sel.odds_centi, idempotency_key: `contract-${Date.now()}` });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(S.tournamentBetSchema.safeParse(b.body).error?.issues).toBeUndefined();
    const d = await h.api('GET', `/v1/tournaments/${t.id}`, p.token);
    expect(d.body.you.bets).toHaveLength(1);
    expect(S.tournamentDetailSchema.safeParse(d.body).error?.issues).toBeUndefined();
    const list = await h.api('GET', '/v1/tournaments', p.token);
    expect(S.tournamentsSchema.safeParse(list.body).error?.issues).toBeUndefined();
  });
});
