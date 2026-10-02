import { price } from '@preflop/odds-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { statsOf } from '../src/bets/service.ts';
import { allocatePrizes, rankEntries, settledStatus, tournamentTick } from '../src/growth/tournaments.ts';
import { verifyAuditChain } from '../src/lib/audit.ts';
import { tx } from '../src/lib/db.ts';
import { balance } from '../src/lib/ledger.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness, ledgerSums, walletOf } from './helpers.ts';

/** Tournaments (docs/17). */

describe('ranking and prizes (pure rules)', () => {
  const at = (s: number) => new Date(1_700_000_000_000 + s * 1000);
  it('ranks by stack, then fewer bets used; the same stack and bets used share the position', () => {
    const r = rankEntries([
      { user_id: 'a', stack: 500, bets_used: 4, created_at: at(1) },
      { user_id: 'b', stack: 900, bets_used: 9, created_at: at(2) },
      { user_id: 'c', stack: 500, bets_used: 2, created_at: at(3) },
      { user_id: 'd', stack: 500, bets_used: 4, created_at: at(4) },
      { user_id: 'e', stack: 0, bets_used: 1, created_at: at(5) },
    ]);
    expect(r.map((x) => [x.user_id, x.rank])).toEqual([['b', 1], ['c', 2], ['a', 3], ['d', 3], ['e', 5]]);
  });

  it('pays every unit: ties split their positions, and fewer entrants than places scale the shares up', () => {
    // a=1, b and c tied at 2 (sharing 30% + 20%), d=4 unpaid.
    const p = allocatePrizes(1001, [5000, 3000, 2000], [{ user_id: 'a', rank: 1 }, { user_id: 'b', rank: 2 }, { user_id: 'c', rank: 2 }, { user_id: 'd', rank: 4 }]);
    expect(Object.fromEntries(p)).toEqual({ a: 501, b: 250, c: 250 });
    // Two entrants, three paid places: 50/30 scaled to 62.5%/37.5%.
    expect(Object.fromEntries(allocatePrizes(800, [5000, 3000, 2000], [{ user_id: 'a', rank: 1 }, { user_id: 'b', rank: 2 }]))).toEqual({ a: 500, b: 300 });
    // A three-way tie for the winner-takes-all prize, odd units go to the earliest entrant.
    expect(Object.fromEntries(allocatePrizes(100, [10_000], [{ user_id: 'x', rank: 1 }, { user_id: 'y', rank: 1 }, { user_id: 'z', rank: 1 }]))).toEqual({ x: 34, y: 33, z: 33 });
    expect(allocatePrizes(0, [10_000], [{ user_id: 'a', rank: 1 }]).size).toBe(0);
  });

  it('an entry is out below the minimum stake and finished once every bet is used', () => {
    expect(settledStatus(0, 3, 100, 10)).toBe('busted');
    expect(settledStatus(99, 3, 100, 10)).toBe('busted');
    expect(settledStatus(500, 10, 100, 10)).toBe('finished');
    expect(settledStatus(500, 3, 100, 10)).toBe('playing');
  });
});

let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await harness('tournaments');
  await tx(h.db, (c) => seedAdmin(c, 'tn-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'tn-admin@test.dev', password: 'admin-pass-1' })).body.token;
});
afterAll(async () => h?.close());

let un = 0;
async function user(name: string) {
  const r = await h.api('POST', '/v1/auth/register', undefined, { email: `${name.toLowerCase()}-${++un}-${Date.now()}@tn.dev`, password: 'correct horse', display_name: name });
  return { token: r.body.token as string, id: r.body.user.id as string };
}
const odds = (sel: string) => price(statsOf(sel), 'direct').oddsCenti;
let k = 0;
const bet = (id: string, token: string, roundId: string, selection: string, stake: number) =>
  h.api('POST', `/v1/tournaments/${id}/bets`, token, { round_id: roundId, selection_id: selection, stake, odds_centi: odds(selection), idempotency_key: `tn-${++k}-${Date.now()}` });

async function openRound(): Promise<{ n: number; id: string }> {
  await h.sim.heartbeat();
  await h.work();
  const n = await h.sim.openHand();
  if (n === null) throw new Error('no open round');
  return { n, id: `sim-1:h${n}` };
}
async function finishRound(n: number) {
  await h.sim.playHand(n);
  await h.work();
}

/** A free-chip tournament that started 30 s ago, with late registration open. */
const running = (over: Record<string, unknown> = {}) => ({
  name: 'Lunch sprint', mode: 'play', currency: 'PLAY', buy_in_minor: 1_000, fee_bps: 0, starting_stack: 10_000, bets_allowed: 5,
  min_stake: 100, starts_at: new Date(Date.now() - 30_000).toISOString(), duration_minutes: 30, late_reg_minutes: 20, payout_bps: [10_000], ...over,
});
const later = () => new Date(Date.now() + 60 * 60_000);

describe('tournament lifecycle', () => {
  it('registration takes the buy-in; leaving before the start refunds it; the cap holds', async () => {
    const t = (await h.api('POST', '/v1/admin/tournaments', admin, running({ name: 'Tomorrow', starts_at: new Date(Date.now() + 86_400_000).toISOString(), max_entries: 2 }))).body;
    expect(t).toMatchObject({ status: 'scheduled', entries: 0, registration_open: true, prize_pool_minor: 0 });
    const [a, b, c] = [await user('Ana'), await user('Bo'), await user('Cy')];
    const before = await walletOf(h, a.token);
    const reg = await h.api('POST', `/v1/tournaments/${t.id}/register`, a.token);
    expect(reg.status).toBe(200);
    expect(reg.body.you).toMatchObject({ stack: 10_000, bets_used: 0, bets_left: 5, status: 'playing' });
    expect(await walletOf(h, a.token)).toBe(before - 1_000);
    expect((await h.api('POST', `/v1/tournaments/${t.id}/register`, a.token)).body.type).toBe('already_registered');
    await h.api('POST', `/v1/tournaments/${t.id}/register`, b.token);
    expect((await h.api('POST', `/v1/tournaments/${t.id}/register`, c.token)).body.type).toBe('tournament_full');
    expect((await h.api('DELETE', `/v1/tournaments/${t.id}/register`, a.token)).body).toEqual({ ok: true, refunded_minor: 1_000 });
    expect(await walletOf(h, a.token)).toBe(before);
    expect((await h.api('GET', `/v1/tournaments/${t.id}`, c.token)).body.tournament).toMatchObject({ entries: 1, prize_pool_minor: 1_000, you: { registered: false } });
  });

  it('bets move the stack and the standings; one bet per flop; a void gives stake and bet back', async () => {
    const t = (await h.api('POST', '/v1/admin/tournaments', admin, running())).body;
    expect(t.status).toBe('running');
    const [a, b] = [await user('Ana'), await user('Bo')];
    const outsider = await user('Out');
    for (const p of [a, b]) expect((await h.api('POST', `/v1/tournaments/${t.id}/register`, p.token)).status).toBe(200);

    const r1 = await openRound();
    expect((await bet(t.id, outsider.token, r1.id, 'paired-board:yes', 100)).body.type).toBe('not_registered');
    expect((await bet(t.id, a.token, r1.id, 'paired-board:no', 50)).body.type).toBe('invalid_stake');
    expect((await bet(t.id, a.token, r1.id, 'paired-board:no', 20_000)).body.type).toBe('stake_too_high');
    expect((await bet(t.id, a.token, r1.id, 'paired-board:no', 3_000)).status).toBe(201);
    expect((await bet(t.id, a.token, r1.id, 'paired-board:yes', 3_000)).body.type).toBe('one_bet_per_flop');
    expect((await bet(t.id, b.token, r1.id, 'paired-board:yes', 3_000)).status).toBe(201);
    const mid = (await h.api('GET', `/v1/tournaments/${t.id}`, a.token)).body;
    expect(mid.you).toMatchObject({ stack: 7_000, bets_used: 1, bets_left: 4, pending_bets: 1 });
    expect(mid.standings.map((s: any) => s.rank)).toEqual([1, 1]); // same stack, same bets used: tied

    await finishRound(r1.n);
    const after = (await h.api('GET', `/v1/tournaments/${t.id}`, a.token)).body;
    const [top, second] = after.standings;
    expect(top.stack).toBeGreaterThan(7_000);
    expect(second).toMatchObject({ stack: 7_000, rank: 2, pending_bets: 0 });
    expect(top.prize_minor).toBe(2_000);

    // The team voids an open flop: stake and bet come back.
    const r2 = await openRound();
    expect((await bet(t.id, a.token, r2.id, 'paired-board:no', 1_000)).status).toBe(201);
    const before = (await h.api('GET', `/v1/tournaments/${t.id}`, a.token)).body.you;
    expect((await h.api('POST', `/v1/admin/rounds/${r2.id}/void`, admin, { reason: 'test void' })).status).toBe(200);
    const restored = (await h.api('GET', `/v1/tournaments/${t.id}`, a.token)).body.you;
    expect(restored).toMatchObject({ stack: before.stack + 1_000, bets_used: before.bets_used - 1, pending_bets: 0 });
    expect(restored.bets.find((x: any) => x.round_id === r2.id).status).toBe('void');
  });

  it('a lost stack is out; every bet used is final; at the end prizes and the fee are paid and the books balance', async () => {
    const t = (await h.api('POST', '/v1/admin/tournaments', admin, running({ name: 'All in', starting_stack: 1_000, min_stake: 1_000, bets_allowed: 1, fee_bps: 1_000, payout_bps: [10_000] }))).body;
    const [a, b] = [await user('Ana'), await user('Bo')];
    const w = { a: await walletOf(h, a.token), b: await walletOf(h, b.token) };
    for (const p of [a, b]) await h.api('POST', `/v1/tournaments/${t.id}/register`, p.token);
    const r = await openRound();
    await bet(t.id, a.token, r.id, 'paired-board:no', 1_000);
    await bet(t.id, b.token, r.id, 'paired-board:yes', 1_000);
    await finishRound(r.n);
    const d = (await h.api('GET', `/v1/tournaments/${t.id}`, a.token)).body;
    expect(d.standings.map((s: any) => s.status).sort()).toEqual(['busted', 'finished']);
    const loserToken = d.standings.find((s: any) => s.you).status === 'busted' ? a.token : b.token;
    const r2 = await openRound();
    expect((await bet(t.id, loserToken, r2.id, 'paired-board:no', 1_000)).body.type).toBe('entry_busted');
    await finishRound(r2.n);

    expect((await tournamentTick(h.db, later())).completed).toBeGreaterThanOrEqual(1);
    const done = (await h.api('GET', `/v1/tournaments/${t.id}`, a.token)).body;
    expect(done.tournament.status).toBe('completed');
    // Pool 2,000 in buy-ins, 10% fee: the winner takes 1,800.
    expect(done.standings.map((s: any) => s.prize_minor)).toEqual([1_800, 0]);
    const aWon = done.standings[0].you;
    expect(await walletOf(h, a.token)).toBe(w.a - 1_000 + (aWon ? 1_800 : 0));
    expect(await walletOf(h, b.token)).toBe(w.b - 1_000 + (aWon ? 0 : 1_800));
    expect(await balance(h.db as never, `${t.id}:pool:play:PLAY`)).toBe(0);
    expect((await h.api('GET', '/v1/me/badges', aWon ? a.token : b.token)).body.badges.some((x: any) => x.kind === 'champion')).toBe(true);
    // Completed tournaments refuse bets and do not complete twice.
    expect((await tournamentTick(h.db, later())).completed).toBe(0);
    for (const s of await ledgerSums(h.db)) expect(Number(s.total)).toBe(0);
    expect((await verifyAuditChain(h.db)).ok).toBe(true);
  });

  it('short of players at the start it cancels itself; a cancel refunds buy-ins and returns the added prize', async () => {
    const issuance = 'PreFlop:play-issuance:play:PLAY';
    const before = await balance(h.db as never, issuance);
    const short = (await h.api('POST', '/v1/admin/tournaments', admin, running({ name: 'Lonely', late_reg_minutes: 0, added_minor: 500 }))).body;
    expect((await tournamentTick(h.db)).cancelled).toBeGreaterThanOrEqual(1);
    expect((await h.api('GET', `/v1/tournaments/${short.id}`)).body.tournament).toMatchObject({ status: 'cancelled', cancel_reason: 'not enough players' });
    expect(await balance(h.db as never, issuance)).toBe(before);

    const t = (await h.api('POST', '/v1/admin/tournaments', admin, running({ name: 'Called off' }))).body;
    const a = await user('Ana');
    const w = await walletOf(h, a.token);
    await h.api('POST', `/v1/tournaments/${t.id}/register`, a.token);
    expect((await h.api('POST', `/v1/admin/tournaments/${t.id}/cancel`, admin, { reason: 'table maintenance' })).status).toBe(200);
    expect(await walletOf(h, a.token)).toBe(w);
    expect((await h.api('POST', `/v1/tournaments/${t.id}/register`, a.token)).body.type).toBe('registration_closed');
  });

  it('refuses real money while it is off, closed-loop modes from the team, and bad settings', async () => {
    expect((await h.api('POST', '/v1/admin/tournaments', admin, running({ mode: 'real-fiat', currency: 'EUR' }))).body.type).toBe('mode_disabled');
    expect((await h.api('POST', '/v1/admin/tournaments', admin, running({ mode: 'diamonds', currency: 'DIAMOND' }))).body.type).toBe('org_required');
    expect((await h.api('POST', '/v1/admin/tournaments', admin, running({ payout_bps: [6000, 3000] }))).body.type).toBe('invalid_payouts');
    expect((await h.api('POST', '/v1/admin/tournaments', admin, running({ buy_in_minor: 0, fee_bps: 500 }))).body.type).toBe('invalid_fee');
    expect((await h.api('POST', '/v1/admin/tournaments', admin, running({ min_stake: 20_000 }))).body.type).toBe('invalid_stake');
    const player = await user('Nope');
    expect((await h.api('POST', '/v1/admin/tournaments', player.token, running())).status).toBe(403);
  });
});
