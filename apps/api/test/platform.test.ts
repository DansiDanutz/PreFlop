import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { signWebhook, startWebhookFanout, deliverDue } from '../src/routes/partner.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness, ledgerSums } from './helpers.ts';

let h: Harness;
let admin: string;
let stopFanout: () => void;
beforeAll(async () => {
  h = await harness('platform');
  await tx(h.db, (c) => seedAdmin(c, 'admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'admin@test.dev', password: 'admin-pass-1' })).body.token;
  stopFanout = startWebhookFanout(h.db);
});
afterAll(async () => {
  stopFanout?.();
  await h?.close();
});

async function open(): Promise<number> {
  await h.sim.heartbeat();
  await h.work();
  const n = await h.sim.openHand();
  if (n === null) throw new Error('no open round');
  return n;
}
async function userWithEmail(name: string) {
  const email = `${name}-${Date.now()}@test.dev`;
  const r = await h.api('POST', '/v1/auth/register', undefined, { email, password: 'correct horse', display_name: name });
  return { token: r.body.token as string, id: r.body.user.id as string, email };
}
async function createOrg(kind: 'club' | 'partner' | 'organizer', ownerEmail: string, name = `${kind} org`) {
  const r = await h.api('POST', '/v1/admin/orgs', admin, { kind, name, owner_email: ownerEmail, settings: { city: 'Bucharest' } });
  expect(r.status).toBe(201);
  return r.body.id as string;
}
const wallet = async (token: string, mode: string, orgId?: string) =>
  ((await h.api('GET', '/v1/me/wallets', token)).body.wallets.find((w: any) => w.mode === mode && (orgId ? w.org_id === orgId : !w.org_id))?.balance_minor ?? 0) as number;

describe('organizer house in diamonds (docs/08, docs/10)', () => {
  let owner: Awaited<ReturnType<typeof userWithEmail>>;
  let player: Awaited<ReturnType<typeof userWithEmail>>;
  let orgId: string;
  let roomId: string;

  it('an organizer buys diamonds, funds collateral, creates a room and gives diamonds to a player', async () => {
    owner = await userWithEmail('owner');
    player = await userWithEmail('player');
    orgId = await createOrg('organizer', owner.email, 'Diamond Nights');
    const me = (await h.api('GET', '/v1/me', owner.token)).body;
    expect(me.memberships.map((m: any) => m.org_id)).toContain(orgId);

    const packs = (await h.api('GET', `/v1/org/${orgId}/diamonds/packs`, owner.token)).body.packs;
    expect(packs[0]).toMatchObject({ diamonds: 1000, price_minor: 1000 });
    const buy = await h.api('POST', `/v1/org/${orgId}/diamonds/purchases`, owner.token, { diamonds: 10_000, pay_with: 'USDT' });
    expect(buy.status).toBe(201);
    expect(buy.body.currency).toBe('USDT');
    expect((await h.api('POST', `/v1/org/${orgId}/collateral/deposits`, owner.token, { mode: 'diamonds', currency: 'DIAMOND', amount_minor: 6_000 })).status).toBe(200);

    const bad = await h.api('POST', `/v1/org/${orgId}/rooms/validate`, owner.token, { mode: 'diamonds', house: 'organizer', rules: { margin_bps: 100, min_stake_minor: 5, rake_bps: 5000 } });
    expect(bad.body.ok).toBe(false);
    expect(bad.body.problems.length).toBeGreaterThanOrEqual(3);
    const room = await h.api('POST', `/v1/org/${orgId}/rooms`, owner.token, { name: 'High Rollers', table_id: 'sim-1', mode: 'diamonds', house: 'organizer', rules: { margin_bps: 600, min_stake_minor: 20, rake_bps: 500 }, visibility: 'invite' });
    expect(room.status).toBe(201);
    roomId = room.body.id;
    expect(room.body.invite_code).toMatch(/^[A-Z0-9]{7}$/);

    const t = await h.api('POST', `/v1/org/${orgId}/transfers`, owner.token, { email: player.email, mode: 'diamonds', amount_minor: 1_000 });
    expect(t.status).toBe(201);
    expect(await wallet(player.token, 'diamonds', orgId)).toBe(1_000);
  });

  it('a diamond bet splits exactly into PreFlop fee + rake + at-risk, and settles from the collateral', async () => {
    const n = await open();
    const rid = `sim-1:h${n}`;
    const roomInfo = (await h.api('GET', `/v1/rooms/${roomId}`)).body;
    const odds = roomInfo.odds['hand-class:pair'];
    // invite-only: must join first
    const denied = await h.api('POST', '/v1/bets', player.token, { round_id: rid, selection_id: 'hand-class:pair', stake_minor: 100, odds_centi: odds, room_id: roomId }, { 'idempotency-key': 'room-bet-0001' });
    expect(denied.body.type).toBe('not_a_member');
    const code = (await h.api('GET', `/v1/org/${orgId}/rooms`, owner.token)).body.rooms[0].invite_code;
    expect((await h.api('POST', '/v1/rooms/join', player.token, { code })).status).toBe(200);
    const ok = await h.api('POST', '/v1/bets', player.token, { round_id: rid, selection_id: 'hand-class:pair', stake_minor: 100, odds_centi: odds, room_id: roomId }, { 'idempotency-key': 'room-bet-0002' });
    expect(ok.status).toBe(201);
    const bet = (await h.db.query('select stake_minor, fee_minor, at_risk_minor from bets where id = $1', [ok.body.bet_id])).rows[0];
    expect(bet).toEqual({ stake_minor: 100, fee_minor: 1, at_risk_minor: 94 }); // 1 ◆ fee + 5 ◆ rake (5%) + 94 at risk
    expect(await wallet(player.token, 'diamonds', orgId)).toBe(900);

    const out = await h.sim.playHand(n);
    await h.work();
    const settled = (await h.db.query('select status, payout_minor from bets where id = $1', [ok.body.bet_id])).rows[0];
    const isPair = new Set(out.cards.map((c) => c[0])).size === 2;
    expect(settled.status).toBe(isPair ? 'won' : 'lost');
    expect(await wallet(player.token, 'diamonds', orgId)).toBe(900 + (isPair ? Math.floor((94 * odds) / 100) : 0));
    const dil = (await h.api('GET', `/v1/org/${orgId}/dilution`, owner.token)).body;
    expect(dil).toMatchObject({ bought: 10_000, sunk_preflop_fee: 1, rake: 5 });
  });

  it('the collateral must cover the worst-case outgo of every open round', async () => {
    const n = await open();
    const rid = `sim-1:h${n}`;
    const odds = (await h.api('GET', `/v1/rooms/${roomId}`)).body.odds['hand-class:straight-flush'];
    // 6,000 collateral (+/- the last result) cannot pay a ~390x straight flush on 900 at risk
    const r = await h.api('POST', '/v1/bets', player.token, { round_id: rid, selection_id: 'hand-class:straight-flush', stake_minor: 900, odds_centi: odds, room_id: roomId }, { 'idempotency-key': 'room-bet-0003' });
    expect(r.status).toBe(422);
    expect(r.body.type).toBe('house_limit');
  });

  it('a voided round reverses every placement posting (stake, fee, rake)', async () => {
    const n = await open();
    const rid = `sim-1:h${n}`;
    const before = await wallet(player.token, 'diamonds', orgId);
    const odds = (await h.api('GET', `/v1/rooms/${roomId}`)).body.odds['colour:mixed'];
    expect((await h.api('POST', '/v1/bets', player.token, { round_id: rid, selection_id: 'colour:mixed', stake_minor: 40, odds_centi: odds, room_id: roomId }, { 'idempotency-key': 'room-bet-0004' })).status).toBe(201);
    expect(await wallet(player.token, 'diamonds', orgId)).toBe(before - 40);
    await h.sim.call('floor_manager', 'POST', `/v1/provider/tables/sim-1/hands/${n}/void`, { reason: 'test' });
    expect(await wallet(player.token, 'diamonds', orgId)).toBe(before);
    for (const s of await ledgerSums(h.db)) expect(s.total).toBe(0);
  });
});

describe('pool room in virtual chips', () => {
  it('players play against each other; the winner takes the pool after rake and fees', async () => {
    const owner = await userWithEmail('pool-owner');
    const a = await userWithEmail('alice');
    const b = await userWithEmail('bob');
    const orgId = await createOrg('organizer', owner.email, 'Pool Party');
    expect((await h.api('POST', `/v1/org/${orgId}/chips/purchases`, owner.token, { chips: 5_000, pay_with: 'EUR' })).status).toBe(201);
    for (const p of [a, b]) await h.api('POST', `/v1/org/${orgId}/transfers`, owner.token, { email: p.email, mode: 'virtual-chips', amount_minor: 1_000 });
    const room = (await h.api('POST', `/v1/org/${orgId}/rooms`, owner.token, { name: 'Friday pool', table_id: 'sim-1', mode: 'virtual-chips', house: 'pool', rules: { margin_bps: 0, min_stake_minor: 100, rake_bps: 1000 }, visibility: 'public' })).body;
    const n = await open();
    const rid = `sim-1:h${n}`;
    const ba = await h.api('POST', '/v1/bets', a.token, { round_id: rid, selection_id: 'colour:mixed', stake_minor: 500, odds_centi: 100, room_id: room.id }, { 'idempotency-key': 'pool-a-0001' });
    const bb = await h.api('POST', '/v1/bets', b.token, { round_id: rid, selection_id: 'colour:all-red', stake_minor: 500, odds_centi: 100, room_id: room.id }, { 'idempotency-key': 'pool-b-0001' });
    expect([ba.status, bb.status], JSON.stringify([ba.body, bb.body])).toEqual([201, 201]);
    const out = await h.sim.playHand(n);
    await h.work();
    const settled = (await h.db.query('select state, void_reason from rounds where id = $1', [rid])).rows[0];
    expect(settled.state, JSON.stringify(settled)).toBe('SETTLED');
    const red = out.cards.every((c) => c.endsWith('h') || c.endsWith('d'));
    const black = out.cards.every((c) => c.endsWith('s') || c.endsWith('c'));
    // each stake 500: rake 50, PreFlop fee 7 (1.5%) → 443 in the pool each, 886 total
    const wa = await wallet(a.token, 'virtual-chips', orgId), wb = await wallet(b.token, 'virtual-chips', orgId);
    if (black) expect([wa, wb]).toEqual([1000, 1000]); // nobody backed the winner: full refund, including rake and fee
    else if (red) expect([wa, wb]).toEqual([500, 500 + 886]);
    else expect([wa, wb]).toEqual([500 + 886, 500]);
    for (const s of await ledgerSums(h.db)) expect(s.total).toBe(0);
  });
});

describe('club portal', () => {
  it('a club owner certifies tables and enrolls a staff key; outsiders are refused', async () => {
    const owner = await userWithEmail('club-owner');
    const outsider = await userWithEmail('outsider');
    const clubId = await createOrg('club', owner.email, 'Atlas Test Club');
    const t = await h.api('POST', `/v1/org/${clubId}/tables`, owner.token, { name: 'Table 1', kind: 'physical', mode: 'play', currency: 'PLAY' });
    expect(t.status).toBe(201);
    const cert = await h.api('PUT', `/v1/org/${clubId}/tables/${t.body.id}/certification`, owner.token, { items: { shufflerPaired: true, camerasApproved: true } });
    expect(cert.body.certification.shufflerPaired).toMatchObject({ ok: true, by: owner.id });
    const pem = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const enr = await h.api('POST', `/v1/org/${clubId}/staff`, owner.token, { table_id: t.body.id, person_id: 'dealer-ana', role: 'dealer', public_key_pem: pem });
    expect(enr.status).toBe(201);
    expect(enr.body.id).toMatch(/^cred_/);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect((await h.api('POST', `/v1/org/${clubId}/staff`, owner.token, { table_id: t.body.id, person_id: 'x', role: 'floor', public_key_pem: rsa })).body.type).toBe('invalid_key');
    expect((await h.api('GET', `/v1/org/${clubId}/tables`, outsider.token)).status).toBe(403);
    const tables = (await h.api('GET', `/v1/org/${clubId}/tables`, owner.token)).body.tables;
    expect(tables[0].problems.join(' ')).toMatch(/physical-table play is disabled/);
  });
});

describe('partner API and webhooks (docs/02 §2)', () => {
  it('client credentials → player session → partner bet → signed webhook on settlement', async () => {
    const received: { body: string; sig: string }[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => { received.push({ body, sig: String(req.headers['x-preflop-signature']) }); res.writeHead(200).end('ok'); });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    const owner = await userWithEmail('partner-owner');
    const orgId = await createOrg('partner', owner.email, 'BetCo');
    const client = (await h.api('POST', `/v1/org/${orgId}/api-clients`, owner.token, { name: 'prod' })).body;
    expect(client.secret).toMatch(/^pfs_/);
    const hook = (await h.api('POST', `/v1/org/${orgId}/webhooks`, owner.token, { url: `http://127.0.0.1:${port}/hook`, events: ['bet.settled'] })).body;

    const tok = await h.api('POST', '/v1/partner/oauth/token', undefined, { grant_type: 'client_credentials', client_id: client.id, client_secret: client.secret });
    expect(tok.status).toBe(200);
    const auth = { authorization: `Bearer ${tok.body.access_token}` };
    expect((await h.api('POST', '/v1/partner/oauth/token', undefined, { grant_type: 'client_credentials', client_id: client.id, client_secret: 'wrong' })).status).toBe(401);
    expect((await h.api('POST', '/v1/partner/players', undefined, { player_ref: 'p-42' }, auth)).status).toBe(201);
    const session = (await h.api('POST', '/v1/partner/players/p-42/session', undefined, {}, auth)).body.token;
    expect((await h.api('GET', '/v1/me', session)).body.partner_id).toBe(orgId);

    const n = await open();
    const odds = (await h.api('GET', '/v1/book?channel=partner')).body.markets.flatMap((m: any) => m.selections).find((s: any) => s.id === 'colour:mixed').odds_centi;
    const b = await h.api('POST', '/v1/partner/bets', undefined, { player_ref: 'p-42', round_id: `sim-1:h${n}`, selection_id: 'colour:mixed', stake_minor: 100, odds_centi: odds }, { ...auth, 'idempotency-key': 'partner-bet-0001' });
    expect(b.status).toBe(201);
    await h.sim.playHand(n);
    await h.work();
    await new Promise((r) => setTimeout(r, 200)); // fan-out runs after commit
    await deliverDue(h.db);
    expect(received.length).toBe(1);
    const payload = JSON.parse(received[0]!.body);
    expect(payload.type).toBe('bet.settled');
    expect(payload.data.betId).toBe(b.body.bet_id);
    const t = Number(/t=(\d+)/.exec(received[0]!.sig)![1]);
    const secret = (await h.db.query('select secret from webhooks where id = $1', [hook.id])).rows[0].secret;
    expect(received[0]!.sig).toBe(signWebhook(secret, received[0]!.body, t));
    const stmts = (await h.api('GET', `/v1/org/${orgId}/statements`, owner.token)).body.statements;
    expect(stmts[0].lines.some((l: any) => /Revenue share/.test(l.label))).toBe(true);
    server.close();
  });
});

describe('applications, real-money sandbox and responsible gaming', () => {
  it('an approved application becomes an organization owned by the applicant once they register', async () => {
    const email = `applicant-${Date.now()}@test.dev`;
    const app = await h.api('POST', '/v1/applications', undefined, { kind: 'organizer', name: 'Home Game League', email });
    expect(app.status).toBe(201);
    const d = await h.api('POST', `/v1/admin/applications/${app.body.id}/decision`, admin, { decision: 'approved' });
    expect(d.body.org_id).toBeTruthy();
    const r = await h.api('POST', '/v1/auth/register', undefined, { email, password: 'correct horse', display_name: 'Applicant' });
    const me = (await h.api('GET', '/v1/me', r.body.token)).body;
    expect(me.memberships[0]).toMatchObject({ org_id: d.body.org_id, kind: 'organizer', role: 'owner' });
  });

  it('real money requires the mode, KYC and limits; withdrawals return funds; self-exclusion blocks play', async () => {
    const p = await userWithEmail('real');
    const dep = { mode: 'real-fiat', currency: 'EUR', amount_minor: 5_000, method: 'card' };
    expect((await h.api('POST', '/v1/me/deposits', p.token, dep)).body.type).toBe('mode_disabled');
    await h.api('PUT', '/v1/admin/settings/modes_enabled', admin, { value: { play: true, 'virtual-chips': true, diamonds: true, 'real-fiat': true, 'real-crypto': true } });
    expect((await h.api('POST', '/v1/me/deposits', p.token, dep)).body.type).toBe('kyc_required');
    expect((await h.api('POST', '/v1/me/kyc', p.token, {})).body.kyc_status).toBe('verified');
    expect((await h.api('PUT', '/v1/me/limits', p.token, { deposit_day_minor: 8_000 })).body.deposit_day_minor).toBe(8_000);
    expect((await h.api('POST', '/v1/me/deposits', p.token, dep)).status).toBe(201);
    expect((await h.api('POST', '/v1/me/deposits', p.token, dep)).body.type).toBe('limit_reached');
    // raising a limit waits 24 h
    const raised = (await h.api('PUT', '/v1/me/limits', p.token, { deposit_day_minor: 50_000 })).body;
    expect(raised.deposit_day_minor).toBe(8_000);
    expect(raised.pending.deposit_day_minor).toBe(50_000);
    // 3,000 cents of headroom left: 20 USDT (2,000 cents) fits, then another 20 does not
    const usdt = await h.api('POST', '/v1/me/deposits', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 20_000_000, method: 'crypto' });
    expect((await h.api('POST', '/v1/me/deposits', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 20_000_000, method: 'crypto' })).body.type).toBe('limit_reached');
    expect(usdt.body.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(await wallet(p.token, 'real-fiat')).toBe(5_000);
    expect((await h.api('POST', '/v1/me/withdrawals', p.token, { ...dep, amount_minor: 2_000, method: 'bank' })).status).toBe(201);
    expect(await wallet(p.token, 'real-fiat')).toBe(3_000);
    expect((await h.api('POST', '/v1/me/withdrawals', p.token, { ...dep, amount_minor: 9_000, method: 'bank' })).body.type).toBe('insufficient_funds');
    expect((await h.api('POST', '/v1/me/self-exclusion', p.token, { days: 30 })).status).toBe(200);
    expect((await h.api('GET', '/v1/me', p.token)).status).toBe(401); // sessions ended
    for (const s of await ledgerSums(h.db)) expect(s.total).toBe(0);
  });

  it('the PreFlop team sees evidence, risk, ledger, statements and an intact audit chain', async () => {
    const q = await h.api('GET', '/v1/admin/rounds?limit=5', admin);
    expect(q.body.rounds.length).toBeGreaterThan(0);
    const settled = q.body.rounds.find((r: any) => r.state === 'SETTLED');
    const ev = (await h.api('GET', `/v1/admin/rounds/${encodeURIComponent(settled.id)}/evidence`, admin)).body;
    expect(ev.image_data_url).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(ev.entries.length).toBe(2);
    expect(ev.events.map((e: any) => e.step)).toEqual(['lock', 'shuffle_command', 'shuffle_complete', 'cut_instruction', 'cut', 'deal_start']);
    expect((await h.api('GET', '/v1/admin/risk', admin)).body.monitor.length).toBeGreaterThan(0);
    expect((await h.api('GET', '/v1/admin/audit?limit=3', admin)).body.chain.ok).toBe(true);
    expect((await h.api('GET', '/v1/admin/statements', admin)).body.statements.some((s: any) => s.party === 'PreFlop')).toBe(true);
    const outsider = await userWithEmail('nosy');
    expect((await h.api('GET', '/v1/admin/overview', outsider.token)).status).toBe(403);
  });
});
