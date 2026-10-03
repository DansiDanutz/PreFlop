import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { payoutMinor } from '@preflop/odds-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pruneNonces } from '../src/auth/envelope.ts';
import { createSession } from '../src/auth/players.ts';
import { placeBet } from '../src/bets/service.ts';
import { tx } from '../src/lib/db.ts';
import { EventBatch } from '../src/lib/events.ts';
import { balance } from '../src/lib/ledger.ts';
import { defaultRoundLossMinor, maxStakeMinor, minorDigits } from '../src/lib/limits.ts';
import { deliverDue } from '../src/routes/partner.ts';
import { seedAdmin, seedSimTable } from '../src/seed.ts';
import { SimTable, keysToFile } from '../src/sim/tableSim.ts';
import { type Harness, harness, ledgerSums, ownedOrg, realMoneyReady } from './helpers.ts';

/**
 * Money and integrity fixes from the external audit (migration 012): per-table real-money approval,
 * real-money reviews by the PreFlop team, partner suspension, idempotent partner deposits, claimed
 * webhook deliveries, nonce pruning, per-currency limits, the per-player round payout cap and the
 * potential payout shown in the bet list.
 */
let h: Harness;
let admin: string;
beforeAll(async () => {
  process.env.WEBHOOK_ALLOW_PRIVATE = 'true'; // the webhook receiver below listens on 127.0.0.1
  h = await harness('money');
  await tx(h.db, (c) => seedAdmin(c, 'mi-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'mi-admin@test.dev', password: 'admin-pass-1' })).body.token;
});
afterAll(async () => {
  delete process.env.WEBHOOK_ALLOW_PRIVATE;
  await h?.close();
});

let n = 0;
async function user(name: string) {
  const email = `${name}-${++n}-${Date.now()}@mi.dev`;
  const r = await h.api('POST', '/v1/auth/register', undefined, { email, password: 'correct horse', display_name: name, date_of_birth: '1990-01-01', country: 'MT' });
  await realMoneyReady(h, r.body.user.id); // verified email, licensed country: these tests are about the table gates
  return { token: r.body.token as string, id: r.body.user.id as string, email };
}
const odds = async (sel: string) => (await h.api('GET', '/v1/book')).body.markets.flatMap((m: any) => m.selections).find((s: any) => s.id === sel).odds_centi as number;
let k = 0;
const betOn = async (token: string, roundId: string, sel: string, stake: number, extra: Record<string, unknown> = {}) =>
  h.api('POST', '/v1/bets', token, { round_id: roundId, selection_id: sel, stake_minor: stake, odds_centi: await odds(sel), ...extra }, { 'idempotency-key': `mi-${++k}-${Date.now()}` });
const modes = (real: boolean) => h.api('PUT', '/v1/admin/settings/modes_enabled', admin, { value: { play: true, 'virtual-chips': true, diamonds: true, 'real-fiat': real, 'real-crypto': real } });
async function openOn(sim: SimTable): Promise<number> {
  await sim.heartbeat();
  await h.work();
  const hand = await sim.openHand();
  if (hand === null) throw new Error('no open round');
  return hand;
}

describe('B1/B1b: real money only at PreFlop-approved tables, reviewed by PreFlop', () => {
  let owner: Awaited<ReturnType<typeof user>>;
  let player: Awaited<ReturnType<typeof user>>;
  let club: string;
  let sim: SimTable;
  const T = 'rm-1';
  const approve = (approved: boolean, token = admin, table = T) => h.api('PUT', `/v1/admin/tables/${table}/real-money`, token, { approved });

  beforeAll(async () => {
    await modes(true);
    owner = await user('rm-owner');
    club = await ownedOrg(h, admin, { kind: 'club', name: 'Real Club' }, owner);
    sim = new SimTable(h.send, keysToFile(await tx(h.db, (c) => seedSimTable(c, { clubId: club, tableId: T, name: 'Real Table', mode: 'real-fiat', currency: 'EUR' }))));
    player = await user('rm-player');
    await h.api('POST', '/v1/me/kyc', player.token, {});
    expect((await h.api('POST', '/v1/me/deposits', player.token, { mode: 'real-fiat', currency: 'EUR', amount_minor: 50_000, method: 'card' })).status).toBe(201);
  });
  afterAll(async () => { await modes(false); });

  it('refuses real-money bets until approved; only admin/ops approve, and only real-money tables', async () => {
    const hand = await openOn(sim);
    const rid = `${T}:h${hand}`;
    const refused = await betOn(player.token, rid, 'colour:mixed', 1_000);
    expect(refused.status).toBe(403);
    expect(refused.body.type).toBe('table_not_approved');

    const risk = await user('rm-risk');
    await h.api('PUT', `/v1/admin/users/${risk.id}`, admin, { platform_role: 'risk' });
    expect((await approve(true, risk.token)).body.type).toBe('forbidden_role');
    // A play table can be approved too: real-money tournaments may bet on it (and revoked again).
    expect((await approve(true, admin, 'sim-1')).status).toBe(200);
    expect((await approve(false, admin, 'sim-1')).status).toBe(200);
    const ok = await approve(true);
    expect(ok.status).toBe(200);
    expect(ok.body.real_money_approved_by).toBeTruthy();
    const listed = (await h.api('GET', '/v1/admin/tables', admin)).body.tables.find((t: any) => t.id === T);
    expect(listed.real_money_approved_at).toBeTruthy();

    expect((await betOn(player.token, rid, 'colour:mixed', 1_000)).status).toBe(201);
    // revoking stops new real-money bets at once
    expect((await approve(false)).status).toBe(200);
    expect((await betOn(player.token, rid, 'colour:mixed', 1_000)).body.type).toBe('table_not_approved');
    const events = (await h.api('GET', '/v1/admin/audit', admin)).body.events.map((e: any) => JSON.parse(e.event).type);
    expect(events).toEqual(expect.arrayContaining(['table.real_money_approved', 'table.real_money_revoked']));
    expect((await h.api('POST', `/v1/admin/rounds/${rid}/void`, admin, { reason: 'cleanup' })).status).toBe(200);
  });

  it('a club certification change or a mode change clears the approval; the routine shift check keeps it', async () => {
    expect((await approve(true)).status).toBe(200);
    const cert = (items: Record<string, boolean>) => h.api('PUT', `/v1/org/${club}/tables/${T}/certification`, owner.token, { items });
    const approvedAt = async () => (await h.db.query('select real_money_approved_at from poker_tables where id = $1', [T])).rows[0].real_money_approved_at;

    const shift = await cert({ shufflerSealsVerifiedThisShift: true, privacyMasksVerified: true });
    expect(shift.status).toBe(200);
    expect(shift.body.real_money_approved_at).toBeTruthy();
    expect(await approvedAt()).not.toBeNull();

    const edit = await cert({ camerasApproved: true });
    expect(edit.body.real_money_approved_at).toBeNull();
    expect(await approvedAt()).toBeNull();

    // A per-shift item set to false is a change too.
    expect((await approve(true)).status).toBe(200);
    await cert({ boardCameraCalibrated: false });
    expect(await approvedAt()).toBeNull();
    await cert({ boardCameraCalibrated: true });

    // Any path that changes what was approved (here: the mode) clears it, by trigger.
    expect((await approve(true)).status).toBe(200);
    await h.db.query(`update poker_tables set mode = 'real-crypto', currency = 'USDT' where id = $1`, [T]);
    expect(await approvedAt()).toBeNull();
    await h.db.query(`update poker_tables set mode = 'real-fiat', currency = 'EUR' where id = $1`, [T]);
    // ...but the link heartbeat and other updates do not.
    expect((await approve(true)).status).toBe(200);
    await sim.heartbeat();
    expect(await approvedAt()).not.toBeNull();
  });

  it('a real-money review is decided by the PreFlop team, never by the club floor manager', async () => {
    const hand = await openOn(sim);
    const rid = `${T}:h${hand}`;
    const b = await betOn(player.token, rid, 'colour:mixed', 1_000);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    await h.db.query(`update rounds set state = 'REVIEW', review_started_at = clock_timestamp(), review_reasons = '["test"]' where id = $1`, [rid]);
    const cards = ['Ah', 'Kd', '2s']; // mixed colours: the bet wins

    const fm = await sim.call('floor_manager', 'POST', `/v1/provider/rounds/${rid}/review`, { action: 'settle', cards });
    expect(fm.status).toBe(403);
    expect(fm.body.type).toBe('platform_review_required');
    const fmVoid = await sim.call('floor_manager', 'POST', `/v1/provider/rounds/${rid}/review`, { action: 'void', reason: 'misdeal' });
    expect(fmVoid.body.type).toBe('platform_review_required');
    // The general void route can't be used to cancel a dealt real-money round either.
    const handVoid = await sim.call('floor_manager', 'POST', `/v1/provider/tables/${T}/hands/${hand}/void`, { reason: 'misdeal' });
    expect(handVoid.status).toBe(403);
    expect(handVoid.body.type).toBe('platform_review_required');

    const before = await balance(h.db as never, `${player.id}:wallet:real-fiat:EUR`);
    const ok = await h.api('POST', `/v1/admin/rounds/${rid}/review`, admin, { action: 'settle', cards });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.state).toBe('SETTLED');
    expect(await balance(h.db as never, `${player.id}:wallet:real-fiat:EUR`)).toBe(before + b.body.potential_payout_minor);
    expect((await h.api('POST', `/v1/admin/rounds/${rid}/review`, admin, { action: 'settle', cards })).body.type).toBe('invalid_round_state');
    const audited = (await h.api('GET', '/v1/admin/audit', admin)).body.events.map((e: any) => JSON.parse(e.event)).find((e: any) => e.type === 'round.settled' && e.roundId === rid);
    expect(audited.by).toMatch(/^user:/);
    for (const s of await ledgerSums(h.db)) expect(Number(s.total)).toBe(0);
  });

  it('before the deal, the club may still void a real-money round (misdeal) and every stake is refunded', async () => {
    const hand = await openOn(sim);
    const rid = `${T}:h${hand}`;
    const before = await balance(h.db as never, `${player.id}:wallet:real-fiat:EUR`);
    expect((await betOn(player.token, rid, 'colour:mixed', 1_000)).status).toBe(201);
    const v = await sim.call('floor_manager', 'POST', `/v1/provider/tables/${T}/hands/${hand}/void`, { reason: 'misdeal' });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(await balance(h.db as never, `${player.id}:wallet:real-fiat:EUR`)).toBe(before);
  });

  it('play tables keep the club review; the team cannot settle them', async () => {
    const hand = await openOn(h.sim);
    const rid = `sim-1:h${hand}`;
    await h.db.query(`update rounds set state = 'REVIEW', review_started_at = clock_timestamp() where id = $1`, [rid]);
    const r = await h.api('POST', `/v1/admin/rounds/${rid}/review`, admin, { action: 'settle', cards: ['Ah', 'Kd', '2s'] });
    expect(r.status).toBe(403);
    expect(r.body.type).toBe('club_review_required');
    expect((await h.sim.call('floor_manager', 'POST', `/v1/provider/rounds/${rid}/review`, { action: 'void', reason: 'test' })).status).toBe(200);
  });

  it('a club creates a real-money table unapproved, with a round loss limit in its currency', async () => {
    const t = await h.api('POST', `/v1/org/${club}/tables`, owner.token, { name: 'USDT 1', kind: 'simulated', mode: 'real-crypto', currency: 'USDT' });
    expect(t.status).toBe(201);
    const row = (await h.db.query('select max_round_loss_minor, real_money_approved_at from poker_tables where id = $1', [t.body.id])).rows[0];
    expect(row.real_money_approved_at).toBeNull();
    expect(row.max_round_loss_minor).toBe(100_000 * 1_000_000); // 100,000 USDT, not 10 USDT
    const listed = (await h.api('GET', `/v1/org/${club}/tables`, owner.token)).body.tables.find((x: any) => x.id === t.body.id);
    expect(listed.real_money_approved_at).toBeNull();
  });
});

describe('B2: suspending a partner signs out and blocks its players', () => {
  it('client revoke and org suspension end player sessions; a suspended partner\'s players get 403 partner_suspended', async () => {
    const owner = await user('ps-owner');
    const org = await ownedOrg(h, admin, { kind: 'partner', name: 'Suspend Co' }, owner);
    const client = async () => {
      const c = (await h.api('POST', `/v1/org/${org}/api-clients`, owner.token, { name: `c${++n}` })).body;
      const tok = (await h.api('POST', '/v1/partner/oauth/token', undefined, { grant_type: 'client_credentials', client_id: c.id, client_secret: c.secret })).body.access_token;
      return { id: c.id as string, auth: { authorization: `Bearer ${tok}` } };
    };
    const c1 = await client();
    const s1 = (await h.api('POST', '/v1/partner/players/ps-1/session', undefined, {}, c1.auth)).body;
    expect((await h.api('GET', '/v1/me', s1.token)).status).toBe(200);
    expect((await h.api('POST', `/v1/org/${org}/api-clients/${c1.id}/revoke`, owner.token)).status).toBe(200);
    expect((await h.api('GET', '/v1/me', s1.token)).status).toBe(401);

    const c2 = await client();
    const s2 = (await h.api('POST', '/v1/partner/players/ps-1/session', undefined, {}, c2.auth)).body;
    expect((await h.api('GET', '/v1/me', s2.token)).status).toBe(200);
    expect((await h.api('PUT', `/v1/admin/orgs/${org}/status`, admin, { status: 'suspended' })).status).toBe(200);
    expect((await h.api('GET', '/v1/me', s2.token)).status).toBe(401);

    // A session that survives somehow (made directly here) is refused while the partner is suspended.
    const leftover = await createSession(h.db, s2.user_id);
    const me = await h.api('GET', '/v1/me', leftover);
    expect(me.status).toBe(403);
    expect(me.body.type).toBe('partner_suspended');
    // ...and so is the bet path itself.
    const hand = await openOn(h.sim);
    const err = await placeBet(h.db, { userId: s2.user_id, idempotencyKey: 'ps-bet-0001', roundId: `sim-1:h${hand}`, selectionId: 'colour:mixed', stakeMinor: 10, oddsCenti: await odds('colour:mixed') },
      new EventBatch(), async () => true).catch((e) => e);
    expect([err.status, err.type]).toEqual([403, 'partner_suspended']);

    expect((await h.api('PUT', `/v1/admin/orgs/${org}/status`, admin, { status: 'active' })).status).toBe(200);
    expect((await h.api('GET', '/v1/me', leftover)).status).toBe(200);
  });
});

describe('B4: partner deposits are idempotent', () => {
  it('the same Idempotency-Key credits once and returns the original response', async () => {
    const owner = await user('pd-owner');
    const org = await ownedOrg(h, admin, { kind: 'partner', name: 'Deposit Co' }, owner);
    const c = (await h.api('POST', `/v1/org/${org}/api-clients`, owner.token, { name: 'c' })).body;
    const tok = (await h.api('POST', '/v1/partner/oauth/token', undefined, { grant_type: 'client_credentials', client_id: c.id, client_secret: c.secret })).body.access_token;
    expect((await h.api('POST', `/v1/org/${org}/chips/purchases`, owner.token, { chips: 1_000, pay_with: 'EUR' })).status).toBe(201);
    const dep = (body: unknown, key?: string) => h.api('POST', '/v1/partner/players/pd-1/deposits', undefined, body,
      { authorization: `Bearer ${tok}`, ...(key ? { 'idempotency-key': key } : {}) });

    expect((await dep({ amount_minor: 100 })).status).toBe(400);
    const first = await dep({ amount_minor: 100 }, 'deposit-key-0001');
    expect(first.status).toBe(201);
    const again = await dep({ amount_minor: 100 }, 'deposit-key-0001');
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    const mismatch = await dep({ amount_minor: 999 }, 'deposit-key-0001');
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.type).toBe('idempotency_mismatch');

    // concurrent retries with one key still credit once
    const both = await Promise.all([dep({ amount_minor: 50 }, 'deposit-key-0002'), dep({ amount_minor: 50 }, 'deposit-key-0002')]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect(both[0]!.body).toEqual(both[1]!.body);

    const uid = (await h.db.query(`select id from users where partner_id = $1 and external_ref = 'pd-1'`, [org])).rows[0].id;
    expect(await balance(h.db as never, `${uid}:wallet:virtual-chips:CHIP`)).toBe(150);
    expect(await balance(h.db as never, `${org}:treasury:virtual-chips:CHIP`)).toBe(850);
    for (const s of await ledgerSums(h.db)) expect(Number(s.total)).toBe(0);
  });
});

describe('M1: webhook deliveries are claimed', () => {
  it('two concurrent deliverDue calls send each delivery exactly once; stale claims are taken over', async () => {
    const hits = new Map<string, number>();
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const id = JSON.parse(body).event_id as string;
        hits.set(id, (hits.get(id) ?? 0) + 1);
        setTimeout(() => res.writeHead(200).end('ok'), 20);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
      const owner = await user('wh-owner');
      const org = await ownedOrg(h, admin, { kind: 'partner', name: 'Hook Co' }, owner);
      await h.db.query(`insert into webhooks (id, org_id, url, secret, events) values ('wh-mi', $1, $2, 'whsec_test', '{bet.settled}')`, [org, url]);
      const ins = (id: string, extra = '') => h.db.query(
        `insert into webhook_deliveries (id, webhook_id, event_id, event_type, payload${extra ? ', status, claimed_at' : ''})
         values ($1, 'wh-mi', $1, 'bet.settled', $2${extra})`, [id, JSON.stringify({ event_id: id, type: 'bet.settled' })]);
      for (let i = 0; i < 12; i++) await ins(`evt-${i}`);

      const sent = await Promise.all([deliverDue(h.db, 50), deliverDue(h.db, 50), deliverDue(h.db, 50)]);
      expect(sent.reduce((a, x) => a + x, 0)).toBe(12);
      expect([...hits.values()].every((x) => x === 1)).toBe(true);
      expect(hits.size).toBe(12);
      const rows = (await h.db.query(`select status, attempts, claimed_at from webhook_deliveries where webhook_id = 'wh-mi'`)).rows;
      expect(rows.every((r) => r.status === 'delivered' && r.attempts === 1 && r.claimed_at === null)).toBe(true);

      // A claim older than the stale timeout is taken over; a fresh one is left to its sender.
      await ins('evt-stale', `, 'sending', now() - interval '10 minutes'`);
      await ins('evt-busy', `, 'sending', now()`);
      expect(await deliverDue(h.db, 50)).toBe(1);
      expect(hits.get('evt-stale')).toBe(1);
      expect(hits.has('evt-busy')).toBe(false);
      // The late sender's outcome is ignored once its claim was taken over (attempts moved on).
      const late = await h.db.query(`update webhook_deliveries set status = 'failed' where id = 'evt-stale' and status = 'sending' and attempts = 0`);
      expect(late.rowCount).toBe(0);
      expect((await h.db.query(`select status from webhook_deliveries where id = 'evt-stale'`)).rows[0].status).toBe('delivered');
      const m = (await h.api('GET', '/v1/admin/metrics', admin)).body;
      expect(m.webhook_deliveries.pending).toBeGreaterThanOrEqual(1); // the in-flight one counts as pending
    } finally {
      server.close();
    }
  });
});

describe('M4: request nonces are pruned', () => {
  it('deletes nonces past the retention in batches and keeps recent ones', async () => {
    const add = (cred: string, count: number, age: string) => h.db.query(
      `insert into request_nonces (credential_id, nonce, seen_at) select $1, 'n' || g, now() - $2::interval from generate_series(1, $3) g`, [cred, age, count]);
    const left = async () => Object.fromEntries((await h.db.query(
      `select credential_id, count(*)::int as n from request_nonces where credential_id like 'nx-%' group by 1`)).rows.map((r) => [r.credential_id, r.n]));
    await add('nx-old', 7, '20 minutes');
    await add('nx-mid', 3, '2 minutes');
    await add('nx-now', 2, '0 seconds');
    // default retention (10 minutes), in batches of 2
    expect(await pruneNonces(h.db, { batch: 2 })).toBeGreaterThanOrEqual(7);
    expect(await left()).toEqual({ 'nx-mid': 3, 'nx-now': 2 });
    // a retention below twice the ±30 s window is raised to it: a nonce still usable is never pruned
    await pruneNonces(h.db, { retentionMs: 0 });
    expect(await left()).toEqual({ 'nx-now': 2 });
  });
});

describe('P2: per-currency limits', () => {
  it('scales the stake cap and the default round loss limit by the minor-unit digits', () => {
    expect([minorDigits('EUR'), minorDigits('USDT'), minorDigits('PLAY')]).toEqual([2, 6, 0]);
    expect(maxStakeMinor('EUR')).toBe(1_000_000); // €10,000
    expect(maxStakeMinor('USDT')).toBe(10_000_000_000); // 10,000 USDT
    expect(maxStakeMinor('PLAY')).toBe(1_000_000);
    expect(defaultRoundLossMinor('EUR')).toBe(10_000_000); // €100,000 (the old raw default)
    expect(defaultRoundLossMinor('USDC')).toBe(100_000_000_000);
    expect(defaultRoundLossMinor('PLAY')).toBe(5_000_000);
  });

  it('refuses a stake above the currency cap', async () => {
    const p = await user('cap');
    const hand = await openOn(h.sim);
    const r = await betOn(p.token, `sim-1:h${hand}`, 'colour:mixed', 1_000_001);
    expect(r.status).toBe(422);
    expect(r.body.type).toBe('invalid_stake');
  });
});

describe('P3: per-player payout cap per round', () => {
  it('two bets that each pass but together exceed the cap: the second gets 403 user_round_limit', async () => {
    const o = await odds('colour:all-red');
    const one = payoutMinor(100, o);
    await h.db.query('update poker_tables set max_user_round_payout_minor = $2 where id = $1', ['sim-1', one + Math.floor(one / 2)]);
    try {
      const p = await user('cap-a');
      const q = await user('cap-b');
      const hand = await openOn(h.sim);
      const rid = `sim-1:h${hand}`;
      expect((await betOn(p.token, rid, 'colour:all-red', 100)).status).toBe(201);
      const second = await betOn(p.token, rid, 'colour:all-black', 100);
      expect(second.status).toBe(403);
      expect(second.body.type).toBe('user_round_limit');
      expect((await betOn(q.token, rid, 'colour:all-black', 100)).status).toBe(201); // the cap is per player

      // race: two bets of one player at once, each alone within the cap
      const r = await user('cap-race');
      const both = await Promise.all([betOn(r.token, rid, 'colour:all-red', 100), betOn(r.token, rid, 'colour:all-black', 100)]);
      expect(both.map((x) => x.status).sort()).toEqual([201, 403]);

      await h.sim.call('floor_manager', 'POST', `/v1/provider/tables/sim-1/hands/${hand}/void`, { reason: 'cleanup' });

      // default (null): the per-bet maximum, the table's round loss limit
      await h.db.query('update poker_tables set max_user_round_payout_minor = null, max_round_loss_minor = $2 where id = $1', ['sim-1', one + Math.floor(one / 2)]);
      const fresh = `sim-1:h${await openOn(h.sim)}`;
      const s = await user('cap-default');
      expect((await betOn(s.token, fresh, 'colour:all-red', 100)).status).toBe(201);
      expect((await betOn(s.token, fresh, 'colour:all-red', 100)).body.type).toBe('user_round_limit');
      await h.sim.call('floor_manager', 'POST', `/v1/provider/tables/sim-1/hands/${fresh.split(':h')[1]}/void`, { reason: 'cleanup' });
    } finally {
      await h.db.query('update poker_tables set max_user_round_payout_minor = null, max_round_loss_minor = 5000000 where id = $1', ['sim-1']);
    }
  });
});

describe('P1: the bet list shows what settlement would pay', () => {
  it('direct bets, pool bets (0) and at-risk stakes match placement and settlement', async () => {
    const owner = await user('p1-owner');
    const p = await user('p1-player');
    const org = await ownedOrg(h, admin, { kind: 'organizer', name: 'P1 Pools' }, owner);
    expect((await h.api('POST', `/v1/org/${org}/chips/purchases`, owner.token, { chips: 5_000, pay_with: 'EUR' })).status).toBe(201);
    await h.api('POST', `/v1/org/${org}/transfers`, owner.token, { email: p.email, mode: 'virtual-chips', amount_minor: 1_000 });
    const room = (await h.api('POST', `/v1/org/${org}/rooms`, owner.token, { name: 'P1 pool', table_id: 'sim-1', mode: 'virtual-chips', house: 'pool', rules: { margin_bps: 0, min_stake_minor: 100, rake_bps: 1000 }, visibility: 'public' })).body;
    const hand = await openOn(h.sim);
    const rid = `sim-1:h${hand}`;
    const direct = await betOn(p.token, rid, 'colour:mixed', 200);
    const pool = await h.api('POST', '/v1/bets', p.token, { round_id: rid, selection_id: 'colour:mixed', stake_minor: 500, odds_centi: 100, room_id: room.id }, { 'idempotency-key': `p1-pool-${Date.now()}` });
    expect([direct.status, pool.status]).toEqual([201, 201]);
    expect(pool.body.potential_payout_minor).toBe(0);
    // An organizer bet whose fees came out of the stake: only the at-risk part plays.
    await h.db.query(`insert into bets (id, idempotency_key, user_id, round_id, selection_id, stake_minor, odds_centi, mode, currency, status, house_kind, house_owner, at_risk_minor)
                      values ('bet-p1-atrisk', 'p1-atrisk', $1, $2, 'colour:mixed', 100, 250, 'diamonds', 'DIAMOND', 'accepted', 'organizer', $3, 90)`, [p.id, rid, org]);

    const list = (await h.api('GET', `/v1/me/bets?round_id=${encodeURIComponent(rid)}`, p.token)).body.bets;
    const byId = new Map(list.map((b: any) => [b.bet_id, b.potential_payout_minor]));
    expect(byId.get(direct.body.bet_id)).toBe(direct.body.potential_payout_minor);
    expect(byId.get(direct.body.bet_id)).toBe(payoutMinor(200, direct.body.odds_centi));
    expect(byId.get(pool.body.bet_id)).toBe(0);
    expect(byId.get('bet-p1-atrisk')).toBe(payoutMinor(90, 250));
    expect(list.every((b: any) => !('at_risk_minor' in b))).toBe(true);
    await h.db.query(`delete from bets where id = 'bet-p1-atrisk'`);
    await h.sim.call('floor_manager', 'POST', `/v1/provider/tables/sim-1/hands/${hand}/void`, { reason: 'cleanup' });
  });
});

describe('partner bets get the same account checks as player bets', () => {
  it('an under-18 or blocked-country player is refused on the partner channel too', async () => {
    const owner = await user('pb-owner');
    const org = await ownedOrg(h, admin, { kind: 'partner', name: 'Checks Co' }, owner);
    const c = (await h.api('POST', `/v1/org/${org}/api-clients`, owner.token, { name: 'c' })).body;
    const tok = (await h.api('POST', '/v1/partner/oauth/token', undefined, { grant_type: 'client_credentials', client_id: c.id, client_secret: c.secret })).body.access_token;
    const auth = { authorization: `Bearer ${tok}` };
    const s = (await h.api('POST', '/v1/partner/players/pb-1/session', undefined, {}, auth)).body;
    const hand = await openOn(h.sim);
    let i = 0;
    const partnerBet = async () => h.api('POST', '/v1/partner/bets', undefined,
      { player_ref: 'pb-1', round_id: `sim-1:h${hand}`, selection_id: 'colour:mixed', stake_minor: 10, odds_centi: await odds('colour:mixed') },
      { ...auth, 'idempotency-key': `pb-${++i}-${Date.now()}` });

    await h.db.query(`update users set date_of_birth = (now() - interval '15 years')::date where id = $1`, [s.user_id]);
    expect((await partnerBet()).body.type).toBe('underage');

    await h.db.query(`update users set date_of_birth = '1990-01-01', country = 'US' where id = $1`, [s.user_id]);
    const territories = (await h.db.query(`select value from settings where key = 'territories'`)).rows[0].value;
    expect((await h.api('PUT', '/v1/admin/settings/territories', admin, { value: { ...territories, blocked: ['US'] } })).status).toBe(200);
    try {
      expect((await partnerBet()).body.type).toBe('territory_blocked');
    } finally {
      await h.api('PUT', '/v1/admin/settings/territories', admin, { value: territories });
    }
    expect((await partnerBet()).status).toBe(201);
  });
});
