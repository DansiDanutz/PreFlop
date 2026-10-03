import { price } from '@preflop/odds-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hooks, priceAcceptable, statsOf } from '../src/bets/service.ts';
import { tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness, idemKey, ownedOrg, walletOf } from './helpers.ts';

/**
 * External audit F07–F09 and Activity paging: price acceptance bound to the price shown, the
 * player app's quote equal to the API's potential_payout_minor, a dropped response replayed by the
 * same key, and GET /v1/me/bets with a `before` cursor, wallet filters and the idempotency key.
 */
/** The player app's quote (apps/web/src/lib/quote.ts), loaded at run time: it is outside this package's rootDir. */
type Quote = { feeMinor: number; atRiskMinor: number; totalReturnMinor: number | null };
let betQuote: (stake: number, oddsCenti: number, room: { mode: string; house: string; rules: object } | null) => Quote | null;

let h: Harness;
let admin: string;
beforeAll(async () => {
  const quotePath = '../../web/src/lib/quote.ts';
  ({ betQuote } = (await import(/* @vite-ignore */ quotePath)) as { betQuote: typeof betQuote });
  h = await harness('betintent');
  await tx(h.db, (c) => seedAdmin(c, 'bi-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'bi-admin@test.dev', password: 'admin-pass-1' })).body.token;
  await h.api('PUT', '/v1/admin/settings/modes_enabled', admin, { value: { play: true, 'virtual-chips': true, diamonds: true, 'real-fiat': false, 'real-crypto': false } });
});
afterAll(async () => h?.close());

let n = 0;
async function user(name: string) {
  const email = `${name}-${++n}-${Date.now()}@bi.dev`;
  const r = await h.api('POST', '/v1/auth/register', undefined, { email, password: 'correct horse', display_name: name, date_of_birth: '1990-01-01', country: 'MT' });
  return { token: r.body.token as string, id: r.body.user.id as string, email };
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

/** An organizer with chips and diamonds in its treasury and collateral. */
async function organizer() {
  const owner = await user('org-owner');
  const org = await ownedOrg(h, admin, { kind: 'organizer', name: `BI Org ${n}` }, owner);
  expect((await h.api('POST', `/v1/org/${org}/chips/purchases`, owner.token, { chips: 50_000, pay_with: 'EUR' }, idemKey())).status).toBe(201);
  expect((await h.api('POST', `/v1/org/${org}/diamonds/purchases`, owner.token, { diamonds: 20_000, pay_with: 'USDT' }, idemKey())).status).toBe(201);
  expect((await h.api('POST', `/v1/org/${org}/collateral/deposits`, owner.token, { mode: 'virtual-chips', currency: 'CHIP', amount_minor: 20_000 }, idemKey())).status).toBe(200);
  expect((await h.api('POST', `/v1/org/${org}/collateral/deposits`, owner.token, { mode: 'diamonds', currency: 'DIAMOND', amount_minor: 8_000 }, idemKey())).status).toBe(200);
  return { owner, org };
}
async function room(owner: { token: string }, org: string, body: Record<string, unknown>) {
  const r = await h.api('POST', `/v1/org/${org}/rooms`, owner.token, { name: `Room ${++n}`, table_id: 'sim-1', visibility: 'public', ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return (await h.api('GET', `/v1/rooms/${r.body.id}`)).body as { id: string; mode: 'virtual-chips' | 'diamonds'; house: 'organizer' | 'pool'; rules: { margin_bps: number; min_stake_minor: number; rake_bps?: number }; odds: Record<string, number | null> };
}

describe('F08: accept_price_change binds to the price the player was shown', () => {
  it('unit: without the flag the price must match; with it, the current price must be at least the one sent', () => {
    expect(priceAcceptable(500, { oddsCenti: 500 })).toBe(true);
    expect(priceAcceptable(510, { oddsCenti: 500 })).toBe(false);
    expect(priceAcceptable(500, { oddsCenti: 500, acceptPriceChange: true })).toBe(true);
    expect(priceAcceptable(520, { oddsCenti: 500, acceptPriceChange: true })).toBe(true);
    expect(priceAcceptable(480, { oddsCenti: 500, acceptPriceChange: true })).toBe(false);
  });

  it('direct: stale odds + accept is refused with the current price; sending that price places the bet', async () => {
    const p = await user('px');
    const rid = await openRound();
    const cur = odds('rank-pattern:pair');
    const body = { round_id: rid, selection_id: 'rank-pattern:pair', stake_minor: 10 };
    // The old behaviour accepted ANY odds with the flag: a stale higher price is now a new price_changed.
    const stale = await h.api('POST', '/v1/bets', p.token, { ...body, odds_centi: cur + 50, accept_price_change: true }, key('px'));
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ type: 'price_changed', odds_centi: cur });
    const ok = await h.api('POST', '/v1/bets', p.token, { ...body, odds_centi: stale.body.odds_centi, accept_price_change: true }, key('px'));
    expect(ok.status).toBe(201);
    expect(ok.body.odds_centi).toBe(cur);
    // A price that moved in the player's favour since is fine: the bet takes the current price.
    const better = await h.api('POST', '/v1/bets', p.token, { ...body, odds_centi: cur - 5, accept_price_change: true }, key('px'));
    expect(better.status).toBe(201);
    expect(better.body.odds_centi).toBe(cur);
    expect(await walletOf(h, p.token)).toBe(10_000 - 20);
  });

  it('organizer room: a second price change needs a fresh acceptance', async () => {
    const { owner, org } = await organizer();
    const p = await user('rpx');
    await h.api('POST', `/v1/org/${org}/transfers`, owner.token, { email: p.email, mode: 'virtual-chips', amount_minor: 5_000 }, idemKey());
    const r = await room(owner, org, { mode: 'virtual-chips', house: 'organizer', rules: { margin_bps: 800, min_stake_minor: 100 } });
    const sel = 'colour:mixed';
    const shown = r.odds[sel]!;
    const setMargin = async (m: number) => (await h.api('PUT', `/v1/org/${org}/rooms/${r.id}`, owner.token, { rules: { margin_bps: m, min_stake_minor: 100 } })).status;
    const oddsNow = async () => (await h.api('GET', `/v1/rooms/${r.id}`)).body.odds[sel] as number;
    const rid = await openRound();
    const k = key('rpx');
    const body = { round_id: rid, selection_id: sel, stake_minor: 200, room_id: r.id };

    expect(await setMargin(1200)).toBe(200); // price 1 → price 2 (worse)
    const p2 = await oddsNow();
    expect(p2).toBeLessThan(shown);
    const first = await h.api('POST', '/v1/bets', p.token, { ...body, odds_centi: shown }, k);
    expect(first.body).toMatchObject({ type: 'price_changed', odds_centi: p2 });

    expect(await setMargin(1600)).toBe(200); // price 2 → price 3 before the player taps Accept
    const p3 = await oddsNow();
    expect(p3).toBeLessThan(p2);
    const accepted2 = await h.api('POST', '/v1/bets', p.token, { ...body, odds_centi: p2, accept_price_change: true }, k);
    expect(accepted2.status).toBe(409);
    expect(accepted2.body).toMatchObject({ type: 'price_changed', odds_centi: p3 });

    const accepted3 = await h.api('POST', '/v1/bets', p.token, { ...body, odds_centi: p3, accept_price_change: true }, k);
    expect(accepted3.status, JSON.stringify(accepted3.body)).toBe(201);
    expect(accepted3.body.odds_centi).toBe(p3);
    expect((await h.db.query('select count(*)::int as n from bets where user_id = $1', [p.id])).rows[0].n).toBe(1);
  });
});

describe('F09: the player app quote equals potential_payout_minor', () => {
  it('direct, diamond house, diamond pool, chip house and chip pool, across stakes that round', async () => {
    const { owner, org } = await organizer();
    const p = await user('quote');
    await h.api('POST', `/v1/org/${org}/transfers`, owner.token, { email: p.email, mode: 'virtual-chips', amount_minor: 10_000 }, idemKey());
    await h.api('POST', `/v1/org/${org}/transfers`, owner.token, { email: p.email, mode: 'diamonds', amount_minor: 5_000 }, idemKey());
    const rooms = [
      await room(owner, org, { mode: 'diamonds', house: 'organizer', rules: { margin_bps: 800, min_stake_minor: 20, rake_bps: 500 } }),
      await room(owner, org, { mode: 'diamonds', house: 'pool', rules: { margin_bps: 0, min_stake_minor: 20, rake_bps: 700 } }),
      await room(owner, org, { mode: 'virtual-chips', house: 'organizer', rules: { margin_bps: 900, min_stake_minor: 100 } }),
      await room(owner, org, { mode: 'virtual-chips', house: 'pool', rules: { margin_bps: 0, min_stake_minor: 100, rake_bps: 1000 } }),
    ];
    const rid = await openRound();
    const checked: string[] = [];
    for (const sel of ['colour:mixed', 'hand-class:pair']) {
      for (const stake of [137, 333]) {
        // direct (free chips)
        const o = odds(sel);
        const d = await h.api('POST', '/v1/bets', p.token, { round_id: rid, selection_id: sel, stake_minor: stake, odds_centi: o }, key('q'));
        expect(d.status, JSON.stringify(d.body)).toBe(201);
        expect(d.body.potential_payout_minor).toBe(betQuote(stake, o, null)!.totalReturnMinor);
        checked.push('direct');
        for (const r of rooms) {
          const ro = r.odds[sel]!;
          const res = await h.api('POST', '/v1/bets', p.token, { round_id: rid, selection_id: sel, stake_minor: stake, odds_centi: ro, room_id: r.id }, key('q'));
          expect(res.status, JSON.stringify(res.body)).toBe(201);
          const q = betQuote(stake, ro, r)!;
          expect(res.body.potential_payout_minor, `${r.mode}/${r.house} ${stake}`).toBe(q.totalReturnMinor ?? 0);
          const row = (await h.db.query('select at_risk_minor, fee_minor from bets where id = $1', [res.body.bet_id])).rows[0];
          expect(row.at_risk_minor, `${r.mode}/${r.house} at risk`).toBe(q.atRiskMinor);
          // fee_minor stamps PreFlop's fee whoever pays it; the quote shows the part taken from the stake.
          if (r.mode === 'diamonds' || r.house === 'pool') expect(row.fee_minor).toBe(q.feeMinor);
          if (r.mode === 'diamonds' && r.house === 'organizer') expect(q.totalReturnMinor!).toBeLessThan(Math.floor((stake * ro) / 100)); // gross overstated it
          checked.push(`${r.mode}/${r.house}`);
        }
      }
    }
    expect(new Set(checked).size).toBe(5);
  });
});

describe('F07: a dropped response is replayed by the same key', () => {
  it('commit, crash before the response, retry with the same key: the same bet, one debit', async () => {
    const p = await user('drop');
    const rid = await openRound();
    const body = { round_id: rid, selection_id: 'colour:mixed', stake_minor: 300, odds_centi: odds('colour:mixed') };
    const k = key('drop');
    hooks.afterCommit = () => { throw new Error('response lost'); };
    const lost = await h.api('POST', '/v1/bets', p.token, body, k);
    hooks.afterCommit = undefined;
    expect(lost.status).toBe(500);
    const retry = await h.api('POST', '/v1/bets', p.token, body, k);
    expect(retry.status).toBe(201);
    expect(await walletOf(h, p.token)).toBe(9_700);
    // And GET /v1/me/bets tells the client which bet its key produced.
    const mine = (await h.api('GET', `/v1/me/bets?round_id=${encodeURIComponent(rid)}`, p.token)).body.bets;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ bet_id: retry.body.bet_id, idempotency_key: k['idempotency-key'] });
  });
});

describe('GET /v1/me/bets: pages and wallet filters', () => {
  it('pages with before (no gaps, no repeats) and filters by wallet', async () => {
    const { owner, org } = await organizer();
    const p = await user('pages');
    await h.api('POST', `/v1/org/${org}/transfers`, owner.token, { email: p.email, mode: 'diamonds', amount_minor: 1_000 }, idemKey());
    const r = await room(owner, org, { mode: 'diamonds', house: 'organizer', rules: { margin_bps: 800, min_stake_minor: 20, rake_bps: 500 } });
    const rid = await openRound();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await h.api('POST', '/v1/bets', p.token, { round_id: rid, selection_id: 'colour:mixed', stake_minor: 10 + i, odds_centi: odds('colour:mixed') }, key('pg'))).body.bet_id);
    for (let i = 0; i < 2; i++) ids.push((await h.api('POST', '/v1/bets', p.token, { round_id: rid, selection_id: 'colour:mixed', stake_minor: 20 + i, odds_centi: r.odds['colour:mixed'], room_id: r.id }, key('pg'))).body.bet_id);

    const seen: string[] = [];
    let before: string | null = null;
    for (let page = 0; page < 10; page++) {
      const res = await h.api('GET', `/v1/me/bets?limit=3${before ? `&before=${before}` : ''}`, p.token);
      expect(res.status).toBe(200);
      seen.push(...res.body.bets.map((b: any) => b.bet_id));
      before = res.body.next_before;
      if (!before) break;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen)).toEqual(new Set(ids));

    const diamonds = (await h.api('GET', '/v1/me/bets?mode=diamonds&currency=DIAMOND', p.token)).body.bets;
    expect(diamonds.map((b: any) => b.currency)).toEqual(['DIAMOND', 'DIAMOND']);
    expect((await h.api('GET', `/v1/me/bets?room_id=${r.id}`, p.token)).body.bets).toHaveLength(2);
    expect((await h.api('GET', '/v1/me/bets?room_id=none', p.token)).body.bets).toHaveLength(5);
    expect((await h.api('GET', '/v1/me/bets?status=won', p.token)).body.bets).toHaveLength(0);
    // another player's bet id as a cursor reveals nothing
    const other = await user('other');
    expect((await h.api('GET', `/v1/me/bets?before=${ids[6]}`, other.token)).body.bets).toEqual([]);
    expect((await h.api('GET', `/v1/me/bets?before=${'x'.repeat(300)}`, p.token)).status).toBe(400);
  });
});
