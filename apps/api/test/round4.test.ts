import { price } from '@preflop/odds-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { statsOf } from '../src/bets/service.ts';
import { tx } from '../src/lib/db.ts';
import { EventBatch } from '../src/lib/events.ts';
import { balance } from '../src/lib/ledger.ts';
import { resolve } from '../src/rounds/service.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness, idemKey, ledgerSums, ownedOrg, realMoneyReady, walletOf } from './helpers.ts';

/**
 * External audit, round 4 (migration 014): idempotent money routes, bet replays that must match,
 * the exact stablecoin deposit limit, room rules, review deadlines, per-currency stats and
 * console totals, query validation and the machine pause kind.
 */
let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await harness('round4');
  await tx(h.db, (c) => seedAdmin(c, 'r4-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'r4-admin@test.dev', password: 'admin-pass-1' })).body.token;
  await h.api('PUT', '/v1/admin/settings/modes_enabled', admin, { value: { play: true, 'virtual-chips': true, diamonds: true, 'real-fiat': true, 'real-crypto': true } });
});
afterAll(async () => h?.close());

let n = 0;
async function user(name: string, opts: { real?: boolean } = {}) {
  const email = `${name}-${++n}-${Date.now()}@r4.dev`;
  const r = await h.api('POST', '/v1/auth/register', undefined, { email, password: 'correct horse', display_name: name, date_of_birth: '1990-01-01', country: 'MT' });
  const u = { token: r.body.token as string, id: r.body.user.id as string, email };
  if (opts.real) {
    await h.api('POST', '/v1/me/kyc', u.token, {});
    await realMoneyReady(h, u.id);
  }
  return u;
}
const key = (s: string) => ({ 'idempotency-key': `${s}-${Date.now()}-${++n}` });
const odds = (sel: string) => price(statsOf(sel), 'direct').oddsCenti;
async function openRound(): Promise<string> {
  await h.sim.heartbeat();
  await h.work();
  const hand = await h.sim.openHand();
  if (hand === null) throw new Error('no open round');
  return `sim-1:h${hand}`;
}
const count = async (sql: string, params: unknown[]) => (await h.db.query<{ n: number }>(sql, params)).rows[0]!.n;

/** An organizer (owner signed in) with chips and diamonds in its treasury. */
async function organizer() {
  const owner = await user('org-owner');
  const org = await ownedOrg(h, admin, { kind: 'organizer', name: `Org ${n}` }, owner);
  expect((await h.api('POST', `/v1/org/${org}/chips/purchases`, owner.token, { chips: 10_000, pay_with: 'EUR' }, idemKey())).status).toBe(201);
  expect((await h.api('POST', `/v1/org/${org}/diamonds/purchases`, owner.token, { diamonds: 10_000, pay_with: 'USDT' }, idemKey())).status).toBe(201);
  return { owner, org };
}

describe('1. money in and out is idempotent', () => {
  const dep = { mode: 'real-fiat', currency: 'EUR', amount_minor: 2_500, method: 'card' };

  it('a deposit needs an Idempotency-Key (8–200 characters)', async () => {
    const p = await user('nokey', { real: true });
    expect((await h.api('POST', '/v1/me/deposits', p.token, dep)).status).toBe(400);
    expect((await h.api('POST', '/v1/me/deposits', p.token, dep, { 'idempotency-key': 'short' })).status).toBe(400);
    expect((await h.api('POST', '/v1/me/deposits', p.token, dep, { 'idempotency-key': 'x'.repeat(201) })).status).toBe(400);
    expect((await h.api('POST', '/v1/me/withdrawals', p.token, dep)).status).toBe(400);
    expect((await h.api('POST', '/v1/me/chips/purchases', p.token, { chips: 100, pay_with: 'EUR' })).status).toBe(400);
    expect(await walletOf(h, p.token, 'real-fiat')).toBe(0);
  });

  it('a retried deposit returns the original payment and credits once; another body with the key is 422', async () => {
    const p = await user('dep', { real: true });
    const k = key('dep');
    const first = await h.api('POST', '/v1/me/deposits', p.token, dep, k);
    expect(first.status).toBe(201);
    const again = await h.api('POST', '/v1/me/deposits', p.token, dep, k);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(await walletOf(h, p.token, 'real-fiat')).toBe(2_500);
    expect(await count(`select count(*)::int as n from ledger_tx where kind = 'payment.deposit' and ref = $1`, [first.body.id])).toBe(1);
    expect(await count('select count(*)::int as n from payments where user_id = $1', [p.id])).toBe(1);
    const other = await h.api('POST', '/v1/me/deposits', p.token, { ...dep, amount_minor: 9_000 }, k);
    expect(other.status).toBe(422);
    expect(other.body.type).toBe('idempotency_mismatch');
    // the same key on another money route is a different request too
    expect((await h.api('POST', '/v1/me/withdrawals', p.token, dep, k)).body.type).toBe('idempotency_mismatch');
    expect(await walletOf(h, p.token, 'real-fiat')).toBe(2_500);
  });

  it('two concurrent requests with one key credit once', async () => {
    const p = await user('race', { real: true });
    const k = key('race');
    const both = await Promise.all([h.api('POST', '/v1/me/deposits', p.token, dep, k), h.api('POST', '/v1/me/deposits', p.token, dep, k)]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect(both[0]!.body.id).toBe(both[1]!.body.id);
    expect(await walletOf(h, p.token, 'real-fiat')).toBe(2_500);
  });

  it('a retried withdrawal and a retried chip purchase move money once', async () => {
    const p = await user('wd', { real: true });
    expect((await h.api('POST', '/v1/me/deposits', p.token, { ...dep, amount_minor: 10_000 }, idemKey())).status).toBe(201);
    const w = key('wd');
    const out = { ...dep, amount_minor: 3_000, method: 'bank' };
    const w1 = await h.api('POST', '/v1/me/withdrawals', p.token, out, w);
    const w2 = await h.api('POST', '/v1/me/withdrawals', p.token, out, w);
    expect([w1.status, w2.status]).toEqual([201, 201]);
    expect(w2.body.id).toBe(w1.body.id);
    expect(await walletOf(h, p.token, 'real-fiat')).toBe(7_000);
    const c = key('chips');
    const c1 = await h.api('POST', '/v1/me/chips/purchases', p.token, { chips: 500, pay_with: 'EUR' }, c);
    const c2 = await h.api('POST', '/v1/me/chips/purchases', p.token, { chips: 500, pay_with: 'EUR' }, c);
    expect([c1.status, c2.status]).toEqual([201, 201]);
    expect(c2.body.id).toBe(c1.body.id);
    expect(await walletOf(h, p.token, 'virtual-chips')).toBe(500);
    for (const s of await ledgerSums(h.db)) expect(s.total).toBe(0);
  });

  it('organizer purchases, collateral deposits and transfers are idempotent too', async () => {
    const owner = await user('o');
    const org = await ownedOrg(h, admin, { kind: 'organizer', name: 'Idem Org' }, owner);
    const player = await user('p');
    const treasury = (cur: string, mode: string) => balance(h.db, `${org}:treasury:${mode}:${cur}`);
    for (const [url, body] of [[`/v1/org/${org}/chips/purchases`, { chips: 5_000, pay_with: 'EUR' }], [`/v1/org/${org}/diamonds/purchases`, { diamonds: 5_000, pay_with: 'USDT' }]] as const) {
      expect((await h.api('POST', url, owner.token, body)).status).toBe(400);
      const k = key('buy');
      const a = await h.api('POST', url, owner.token, body, k);
      const b = await h.api('POST', url, owner.token, body, k);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(b.body.id).toBe(a.body.id);
    }
    expect(await treasury('CHIP', 'virtual-chips')).toBe(5_000);
    expect(await treasury('DIAMOND', 'diamonds')).toBe(5_000);

    const col = { mode: 'diamonds', currency: 'DIAMOND', amount_minor: 1_000 };
    expect((await h.api('POST', `/v1/org/${org}/collateral/deposits`, owner.token, col)).status).toBe(400);
    const kc = key('col');
    expect((await h.api('POST', `/v1/org/${org}/collateral/deposits`, owner.token, col, kc)).status).toBe(200);
    expect((await h.api('POST', `/v1/org/${org}/collateral/deposits`, owner.token, col, kc)).status).toBe(200);
    expect((await h.api('POST', `/v1/org/${org}/collateral/deposits`, owner.token, { ...col, amount_minor: 2_000 }, kc)).body.type).toBe('idempotency_mismatch');
    expect(await balance(h.db, `${org}:collateral:diamonds:DIAMOND`)).toBe(1_000);

    const trf = { email: player.email, mode: 'virtual-chips', amount_minor: 700 };
    const kt = key('trf');
    const t1 = await h.api('POST', `/v1/org/${org}/transfers`, owner.token, trf, kt);
    const t2 = await h.api('POST', `/v1/org/${org}/transfers`, owner.token, trf, kt);
    expect([t1.status, t2.status]).toEqual([201, 201]);
    expect(t2.body.id).toBe(t1.body.id);
    expect(await balance(h.db, `${player.id}:wallet-${org}:virtual-chips:CHIP`)).toBe(700);
    expect(await count('select count(*)::int as n from transfers where org_id = $1', [org])).toBe(1);
    for (const s of await ledgerSums(h.db)) expect(s.total).toBe(0);
  });

  it('a payment provider reference is recorded once (unique index)', async () => {
    const ref = (await h.db.query<{ provider_ref: string }>('select provider_ref from payments where provider_ref is not null limit 1')).rows[0]!.provider_ref;
    await expect(h.db.query(`insert into payments (id, kind, method, mode, currency, amount_minor, status, provider_ref) values ('pay_dup', 'deposit', 'card', 'real-fiat', 'EUR', 1, 'completed', $1)`, [ref]))
      .rejects.toMatchObject({ code: '23505' });
  });
});

describe('2. a replayed bet key must carry the same bet', () => {
  it('direct bets: another stake, selection or round with the key is 422; the same bet replays', async () => {
    const p = await user('replay');
    const rid = await openRound();
    const k = key('bet');
    const body = { round_id: rid, selection_id: 'colour:mixed', stake_minor: 100, odds_centi: odds('colour:mixed') };
    const first = await h.api('POST', '/v1/bets', p.token, body, k);
    expect(first.status).toBe(201);
    for (const change of [{ stake_minor: 200 }, { selection_id: 'colour:all-red', odds_centi: odds('colour:all-red') }, { odds_centi: body.odds_centi + 5 }, { room_id: 'room_x' }]) {
      const r = await h.api('POST', '/v1/bets', p.token, { ...body, ...change }, k);
      expect(r.status, JSON.stringify(change)).toBe(422);
      expect(r.body.type).toBe('idempotency_mismatch');
    }
    const again = await h.api('POST', '/v1/bets', p.token, body, k);
    expect(again.status).toBe(201);
    expect(again.body.bet_id).toBe(first.body.bet_id);
    // accept_price_change: any price the request accepted is the one it asked for
    expect((await h.api('POST', '/v1/bets', p.token, { ...body, odds_centi: body.odds_centi + 5, accept_price_change: true }, k)).body.bet_id).toBe(first.body.bet_id);
    expect(await count('select count(*)::int as n from bets where user_id = $1', [p.id])).toBe(1);
  });

  it('room bets: the same key with another stake, or without the room, is 422', async () => {
    const { owner, org } = await organizer();
    const p = await user('room-replay');
    await h.api('POST', `/v1/org/${org}/transfers`, owner.token, { email: p.email, mode: 'virtual-chips', amount_minor: 2_000 }, idemKey());
    const room = (await h.api('POST', `/v1/org/${org}/rooms`, owner.token, { name: 'Replay pool', table_id: 'sim-1', mode: 'virtual-chips', house: 'pool', rules: { margin_bps: 0, min_stake_minor: 100, rake_bps: 1000 }, visibility: 'public' })).body;
    const rid = await openRound();
    const k = key('rbet');
    const body = { round_id: rid, selection_id: 'colour:mixed', stake_minor: 200, odds_centi: 100, room_id: room.id };
    const first = await h.api('POST', '/v1/bets', p.token, body, k);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect((await h.api('POST', '/v1/bets', p.token, { ...body, stake_minor: 300 }, k)).body.type).toBe('idempotency_mismatch');
    const { room_id: _room, ...direct } = body;
    expect((await h.api('POST', '/v1/bets', p.token, { ...direct, odds_centi: odds('colour:mixed') }, k)).body.type).toBe('idempotency_mismatch');
    expect((await h.api('POST', '/v1/bets', p.token, body, k)).body.bet_id).toBe(first.body.bet_id);
  });

  it('tournament bets: the same idempotency_key with another stake is 422', async () => {
    const t = (await h.api('POST', '/v1/admin/tournaments', admin, {
      name: 'Replay cup', mode: 'play', currency: 'PLAY', buy_in_minor: 0, fee_bps: 0, starting_stack: 10_000, bets_allowed: 5, min_stake: 100,
      starts_at: new Date(Date.now() - 30_000).toISOString(), duration_minutes: 30, late_reg_minutes: 20, min_entries: 1, payout_bps: [10_000],
    })).body;
    const p = await user('tn');
    expect((await h.api('POST', `/v1/tournaments/${t.id}/register`, p.token)).status).toBe(200);
    const rid = await openRound();
    const body = { round_id: rid, selection_id: 'colour:mixed', stake: 500, odds_centi: odds('colour:mixed'), idempotency_key: `tn-replay-${Date.now()}` };
    const first = await h.api('POST', `/v1/tournaments/${t.id}/bets`, p.token, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const other = await h.api('POST', `/v1/tournaments/${t.id}/bets`, p.token, { ...body, stake: 900 });
    expect(other.status).toBe(422);
    expect(other.body.type).toBe('idempotency_mismatch');
    expect((await h.api('POST', `/v1/tournaments/${t.id}/bets`, p.token, body)).body.id).toBe(first.body.id);
  });
});

describe('3. the daily deposit limit counts stablecoins exactly', () => {
  it('sub-cent USDT deposits add up: splitting a deposit never gets past the limit', async () => {
    const p = await user('split', { real: true });
    await h.api('PUT', '/v1/me/limits', p.token, { deposit_day_minor: 2 }); // 2 euro cents
    const piece = { mode: 'real-crypto', currency: 'USDT', amount_minor: 9_999, method: 'crypto' }; // 0.9999 cent each
    expect((await h.api('POST', '/v1/me/deposits', p.token, piece, idemKey())).status).toBe(201); // 0.9999 cent
    expect((await h.api('POST', '/v1/me/deposits', p.token, piece, idemKey())).status).toBe(201); // 1.9998 cents
    const third = await h.api('POST', '/v1/me/deposits', p.token, piece, idemKey()); // 2.9997 cents > 2
    expect(third.status).toBe(403);
    expect(third.body.type).toBe('limit_reached');
    // exactly up to the limit is fine: 0.0002 cent of headroom is 2 micro-USDT
    expect((await h.api('POST', '/v1/me/deposits', p.token, { ...piece, amount_minor: 2 }, idemKey())).status).toBe(201);
    expect((await h.api('POST', '/v1/me/deposits', p.token, { ...piece, amount_minor: 1 }, idemKey())).body.type).toBe('limit_reached');
  });
});

describe('4. room rules', () => {
  it('a diamond pool room needs the pool rake floor; a diamond room takes no provider share', async () => {
    const { owner, org } = await organizer();
    const room = (rules: Record<string, number>, house = 'pool') =>
      h.api('POST', `/v1/org/${org}/rooms`, owner.token, { name: 'Diamond room', table_id: 'sim-1', mode: 'diamonds', house, rules: { margin_bps: 600, min_stake_minor: 20, ...rules }, visibility: 'public' });
    const zero = await room({ rake_bps: 0 });
    expect(zero.status).toBe(422);
    expect(zero.body.type).toBe('invalid_rules');
    expect(zero.body.problems.join(' ')).toMatch(/pool rake/);
    expect((await room({ rake_bps: 500 })).status).toBe(201);
    const share = await room({ rake_bps: 500, provider_share_bps: 1000 }, 'organizer');
    expect(share.status).toBe(422);
    expect(share.body.type).toBe('provider_share_unsupported');
    const v = (await h.api('POST', `/v1/org/${org}/rooms/validate`, owner.token, { mode: 'diamonds', house: 'organizer', rules: { margin_bps: 600, min_stake_minor: 20, rake_bps: 500, provider_share_bps: 1000 } })).body;
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/provider share/);
    const ok = (await room({ rake_bps: 500 }, 'organizer')).body;
    expect((await h.api('PUT', `/v1/org/${org}/rooms/${ok.id}`, owner.token, { rules: { margin_bps: 600, min_stake_minor: 20, rake_bps: 500, provider_share_bps: 1 } })).body.type).toBe('provider_share_unsupported');
  });
});

describe('5. review_deadline on every round payload', () => {
  it('is review start + REVIEW_SLA_MS while in REVIEW, null otherwise', async () => {
    const rid = await openRound();
    expect((await h.api('GET', `/v1/rounds/${rid}`)).body.review_deadline).toBeNull();
    const started = new Date(Date.now() - 60_000);
    await h.db.query(`update rounds set state = 'REVIEW', review_started_at = $2, review_reasons = '["test"]' where id = $1`, [rid, started]);
    const want = new Date(started.getTime() + h.config.reviewSlaMs).toISOString();

    expect((await h.api('GET', `/v1/rounds/${rid}`)).body.review_deadline).toBe(want);
    expect((await h.api('GET', '/v1/tables/sim-1/rounds/current')).body.latest).toMatchObject({ id: rid, review_deadline: want });
    expect((await h.api('GET', '/v1/tables/sim-1')).body.current_round).toMatchObject({ id: rid, state: 'REVIEW', review_deadline: want });
    expect((await h.api('GET', '/v1/lobby')).body.tables.find((t: any) => t.id === 'sim-1').current_round.review_deadline).toBe(want);
    expect((await h.api('GET', '/v1/admin/review-queue', admin)).body.rounds.find((r: any) => r.id === rid).review_deadline).toBe(want);
    const listed = (await h.api('GET', '/v1/admin/rounds?state=REVIEW', admin)).body.rounds.find((r: any) => r.id === rid);
    expect(listed.review_deadline).toBe(want);
    expect(listed).not.toHaveProperty('review_started_at');
    expect((await h.api('GET', `/v1/admin/rounds/${rid}/evidence`, admin)).body.round.review_deadline).toBe(want);
    expect((await h.api('GET', '/v1/org/club-sim/rounds?state=REVIEW', admin)).body.rounds.find((r: any) => r.id === rid).review_deadline).toBe(want);
    const state = await h.sim.state();
    expect(state.rounds.find((r: any) => r.id === rid).review_deadline).toBe(want);
    // other rounds carry the field as null
    expect((await h.api('GET', '/v1/admin/rounds?state=SETTLED', admin)).body.rounds.every((r: any) => r.review_deadline === null)).toBe(true);

    expect((await h.api('POST', `/v1/admin/rounds/${rid}/void`, admin, { reason: 'test cleanup' })).status).toBe(200);
    expect((await h.api('GET', `/v1/rounds/${rid}`)).body.review_deadline).toBeNull();
  });
});

describe('6–7. per-currency stats and console totals', () => {
  it('my stats, the admin and org overviews and the org players list never add currencies together', async () => {
    const { owner, org } = await organizer();
    const p = await user('multi');
    await h.api('POST', `/v1/org/${org}/transfers`, owner.token, { email: p.email, mode: 'virtual-chips', amount_minor: 2_000 }, idemKey());
    await h.api('POST', `/v1/org/${org}/transfers`, owner.token, { email: p.email, mode: 'diamonds', amount_minor: 300 }, idemKey());
    const room = (await h.api('POST', `/v1/org/${org}/rooms`, owner.token, { name: 'Stats pool', table_id: 'sim-1', mode: 'virtual-chips', house: 'pool', rules: { margin_bps: 0, min_stake_minor: 100, rake_bps: 1000 }, visibility: 'public' })).body;
    const rid = await openRound();
    expect((await h.api('POST', '/v1/bets', p.token, { round_id: rid, selection_id: 'colour:mixed', stake_minor: 40, odds_centi: odds('colour:mixed') }, idemKey())).status).toBe(201);
    expect((await h.api('POST', '/v1/bets', p.token, { round_id: rid, selection_id: 'colour:mixed', stake_minor: 500, odds_centi: 100, room_id: room.id }, idemKey())).status).toBe(201);

    const stats = (await h.api('GET', '/v1/me/stats', p.token)).body;
    expect(stats).toMatchObject({ bets: 1, won: 0, lost: 0, staked_minor: 0, returned_minor: 0 }); // top level: play money, as before
    expect(stats.by_currency).toEqual([
      { mode: 'play', currency: 'PLAY', bets: 1, won: 0, lost: 0, staked_minor: 0, returned_minor: 0 },
      { mode: 'virtual-chips', currency: 'CHIP', bets: 1, won: 0, lost: 0, staked_minor: 0, returned_minor: 0 },
    ]);

    const ov = (await h.api('GET', '/v1/admin/overview', admin)).body;
    expect(ov.bets_24h).not.toHaveProperty('staked');
    const chips = ov.bets_24h.staked_by_currency.find((x: any) => x.currency === 'CHIP');
    expect(chips).toMatchObject({ mode: 'virtual-chips' });
    expect(chips.amount_minor).toBeGreaterThanOrEqual(500);
    expect(ov.bets_24h.staked_by_currency.find((x: any) => x.currency === 'PLAY').mode).toBe('play');

    const oo = (await h.api('GET', `/v1/org/${org}/overview`, owner.token)).body;
    expect(oo.turnover_by_currency).toEqual([{ currency: 'CHIP', mode: 'virtual-chips', amount_minor: 500 }]);
    expect(oo.ggr_by_currency).toEqual([{ currency: 'CHIP', mode: 'virtual-chips', amount_minor: 0 }]);
    expect(oo.series[0]).toMatchObject({ mode: 'virtual-chips', currency: 'CHIP', turnover_minor: 500 });

    const pl = (await h.api('GET', `/v1/org/${org}/players`, owner.token)).body.players.find((x: any) => x.user_id === p.id);
    expect(pl.balances).toEqual([{ currency: 'CHIP', mode: 'virtual-chips', amount_minor: 1_500 }, { currency: 'DIAMOND', mode: 'diamonds', amount_minor: 300 }]);
    // the deprecated single-currency fields are the first currency only, never a mixed sum
    expect([pl.balance_minor, pl.currency]).toEqual([1_500, 'CHIP']);
  });
});

describe('8. API hardening', () => {
  it('a garbage ?limit= is 400 on every list route, not a 500', async () => {
    const p = await user('limits');
    const { owner, org } = await organizer();
    for (const [url, token] of [['/v1/admin/rounds', admin], ['/v1/admin/users', admin], ['/v1/admin/ledger', admin], ['/v1/admin/audit', admin],
      [`/v1/org/${org}/rounds`, owner.token], ['/v1/me/bets', p.token]] as const) {
      for (const bad of ['abc', '1.5', '0', '-3', '']) {
        const r = await h.api('GET', `${url}?limit=${bad}`, token);
        expect(r.status, `${url}?limit=${bad}`).toBe(400);
        expect(r.body.type).toBe('bad_request');
      }
      expect((await h.api('GET', `${url}?limit=2`, token)).status).toBe(200);
      expect((await h.api('GET', `${url}?limit=999999`, token)).status).toBe(200); // capped, as before
    }
    const partner = await user('ptn');
    const pid = await ownedOrg(h, admin, { kind: 'partner', name: 'Limit Partner' }, partner);
    expect((await h.api('GET', `/v1/org/${pid}/bets?limit=nope`, partner.token)).status).toBe(400);
  });

  it('an unknown book channel is 400, not the direct book', async () => {
    expect((await h.api('GET', '/v1/book?channel=parnter')).status).toBe(400);
    expect((await h.api('GET', '/v1/book?channel=partner')).body.channel).toBe('partner');
    expect((await h.api('GET', '/v1/book')).body.channel).toBe('direct');
  });

  it('only an outcome-monitor pause (pause_kind) voids a dealt round, whatever the reason text says', async () => {
    const rid = await openRound();
    await h.db.query(`update rounds set state = 'DEALT', locked_at = clock_timestamp() where id = $1`, [rid]);
    // the PreFlop team pauses with a reason that merely starts with the old magic prefix
    expect((await h.api('PUT', '/v1/admin/tables/sim-1/status', admin, { status: 'paused', reason: 'outcome monitor check by hand' })).status).toBe(200);
    expect((await h.db.query('select pause_kind from poker_tables where id = $1', ['sim-1'])).rows[0].pause_kind).toBe('platform');
    const run = () => tx(h.db, (c) => resolve(c, rid, h.config, new EventBatch()));
    expect(await run()).toBe('waiting');
    await h.db.query(`update poker_tables set pause_kind = 'monitor' where id = 'sim-1'`);
    expect(await run()).toBe('void:monitor');
    expect((await h.api('PUT', '/v1/admin/tables/sim-1/status', admin, { status: 'active' })).status).toBe(200);
    expect((await h.db.query('select pause_kind from poker_tables where id = $1', ['sim-1'])).rows[0].pause_kind).toBeNull();
  });
});
