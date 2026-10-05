import { createHash, generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { tableReadiness } from '../src/rounds/readiness.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness, ledgerSums, ownedOrg, idemKey } from './helpers.ts';

/** Regressions for the authorization and accounting review of ca1fc5f (one test per finding). */
let h: Harness;
let admin: string;
let adminId: string;
beforeAll(async () => {
  h = await harness('secreview');
  await tx(h.db, (c) => seedAdmin(c, 'sr-admin@test.dev', 'admin-pass-1'));
  const r = (await h.api('POST', '/v1/auth/login', undefined, { email: 'sr-admin@test.dev', password: 'admin-pass-1' })).body;
  admin = r.token;
  adminId = (await h.api('GET', '/v1/me', admin)).body.id;
});
afterAll(async () => h?.close());

let n = 0;
async function user(name: string) {
  const email = `${name}-${++n}-${Date.now()}@sr.dev`;
  const r = await h.api('POST', '/v1/auth/register', undefined, { email, password: 'correct horse', date_of_birth: '1990-01-01', country: 'MT', display_name: name });
  return { token: r.body.token as string, id: r.body.user.id as string, email };
}
async function staff(name: string, role: 'ops' | 'support' | 'risk') {
  const u = await user(name);
  expect((await h.api('PUT', `/v1/admin/users/${u.id}`, admin, { platform_role: role })).status).toBe(200);
  return u;
}
const modes = (real: boolean) => h.api('PUT', '/v1/admin/settings/modes_enabled', admin,
  { value: { play: true, 'virtual-chips': true, diamonds: true, 'real-fiat': real, 'real-crypto': false } });

describe('authorization review', () => {
  it('an org admin cannot demote an owner, and the last owner always stays', async () => {
    const owner = await user('owner');
    const orgAdmin = await user('orgadmin');
    const id = await ownedOrg(h, admin, { kind: 'organizer', name: 'Owners Club' }, owner);
    expect((await h.api('POST', `/v1/org/${id}/members`, owner.token, { email: orgAdmin.email, role: 'admin' })).status).toBe(200);
    expect((await h.api('POST', `/v1/org/${id}/members`, orgAdmin.token, { email: owner.email, role: 'viewer' })).body.type).toBe('read_only');
    expect((await h.api('POST', `/v1/org/${id}/members`, owner.token, { email: owner.email, role: 'viewer' })).body.type).toBe('last_owner');
    const members = (await h.api('GET', `/v1/org/${id}/members`, owner.token)).body.members;
    expect(members.find((m: any) => m.email === owner.email).role).toBe('owner');
  });

  it('support and risk manage players, never team accounts or themselves', async () => {
    const support = await staff('support', 'support');
    const player = await user('player');
    expect((await h.api('PUT', `/v1/admin/users/${adminId}`, support.token, { status: 'suspended' })).body.type).toBe('forbidden_target');
    expect((await h.api('PUT', `/v1/admin/users/${support.id}`, support.token, { kyc_status: 'verified' })).body.type).toBe('forbidden_target');
    // Support suspends and closes; KYC decisions and re-activations open real-money play, so admin or risk make them.
    expect((await h.api('PUT', `/v1/admin/users/${player.id}`, support.token, { kyc_status: 'pending' })).body.type).toBe('forbidden_role');
    expect((await h.api('PUT', `/v1/admin/users/${player.id}`, support.token, { status: 'suspended' })).status).toBe(200);
    expect((await h.api('PUT', `/v1/admin/users/${player.id}`, support.token, { status: 'active' })).body.type).toBe('forbidden_role');
    const risk = await staff('risk', 'risk');
    expect((await h.api('PUT', `/v1/admin/users/${player.id}`, risk.token, { status: 'active', kyc_status: 'pending' })).status).toBe(200);
    expect((await h.api('GET', '/v1/me', admin)).status).toBe(200);
  });

  it('staff cannot approve their own agent account, statements or promotions', async () => {
    const ops = await staff('ops', 'ops');
    await h.api('POST', '/v1/me/agent/apply', ops.token, {});
    expect((await h.api('PUT', `/v1/admin/agents/${ops.id}`, ops.token, { status: 'active', rate_l1_bps: 4000 })).body.type).toBe('self_approval');
    // A promotion an ops member wrote is reviewed by someone else.
    const owner = await user('promo-owner');
    const org = await ownedOrg(h, admin, { kind: 'club', name: 'Promo Club' }, owner);
    expect((await h.api('POST', `/v1/org/${org}/members`, owner.token, { email: ops.email, role: 'viewer' })).status).toBe(200);
    const w = { starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: new Date(Date.now() + 3_600_000).toISOString() };
    const promo = (await h.api('POST', `/v1/org/${org}/promotions`, owner.token, { kind: 'announcement', title: 'Club night', ...w })).body;
    expect((await h.api('POST', `/v1/admin/promotions/${promo.id}/decision`, ops.token, { decision: 'approve' })).body.type).toBe('self_approval');
    expect((await h.api('POST', `/v1/admin/promotions/${promo.id}/decision`, admin, { decision: 'approve' })).status).toBe(200);
  });

  it('partner deposits come out of a funded treasury, never from nothing', async () => {
    const owner = await user('ptn');
    const id = await ownedOrg(h, admin, { kind: 'partner', name: 'Float Co' }, owner);
    const client = (await h.api('POST', `/v1/org/${id}/api-clients`, owner.token, { name: 'c' })).body;
    const tok = (await h.api('POST', '/v1/partner/oauth/token', undefined, { grant_type: 'client_credentials', client_id: client.id, client_secret: client.secret })).body.access_token;
    const auth = { authorization: `Bearer ${tok}` };
    expect((await h.api('POST', '/v1/partner/players/p1/deposits', undefined, { amount_minor: 1_000_000 }, { ...auth, 'idempotency-key': 'dep-key-0001' })).body.type).toBe('insufficient_treasury');
    expect((await h.api('POST', `/v1/org/${id}/chips/purchases`, owner.token, { chips: 500, pay_with: 'EUR' }, idemKey())).status).toBe(201);
    expect((await h.api('POST', '/v1/partner/players/p1/deposits', undefined, { amount_minor: 500 }, { ...auth, 'idempotency-key': 'dep-key-0002' })).status).toBe(201);
    expect((await h.api('POST', '/v1/partner/players/p1/deposits', undefined, { amount_minor: 1 }, { ...auth, 'idempotency-key': 'dep-key-0003' })).body.type).toBe('insufficient_treasury');
    for (const s of await ledgerSums(h.db)) expect(Number(s.total)).toBe(0);
  });

  it('reissuing owner links concurrently leaves exactly one live link', async () => {
    const owner = await user('links');
    const id = await ownedOrg(h, admin, { kind: 'club', name: 'Link Club' }, owner);
    await Promise.all([1, 2, 3].map(() => h.api('POST', `/v1/admin/orgs/${id}/owner-claim`, admin, {})));
    const live = (await h.db.query('select count(*)::int as n from org_owner_claims where org_id = $1 and claimed_at is null and revoked_at is null', [id])).rows[0].n;
    expect(live).toBe(1);
  });

  it('partner placeholder addresses cannot be registered', async () => {
    const r = await h.api('POST', '/v1/auth/register', undefined, { email: 'p_abc@ptn1.partner.preflop', password: 'correct horse', date_of_birth: '1990-01-01', country: 'MT', display_name: 'X' });
    expect(r.status).toBe(400);
  });

  it('the sandbox KYC and payment rails refuse to run in production', async () => {
    const prod = await harness('secreview_prod', { nodeEnv: 'production' });
    try {
      const r = await prod.api('POST', '/v1/auth/register', undefined, { email: 'p@prod.dev', password: 'correct horse', date_of_birth: '1990-01-01', country: 'MT', display_name: 'P' });
      expect((await prod.api('POST', '/v1/me/kyc', r.body.token, {})).body.type).toBe('provider_not_configured');
      expect((await prod.api('POST', '/v1/me/deposits', r.body.token, { mode: 'real-fiat', currency: 'EUR', amount_minor: 1000, method: 'card' }, idemKey())).body.type).toBe('provider_not_configured');
      expect((await prod.api('POST', '/v1/me/chips/purchases', r.body.token, { chips: 100, pay_with: 'EUR' }, idemKey())).body.type).toBe('provider_not_configured');
    } finally { await prod.close(); }
  });
});

describe('accounting review', () => {
  it('agent months close in order', async () => {
    expect((await h.api('POST', '/v1/admin/agents/statements/close?month=2024-03', admin)).status).toBe(200);
    expect((await h.api('POST', '/v1/admin/agents/statements/close?month=2024-05', admin)).body.type).toBe('month_out_of_order');
    expect((await h.api('POST', '/v1/admin/agents/statements/close?month=2024-04', admin)).status).toBe(200);
    expect((await h.api('POST', '/v1/admin/agents/statements/close?month=2024-02', admin)).body.type).toBe('month_out_of_order');
    // Re-closing a closed month is still a no-op, not an error.
    expect((await h.api('POST', '/v1/admin/agents/statements/close?month=2024-03', admin)).body.created).toBe(0);
  });

  it('only PreFlop boards draw a player contribution from its bankroll', async () => {
    await modes(true);
    try {
      const owner = await user('contrib');
      const org = await ownedOrg(h, admin, { kind: 'club', name: 'Contrib Club' }, owner);
      const w = { starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: new Date(Date.now() + 3_600_000).toISOString() };
      const r = await h.api('POST', `/v1/org/${org}/leaderboards`, owner.token, { name: 'Real club week', mode: 'real-fiat', currency: 'EUR', metric: 'net', prize_split_bps: [10_000], scope: 'org', scope_ref: org, contribution_bps: 100, ...w });
      expect(r.body.type).toBe('contribution_preflop_only');
    } finally { await modes(false); }
  });

  it('the database session runs in UTC', async () => {
    expect((await h.db.query('show timezone')).rows[0].TimeZone).toBe('UTC');
  });
});

/** Second review pass (docs/13 §10): conflicts of interest, ownership links, scoping and input bounds. */
describe('security review pass', () => {
  it('a team member who belongs to a club does not void, review or approve that club\'s tables; a colleague does', async () => {
    const ops = await staff('club-ops', 'ops');
    await h.db.query(`insert into memberships (user_id, org_id, role) values ($1, 'club-sim', 'viewer') on conflict do nothing`, [ops.id]);
    await h.sim.heartbeat();
    await h.work();
    const n = await h.sim.openHand();
    const round = `sim-1:h${n}`;
    expect((await h.api('POST', `/v1/admin/rounds/${round}/void`, ops.token, { reason: 'conflict test' })).body.type).toBe('conflict_of_interest');
    expect((await h.api('PUT', '/v1/admin/tables/sim-1/real-money', ops.token, { approved: false })).body.type).toBe('conflict_of_interest');
    expect((await h.api('POST', `/v1/admin/rounds/${round}/review`, ops.token, { action: 'void', reason: 'conflict test' })).body.type).toBe('conflict_of_interest');
    expect((await h.api('POST', `/v1/admin/rounds/${round}/void`, admin, { reason: 'no conflict' })).body).toMatchObject({ state: 'VOID' });
    await h.db.query(`delete from memberships where user_id = $1 and org_id = 'club-sim'`, [ops.id]);
  });

  it('alerts are resolved by admin, ops or risk, not support', async () => {
    const support = await staff('alert-support', 'support');
    const id = (await h.db.query(`insert into alerts (kind, severity, details) values ('review_pass', 'info', '{}') returning id`)).rows[0].id;
    expect((await h.api('POST', `/v1/admin/alerts/${id}/resolve`, support.token)).body.type).toBe('forbidden_role');
    expect((await h.api('POST', `/v1/admin/alerts/${id}/resolve`, admin)).status).toBe(200);
  });

  it('only an admin re-issues an owner link once an organization has an owner, and a link issued for an email works for that account only', async () => {
    const owner = await user('claim-owner');
    const org = await ownedOrg(h, admin, { kind: 'partner', name: 'Claim Partner' }, owner);
    const ops = await staff('claim-ops', 'ops');
    expect((await h.api('POST', `/v1/admin/orgs/${org}/owner-claim`, ops.token, {})).body.type).toBe('forbidden_role');
    const other = await user('claim-other');
    const bound = await h.api('POST', `/v1/admin/orgs/${org}/owner-claim`, admin, { email: other.email });
    expect(bound.status).toBe(201);
    const stranger = await user('claim-stranger');
    expect((await h.api('POST', '/v1/me/org-claims', stranger.token, { token: bound.body.owner_claim.token })).body.type).toBe('claim_email_mismatch');
    expect((await h.api('POST', '/v1/me/org-claims', other.token, { token: bound.body.owner_claim.token })).body).toMatchObject({ org_id: org, kind: 'partner' });
    // An org that has no owner yet is ops business, as before.
    const fresh = (await h.api('POST', '/v1/admin/orgs', admin, { kind: 'organizer', name: 'Fresh Org', owner_email: 'fresh@sr.dev' })).body;
    expect((await h.api('POST', `/v1/admin/orgs/${fresh.id}/owner-claim`, ops.token, {})).status).toBe(201);
  });

  it('an admin cannot place an agent under their own agent account', async () => {
    const a = await user('agent-child');
    await h.api('POST', '/v1/me/agent/apply', a.token, {});
    expect((await h.api('PUT', `/v1/admin/agents/${a.id}`, admin, { status: 'active', parent_agent_id: adminId })).body.type).toBe('self_approval');
  });

  it('a club opens rooms on its own tables only; a partner sees its own bets per round, not the platform totals', async () => {
    const owner = await user('room-club-owner');
    const club = await ownedOrg(h, admin, { kind: 'club', name: 'Room Club' }, owner);
    const r = await h.api('POST', `/v1/org/${club}/rooms`, owner.token, { name: 'Not ours', table_id: 'sim-1', mode: 'virtual-chips', house: 'pool', rules: { margin_bps: 0, min_stake_minor: 100, rake_bps: 1000 }, visibility: 'public' });
    expect(r.body.type).toBe('foreign_table');
    const partnerOwner = await user('scoped-partner');
    const partner = await ownedOrg(h, admin, { kind: 'partner', name: 'Scoped Partner' }, partnerOwner);
    const rounds = await h.api('GET', `/v1/org/${partner}/rounds`, partnerOwner.token);
    expect(rounds.status).toBe(200);
    expect(rounds.body.rounds).toEqual([]);
    expect((await h.api('GET', `/v1/org/${partner}/players`, partnerOwner.token)).status).toBe(200);
  });

  it('a suspended club\'s devices and staff are refused, and its tables are not ready', async () => {
    expect((await h.api('PUT', '/v1/admin/orgs/club-sim/status', admin, { status: 'suspended' })).status).toBe(200);
    try {
      const hb = await h.sim.heartbeat();
      expect(hb.status).toBe(403);
      expect(hb.body.type).toBe('club_suspended');
      const t = (await h.db.query(`select * from poker_tables where id = 'sim-1'`)).rows[0];
      expect((await tableReadiness(h.db, t)).problems.join(' ')).toMatch(/club is suspended/);
    } finally {
      expect((await h.api('PUT', '/v1/admin/orgs/club-sim/status', admin, { status: 'active' })).status).toBe(200);
    }
    expect((await h.sim.heartbeat()).status).toBe(200);
  });

  it('a partner gets no session for a blocked player; a blocked account\'s own session is refused', async () => {
    const owner = await user('blocked-partner');
    const org = await ownedOrg(h, admin, { kind: 'partner', name: 'Blocked Partner' }, owner);
    const client = (await h.api('POST', `/v1/org/${org}/api-clients`, owner.token, { name: 'c' })).body;
    const tok = (await h.api('POST', '/v1/partner/oauth/token', undefined, { grant_type: 'client_credentials', client_id: client.id, client_secret: client.secret })).body.access_token;
    const auth = { authorization: `Bearer ${tok}` };
    const s1 = await h.api('POST', '/v1/partner/players/blocked-1/session', undefined, {}, auth);
    expect(s1.status).toBe(200);
    expect((await h.api('PUT', `/v1/admin/users/${s1.body.user_id}`, admin, { status: 'suspended' })).status).toBe(200);
    expect((await h.api('POST', '/v1/partner/players/blocked-1/session', undefined, {}, auth)).body.type).toBe('account_blocked');
    // A session that survived a suspension (issued in between) is refused on use.
    const p = await user('blocked-direct');
    await h.api('PUT', `/v1/admin/users/${p.id}`, admin, { status: 'suspended' });
    await h.db.query(`insert into sessions (token_sha256, user_id, expires_at) values (encode(sha256('sr-survivor'::bytea), 'hex'), $1, now() + interval '1 day')`, [p.id]);
    expect((await h.api('GET', '/v1/me', 'sr-survivor')).body.type).toBe('account_blocked');
  });

  it('a staff key is enrolled once per club and gets a random credential id', async () => {
    const owner = await user('enrol-owner');
    const club = await ownedOrg(h, admin, { kind: 'club', name: 'Enrol Club' }, owner);
    const t = (await h.api('POST', `/v1/org/${club}/tables`, owner.token, { name: 'T1', kind: 'simulated', mode: 'play', currency: 'PLAY' })).body;
    const pem = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const a = await h.api('POST', `/v1/org/${club}/staff`, owner.token, { table_id: t.id, person_id: 'ana', role: 'dealer', public_key_pem: pem });
    expect(a.status).toBe(201);
    expect(a.body.id).not.toBe(`cred_${createHash('sha256').update(pem).digest('hex').slice(0, 12)}`);
    expect((await h.api('POST', `/v1/org/${club}/staff`, owner.token, { table_id: t.id, person_id: 'bob', role: 'floor', public_key_pem: pem })).body.type).toBe('credential_exists');
  });

  it('public and member input is bounded: application size and nesting, organization settings, partner bet fields', async () => {
    const deep = JSON.parse(`${'{"a":'.repeat(8)}1${'}'.repeat(8)}`);
    expect((await h.api('POST', '/v1/applications', undefined, { kind: 'club', name: 'Deep', email: 'deep@sr.dev', details: deep })).status).toBe(400);
    expect((await h.api('POST', '/v1/applications', undefined, { kind: 'club', name: 'Big', email: 'big@sr.dev', details: { note: 'x'.repeat(40_000) } })).status).toBe(413);
    expect((await h.api('POST', '/v1/applications', undefined, { kind: 'club', name: 'Fine', email: 'fine@sr.dev', details: { city: 'Cluj', tables: 4 } })).status).toBe(201);
    const owner = await user('settings-owner');
    const org = await ownedOrg(h, admin, { kind: 'organizer', name: 'Settings Org' }, owner);
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i]));
    expect((await h.api('PUT', `/v1/org/${org}`, owner.token, { settings: many })).status).toBe(400);
    expect((await h.api('PUT', `/v1/org/${org}`, owner.token, { settings: { city: 'x'.repeat(501) } })).status).toBe(400);
    expect((await h.api('PUT', `/v1/org/${org}`, owner.token, { settings: { city: 'Cluj' } })).status).toBe(200);
    expect((await h.api('POST', '/v1/auth/login', undefined, { email: owner.email, password: 'x'.repeat(201) })).status).toBe(400);
  });
});
