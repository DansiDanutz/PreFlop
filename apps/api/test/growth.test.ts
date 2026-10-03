import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { growthTick } from '../src/growth/worker.ts';
import { SETTLE_GRACE_MS } from '../src/growth/leaderboards.ts';
import { verifyAuditChain } from '../src/lib/audit.ts';
import { tx } from '../src/lib/db.ts';
import { balance } from '../src/lib/ledger.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, bet, harness, ledgerSums, ownedOrg, walletOf, idemKey } from './helpers.ts';

/** Leaderboards, prize pools and promotions (docs/16). */
let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await harness('growth');
  await tx(h.db, (c) => seedAdmin(c, 'growth-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'growth-admin@test.dev', password: 'admin-pass-1' })).body.token;
});
afterAll(async () => h?.close());

const hour = 3_600_000;
const window = () => ({ starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: new Date(Date.now() + hour).toISOString() });
const afterEnd = () => new Date(Date.now() + 2 * hour);

async function playHand(bets: [token: string, selection: string, stake: number][]): Promise<string[]> {
  await h.sim.heartbeat();
  await h.work();
  const n = await h.sim.openHand();
  if (n === null) throw new Error('no open round');
  for (const [t, s, st] of bets) expect((await bet(h, t, `sim-1:h${n}`, s, st)).status).toBe(201);
  const out = await h.sim.playHand(n);
  await h.work();
  return out.cards;
}

let un = 0;
async function user(name: string) {
  const email = `${name}-${++un}-${Date.now()}@test.dev`;
  const r = await h.api('POST', '/v1/auth/register', undefined, { email, password: 'correct horse', date_of_birth: '1990-01-01', country: 'MT', display_name: name });
  return { token: r.body.token as string, id: r.body.user.id as string, email };
}

describe('leaderboards and prize pools', () => {
  it('a sponsored free-chip board ranks by net result, pays free chips and badges, and returns the rest', async () => {
    const a = await user('Ana'), b = await user('Bo');
    const lb = await h.api('POST', '/v1/admin/leaderboards', admin, {
      name: 'Practice weekly', mode: 'play', currency: 'PLAY', metric: 'net', min_rounds: 1, prize_split_bps: [6000, 3000, 1000], fund_minor: 9_000, ...window(),
    });
    expect(lb.status).toBe(201);
    expect(lb.body).toMatchObject({ status: 'active', pool_minor: 9_000, owner_name: 'PreFlop' });

    // Complementary bets: exactly one of the two players wins this hand.
    await playHand([[a.token, 'paired-board:no', 500], [b.token, 'paired-board:yes', 500]]);
    const live = (await h.api('GET', `/v1/leaderboards/${lb.body.id}`, a.token)).body;
    expect(live.standings).toHaveLength(2);
    expect(live.standings[0]).not.toHaveProperty('user_id');
    expect(live.you).toMatchObject({ you: true, qualified: true });

    const before = { a: await walletOf(h, a.token), b: await walletOf(h, b.token) };
    expect((await growthTick(h.db, afterEnd())).settled).toBeGreaterThanOrEqual(1);
    const done = (await h.api('GET', `/v1/leaderboards/${lb.body.id}`, a.token)).body;
    expect(done.leaderboard.status).toBe('settled');
    expect(done.standings.map((s: any) => s.prize_minor)).toEqual([5_400, 2_700]);
    const winnerIsA = done.standings[0].you;
    expect(await walletOf(h, a.token)).toBe(before.a + (winnerIsA ? 5_400 : 2_700));
    expect(await walletOf(h, b.token)).toBe(before.b + (winnerIsA ? 2_700 : 5_400));
    // Rank 3 had no qualifier: its 900 went back to PreFlop's play issuance, and the pool is empty.
    expect(await balance(h.db as never, `${lb.body.id}:pool:play:PLAY`)).toBe(0);
    const badges = (await h.api('GET', '/v1/me/badges', winnerIsA ? a.token : b.token)).body.badges;
    expect(badges[0]).toMatchObject({ kind: 'champion' });
    // Settling twice does nothing.
    expect((await h.api('POST', `/v1/admin/leaderboards/${lb.body.id}/settle`, admin)).status).toBe(422);
    for (const s of await ledgerSums(h.db)) expect(Number(s.total)).toBe(0);
  });

  it('accrues a share of PreFlop’s margin into the pool, never more than the house won', async () => {
    const p = await user('Mo');
    const lb = (await h.api('POST', '/v1/admin/leaderboards', admin, {
      name: 'Margin board', mode: 'play', currency: 'PLAY', metric: 'points', prize_split_bps: [10_000], margin_bps: 1_000, ...window(),
    })).body;
    await playHand([[p.token, 'paired-board:yes', 1_000]]);
    const house = (await h.db.query<{ h: string }>(`select coalesce(sum(stake_minor - coalesce(payout_minor, 0)), 0)::text as h from bets b join leaderboards l on l.id = $1
      where b.mode = 'play' and b.status in ('won','lost') and b.settled_at >= l.starts_at`, [lb.id])).rows[0]!.h;
    // Accrual only reads bets settled at least SETTLE_GRACE_MS ago.
    const later = new Date(Date.now() + SETTLE_GRACE_MS + 1_000);
    await growthTick(h.db, later);
    const pool = (await h.api('GET', `/v1/leaderboards/${lb.id}`)).body.leaderboard.pool_minor;
    expect(pool).toBe(Math.floor((Math.max(0, Number(house)) * 1_000) / 10_000));
    // A second tick with no new bets adds nothing.
    await growthTick(h.db, later);
    expect((await h.api('GET', `/v1/leaderboards/${lb.id}`)).body.leaderboard.pool_minor).toBe(pool);
    expect((await h.api('POST', `/v1/admin/leaderboards/${lb.id}/cancel`, admin)).status).toBe(200);
    for (const s of await ledgerSums(h.db)) expect(Number(s.total)).toBe(0);
  });

  it('refuses real-money boards while real money is off, bad prize splits and player contributions outside real money', async () => {
    const base = { name: 'Board', metric: 'net', prize_split_bps: [10_000], ...window() };
    const real = await h.api('POST', '/v1/admin/leaderboards', admin, { ...base, mode: 'real-fiat', currency: 'EUR' });
    expect(real.status).toBe(403);
    expect(real.body.type).toBe('mode_disabled');
    expect((await h.api('POST', '/v1/admin/leaderboards', admin, { ...base, mode: 'play', currency: 'PLAY', prize_split_bps: [5000, 4000] })).body.type).toBe('invalid_prize_split');
    expect((await h.api('POST', '/v1/admin/leaderboards', admin, { ...base, mode: 'play', currency: 'PLAY', contribution_bps: 100 })).body.type).toBe('contribution_real_only');
    const player = await user('Nope');
    expect((await h.api('POST', '/v1/admin/leaderboards', player.token, { ...base, mode: 'play', currency: 'PLAY' })).status).toBe(403);
  });

  it('organizations run boards on their own tables or rooms only, funded from their treasury', async () => {
    const owner = await user('club-owner');
    const org = await ownedOrg(h, admin, { kind: 'organizer', name: 'Night Owls' }, owner);
    await h.api('POST', `/v1/org/${org}/diamonds/purchases`, owner.token, { diamonds: 5_000, pay_with: 'USDT' }, idemKey());
    const base = { name: 'Diamond week', mode: 'diamonds', currency: 'DIAMOND', metric: 'roi', prize_split_bps: [10_000], ...window() };
    expect((await h.api('POST', `/v1/org/${org}/leaderboards`, owner.token, { ...base, scope: 'global' })).body.type).toBe('scope_not_allowed');
    expect((await h.api('POST', `/v1/org/${org}/leaderboards`, owner.token, { ...base, scope: 'org', scope_ref: 'someone-else' })).body.type).toBe('scope_not_allowed');
    expect((await h.api('POST', `/v1/org/${org}/leaderboards`, owner.token, { ...base, scope: 'org', scope_ref: org, margin_bps: 100 })).body.type).toBe('margin_preflop_only');
    expect((await h.api('POST', `/v1/org/${org}/leaderboards`, owner.token, { ...base, mode: 'play', currency: 'PLAY', scope: 'org', scope_ref: org })).body.type).toBe('play_is_preflop');
    const lb = await h.api('POST', `/v1/org/${org}/leaderboards`, owner.token, { ...base, scope: 'org', scope_ref: org, fund_minor: 1_000 });
    expect(lb.status).toBe(201);
    expect(lb.body).toMatchObject({ pool_minor: 1_000, owner_name: 'Night Owls' });
    expect((await h.api('POST', `/v1/org/${org}/leaderboards/${lb.body.id}/fund`, owner.token, { amount_minor: 1_000_000 })).body.type).toBe('insufficient_treasury');
    // Nobody qualified: cancelling returns the pool to the treasury.
    expect((await h.api('POST', `/v1/admin/leaderboards/${lb.body.id}/cancel`, admin)).status).toBe(200);
    expect(await balance(h.db as never, `${org}:treasury:diamonds:DIAMOND`)).toBe(5_000);
  });

  it('chip and diamond boards always belong to an organization, so prizes land in a spendable wallet', async () => {
    const base = { name: 'Global diamonds', metric: 'net', prize_split_bps: [10_000], ...window() };
    expect((await h.api('POST', '/v1/admin/leaderboards', admin, { ...base, mode: 'diamonds', currency: 'DIAMOND' })).body.type).toBe('org_required');
    expect((await h.api('POST', '/v1/admin/leaderboards', admin, { ...base, mode: 'virtual-chips', currency: 'CHIP' })).body.type).toBe('org_required');
  });

  it('a board on an invite-only room is hidden from everyone who cannot see the room', async () => {
    const owner = await user('room-owner');
    const org = await ownedOrg(h, admin, { kind: 'organizer', name: 'Back Room' }, owner);
    const room = (await h.api('POST', `/v1/org/${org}/rooms`, owner.token, { name: 'Private', table_id: 'sim-1', mode: 'virtual-chips', house: 'pool', rules: { margin_bps: 0, min_stake_minor: 100, rake_bps: 1000 }, visibility: 'invite' })).body;
    const lb = (await h.api('POST', `/v1/org/${org}/leaderboards`, owner.token, { name: 'Private week', mode: 'virtual-chips', currency: 'CHIP', metric: 'net', prize_split_bps: [10_000], scope: 'room', scope_ref: room.id, ...window() })).body;
    const outsider = await user('outsider');
    for (const t of [undefined, outsider.token]) {
      expect((await h.api('GET', '/v1/leaderboards', t)).body.leaderboards.some((b: any) => b.id === lb.id)).toBe(false);
      expect((await h.api('GET', `/v1/leaderboards/${lb.id}`, t)).status).toBe(404);
    }
    expect((await h.api('GET', `/v1/leaderboards/${lb.id}`, owner.token)).status).toBe(200);
    expect((await h.api('GET', '/v1/leaderboards', admin)).body.leaderboards.some((b: any) => b.id === lb.id)).toBe(true);
    expect((await h.api('GET', '/v1/leaderboards', owner.token)).body.leaderboards.some((b: any) => b.id === lb.id)).toBe(true);
  });

  it('real-money prizes wait while the mode is off and go only to verified players', async () => {
    const modes = (on: boolean) => h.api('PUT', '/v1/admin/settings/modes_enabled', admin, { value: { play: true, 'virtual-chips': true, diamonds: true, 'real-fiat': on, 'real-crypto': false } });
    await modes(true);
    const lb = (await h.api('POST', '/v1/admin/leaderboards', admin, { name: 'Real week', mode: 'real-fiat', currency: 'EUR', metric: 'net', min_rounds: 1, prize_split_bps: [10_000], fund_minor: 5_000, ...window() })).body;
    const [verified, unverified] = [await user('Vera'), await user('Uri')];
    await h.db.query(`update users set kyc_status = 'verified' where id = $1`, [verified.id]);
    const round = (await h.db.query<{ id: string }>('select id from rounds limit 1')).rows[0]!.id;
    for (const [u, payout] of [[unverified.id, 9_000], [verified.id, 3_000]] as const) {
      await h.db.query(`insert into bets (id, idempotency_key, user_id, round_id, selection_id, stake_minor, odds_centi, mode, currency, status, payout_minor, settled_at)
        values ($1, $1, $2, $3, 'colour:all-red', 1000, 200, 'real-fiat', 'EUR', 'won', $4, now())`, [`rm-${u}`, u, round, payout]);
    }
    await modes(false);
    await growthTick(h.db, afterEnd());
    expect((await h.api('GET', `/v1/leaderboards/${lb.id}`, admin)).body.leaderboard.status).not.toBe('settled');
    expect(await balance(h.db as never, `${verified.id}:wallet:real-fiat:EUR`)).toBe(0);
    await modes(true);
    await growthTick(h.db, afterEnd());
    // The unverified player led the board but steps aside; the verified player takes rank 1.
    expect(await balance(h.db as never, `${unverified.id}:wallet:real-fiat:EUR`)).toBe(0);
    expect(await balance(h.db as never, `${verified.id}:wallet:real-fiat:EUR`)).toBe(5_000);
    await modes(false);
    for (const s of await ledgerSums(h.db)) expect(Number(s.total)).toBe(0);
  });
});

describe('promotions', () => {
  it('a PreFlop free-chip promotion is claimed once per player', async () => {
    const promo = await h.api('POST', '/v1/admin/promotions', admin, { kind: 'free-chips', title: 'Weekend top-up', body: 'Free chips on us.', amount_minor: 2_000, ...window() });
    expect(promo.status).toBe(201);
    const p = await user('Claimer');
    const list = (await h.api('GET', '/v1/promotions', p.token)).body.promotions;
    expect(list.find((x: any) => x.id === promo.body.id)).toMatchObject({ claimed: false, owner_name: 'PreFlop' });
    const before = await walletOf(h, p.token);
    const both = await Promise.all([h.api('POST', `/v1/promotions/${promo.body.id}/claim`, p.token), h.api('POST', `/v1/promotions/${promo.body.id}/claim`, p.token)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await walletOf(h, p.token)).toBe(before + 2_000);
    expect((await h.api('GET', '/v1/promotions', p.token)).body.promotions.find((x: any) => x.id === promo.body.id).claimed).toBe(true);
  });

  it('club promotions wait for review; an organizer drop pays from its treasury within budget, to its own players only', async () => {
    const owner = await user('drop-owner');
    const org = await ownedOrg(h, admin, { kind: 'organizer', name: 'Drop Club' }, owner);
    await h.api('POST', `/v1/org/${org}/diamonds/purchases`, owner.token, { diamonds: 1_000, pay_with: 'USDT' }, idemKey());
    expect((await h.api('POST', `/v1/org/${org}/promotions`, owner.token, { kind: 'free-chips', title: 'Not allowed', amount_minor: 10, ...window() })).body.type).toBe('kind_not_allowed');
    expect((await h.api('POST', `/v1/org/${org}/promotions`, owner.token, { kind: 'org-drop', title: 'Too big', mode: 'diamonds', currency: 'DIAMOND', amount_minor: 100, budget_minor: 50_000, ...window() })).body.type).toBe('insufficient_treasury');
    const drop = await h.api('POST', `/v1/org/${org}/promotions`, owner.token, { kind: 'org-drop', title: 'Diamond drop', mode: 'diamonds', currency: 'DIAMOND', amount_minor: 100, budget_minor: 150, ...window() });
    expect(drop.body.status).toBe('pending_review');
    expect((await h.api('GET', '/v1/promotions')).body.promotions.some((x: any) => x.id === drop.body.id)).toBe(false);
    expect((await h.api('POST', `/v1/admin/promotions/${drop.body.id}/decision`, admin, { decision: 'reject' })).body.type).toBe('note_required');
    expect((await h.api('POST', `/v1/admin/promotions/${drop.body.id}/decision`, admin, { decision: 'approve' })).body.status).toBe('approved');

    // Only players in the organizer's rooms are eligible.
    const outsider = await user('outsider');
    expect((await h.api('POST', `/v1/promotions/${drop.body.id}/claim`, outsider.token)).body.type).toBe('not_eligible');
    expect((await h.api('GET', '/v1/promotions', outsider.token)).body.promotions.find((x: any) => x.id === drop.body.id).eligible).toBe(false);
    const room = (await h.api('POST', `/v1/org/${org}/rooms`, owner.token, { name: 'Drop Room', table_id: 'sim-1', mode: 'virtual-chips', house: 'pool', rules: { margin_bps: 0, min_stake_minor: 100, rake_bps: 1000 }, visibility: 'public' }));
    expect(room.status).toBe(201);
    const p1 = await user('member1'), p2 = await user('member2');
    for (const p of [p1, p2]) await h.db.query('insert into room_members (room_id, user_id) values ($1, $2)', [room.body.id, p.id]);
    expect((await h.api('GET', '/v1/promotions', p1.token)).body.promotions.find((x: any) => x.id === drop.body.id).eligible).toBe(true);
    expect((await h.api('POST', `/v1/promotions/${drop.body.id}/claim`, p1.token)).status).toBe(200);
    // The budget (150) covers one claim of 100, not two.
    const second = await h.api('POST', `/v1/promotions/${drop.body.id}/claim`, p2.token);
    expect(second.status).toBe(409);
    expect(second.body.type).toBe('budget_exhausted');
    expect(await balance(h.db as never, `${p1.id}:wallet-${org}:diamonds:DIAMOND`)).toBe(100);
    for (const s of await ledgerSums(h.db)) expect(Number(s.total)).toBe(0);
    expect((await verifyAuditChain(h.db)).ok).toBe(true);
  });
});
