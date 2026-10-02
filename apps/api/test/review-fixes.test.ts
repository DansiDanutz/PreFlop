import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { isPrivateAddress } from '../src/lib/safeUrl.ts';
import { seedAdmin, seedSimTable } from '../src/seed.ts';
import { SimTable, keysToFile } from '../src/sim/tableSim.ts';
import { type Harness, harness, ledgerSums } from './helpers.ts';

/** Regressions for the Greptile review of b2c9c1e (one test per finding). */
let h: Harness;
let admin: string;
beforeAll(async () => {
  delete process.env.WEBHOOK_ALLOW_PRIVATE;
  h = await harness('reviewfixes');
  await tx(h.db, (c) => seedAdmin(c, 'rf-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'rf-admin@test.dev', password: 'admin-pass-1' })).body.token;
});
afterAll(async () => h?.close());

let n = 0;
async function user(name: string) {
  const email = `${name}-${++n}-${Date.now()}@t.dev`;
  const r = await h.api('POST', '/v1/auth/register', undefined, { email, password: 'correct horse', display_name: name });
  return { token: r.body.token as string, id: r.body.user.id as string, email };
}
async function org(kind: 'organizer' | 'partner' | 'club', ownerEmail: string) {
  return (await h.api('POST', '/v1/admin/orgs', admin, { kind, name: `${kind} ${n}`, owner_email: ownerEmail })).body.id as string;
}

describe('Greptile review of b2c9c1e', () => {
  it('1. an org admin cannot rewrite ownership settings', async () => {
    const owner = await user('owner');
    const adm = await user('adm');
    const id = await org('organizer', owner.email);
    await h.api('POST', `/v1/org/${id}/members`, owner.token, { email: adm.email, role: 'admin' });
    const r = await h.api('PUT', `/v1/org/${id}`, adm.token, { settings: { owner_email: 'attacker@evil.dev' } });
    expect(r.status).toBe(403);
    expect(r.body.type).toBe('reserved_setting');
    expect((await h.api('PUT', `/v1/org/${id}`, adm.token, { settings: { city: 'Cluj' } })).status).toBe(200);
  });

  it('2. webhooks cannot target loopback, private or link-local addresses', async () => {
    const owner = await user('p');
    const id = await org('partner', owner.email);
    for (const url of ['http://127.0.0.1:9/x', 'https://127.0.0.1/x', 'https://10.1.2.3/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://localhost/x']) {
      const r = await h.api('POST', `/v1/org/${id}/webhooks`, owner.token, { url, events: ['bet.settled'] });
      expect(r.status, url).toBe(422);
      expect(r.body.type).toBe('invalid_url');
    }
    expect(['127.0.0.1', '10.0.0.1', '172.16.5.4', '192.168.1.1', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'].every(isPrivateAddress)).toBe(true);
    expect(['8.8.8.8', '1.1.1.1', '2606:4700::1111'].some(isPrivateAddress)).toBe(false);
  });

  it('3–4. raised limits apply after the cooling-off; concurrent deposits cannot exceed the daily limit', async () => {
    await h.api('PUT', '/v1/admin/settings/modes_enabled', admin, { value: { play: true, 'virtual-chips': true, diamonds: true, 'real-fiat': true, 'real-crypto': true } });
    const p = await user('dep');
    await h.api('POST', '/v1/me/kyc', p.token, {});
    await h.api('PUT', '/v1/me/limits', p.token, { deposit_day_minor: 8_000 });
    const dep = { mode: 'real-fiat', currency: 'EUR', amount_minor: 6_000, method: 'card' };
    const both = await Promise.all([h.api('POST', '/v1/me/deposits', p.token, dep), h.api('POST', '/v1/me/deposits', p.token, dep)]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 403]);
    // raise to 20,000: pending for 24 h, then applied
    expect((await h.api('PUT', '/v1/me/limits', p.token, { deposit_day_minor: 20_000 })).body.deposit_day_minor).toBe(8_000);
    await h.db.query(`update rg_limits set pending_effective_at = now() - interval '1 hour' where user_id = $1`, [p.id]);
    const l = (await h.api('GET', '/v1/me/limits', p.token)).body;
    expect(l.deposit_day_minor).toBe(20_000);
    expect(l.pending).toBeNull();
    expect((await h.api('POST', '/v1/me/deposits', p.token, dep)).status).toBe(201);
  });

  it('5. the daily loss limit compares stablecoin stakes in EUR cents', async () => {
    const keys = await tx(h.db, (c) => seedSimTable(c, { clubId: 'club-sim', tableId: 'sim-usdt', name: 'USDT table', mode: 'real-crypto', currency: 'USDT' }));
    const t = new SimTable(h.send, keysToFile(keys));
    await t.heartbeat();
    await h.work();
    const hand = (await t.openHand())!;
    const p = await user('usdt');
    await h.api('POST', '/v1/me/kyc', p.token, {});
    await h.api('POST', '/v1/me/deposits', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 50_000_000, method: 'crypto' });
    await h.api('PUT', '/v1/me/limits', p.token, { loss_day_minor: 10_000 }); // €100
    const odds = (await h.api('GET', '/v1/book')).body.markets.flatMap((m: any) => m.selections).find((s: any) => s.id === 'colour:mixed').odds_centi;
    const ok = await h.api('POST', '/v1/bets', p.token, { round_id: `sim-usdt:h${hand}`, selection_id: 'colour:mixed', stake_minor: 1_000_000, odds_centi: odds }, { 'idempotency-key': 'usdt-bet-0001' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201); // 1 USDT ≈ €1, far under €100
    const big = await h.api('POST', '/v1/bets', p.token, { round_id: `sim-usdt:h${hand}`, selection_id: 'colour:mixed', stake_minor: 150_000_000, odds_centi: odds }, { 'idempotency-key': 'usdt-bet-0002' });
    expect(big.body.type).toBe('limit_reached'); // 150 USDT > €100
  });

  it('6. a diamond organizer room below the EV floor is rejected', async () => {
    const owner = await user('d');
    const id = await org('organizer', owner.email);
    const v = (await h.api('POST', `/v1/org/${id}/rooms/validate`, owner.token, { mode: 'diamonds', house: 'organizer', rules: { margin_bps: 300, min_stake_minor: 20, rake_bps: 0, provider_share_bps: 10000 } })).body;
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/organizer EV/);
  });

  it('7. partner refs that differ only in punctuation stay distinct players', async () => {
    const owner = await user('ptn');
    const id = await org('partner', owner.email);
    const client = (await h.api('POST', `/v1/org/${id}/api-clients`, owner.token, { name: 'c' })).body;
    const tok = (await h.api('POST', '/v1/partner/oauth/token', undefined, { grant_type: 'client_credentials', client_id: client.id, client_secret: client.secret })).body.access_token;
    const a = await h.api('POST', '/v1/partner/players', undefined, { player_ref: 'user@x' }, { authorization: `Bearer ${tok}` });
    const b = await h.api('POST', '/v1/partner/players', undefined, { player_ref: 'user_x' }, { authorization: `Bearer ${tok}` });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.user_id).not.toBe(b.body.user_id);
    for (const s of await ledgerSums(h.db)) expect(s.total).toBe(0);
  });

  it('8. invite-only room details are hidden from non-members', async () => {
    const owner = await user('inv');
    const outsider = await user('out');
    const id = await org('organizer', owner.email);
    const room = (await h.api('POST', `/v1/org/${id}/rooms`, owner.token, { name: 'Secret', table_id: 'sim-1', mode: 'virtual-chips', house: 'pool', rules: { margin_bps: 0, min_stake_minor: 100, rake_bps: 1000 }, visibility: 'invite' })).body;
    expect((await h.api('GET', `/v1/rooms/${room.id}`)).status).toBe(404);
    expect((await h.api('GET', `/v1/rooms/${room.id}`, outsider.token)).status).toBe(404);
    expect((await h.api('GET', `/v1/rooms/${room.id}`, owner.token)).status).toBe(200);
    await h.api('POST', '/v1/rooms/join', outsider.token, { code: room.invite_code });
    expect((await h.api('GET', `/v1/rooms/${room.id}`, outsider.token)).status).toBe(200);
  });
});
