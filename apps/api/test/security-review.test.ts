import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness, ledgerSums, ownedOrg } from './helpers.ts';

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
  const r = await h.api('POST', '/v1/auth/register', undefined, { email, password: 'correct horse', display_name: name });
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
    expect((await h.api('PUT', `/v1/admin/users/${player.id}`, support.token, { kyc_status: 'pending' })).status).toBe(200);
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
    expect((await h.api('POST', '/v1/partner/players/p1/deposits', undefined, { amount_minor: 1_000_000 }, auth)).body.type).toBe('insufficient_treasury');
    expect((await h.api('POST', `/v1/org/${id}/chips/purchases`, owner.token, { chips: 500, pay_with: 'EUR' })).status).toBe(201);
    expect((await h.api('POST', '/v1/partner/players/p1/deposits', undefined, { amount_minor: 500 }, auth)).status).toBe(201);
    expect((await h.api('POST', '/v1/partner/players/p1/deposits', undefined, { amount_minor: 1 }, auth)).body.type).toBe('insufficient_treasury');
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
    const r = await h.api('POST', '/v1/auth/register', undefined, { email: 'p_abc@ptn1.partner.preflop', password: 'correct horse', display_name: 'X' });
    expect(r.status).toBe(400);
  });

  it('the sandbox KYC and payment rails refuse to run in production', async () => {
    const prod = await harness('secreview_prod', { nodeEnv: 'production' });
    try {
      const r = await prod.api('POST', '/v1/auth/register', undefined, { email: 'p@prod.dev', password: 'correct horse', display_name: 'P' });
      expect((await prod.api('POST', '/v1/me/kyc', r.body.token, {})).body.type).toBe('provider_not_configured');
      expect((await prod.api('POST', '/v1/me/deposits', r.body.token, { mode: 'real-fiat', currency: 'EUR', amount_minor: 1000, method: 'card' })).body.type).toBe('provider_not_configured');
      expect((await prod.api('POST', '/v1/me/chips/purchases', r.body.token, { chips: 100, pay_with: 'EUR' })).body.type).toBe('provider_not_configured');
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
