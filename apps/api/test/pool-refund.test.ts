import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness, ledgerSums } from './helpers.ts';

let h: Harness;
beforeAll(async () => { h = await harness('poolrefund'); });
afterAll(async () => h?.close());

describe('pool with no winning backer (deterministic)', () => {
  it('refunds every stake in full — rake and PreFlop fee included', async () => {
    await tx(h.db, (c) => seedAdmin(c, 'pr-admin@test.dev', 'admin-pass-1'));
    const admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'pr-admin@test.dev', password: 'admin-pass-1' })).body.token;
    const mk = async (n: string) => { const e = `${n}-${Date.now()}@t.dev`; const r = await h.api('POST', '/v1/auth/register', undefined, { email: e, password: 'correct horse', display_name: n }); return { token: r.body.token as string, email: e }; };
    const owner = await mk('o'), a = await mk('a'), b = await mk('b');
    const orgId = (await h.api('POST', '/v1/admin/orgs', admin, { kind: 'organizer', name: 'Refund Club', owner_email: owner.email })).body.id;
    await h.api('POST', `/v1/org/${orgId}/chips/purchases`, owner.token, { chips: 5000, pay_with: 'EUR' });
    for (const p of [a, b]) await h.api('POST', `/v1/org/${orgId}/transfers`, owner.token, { email: p.email, mode: 'virtual-chips', amount_minor: 1000 });
    const room = (await h.api('POST', `/v1/org/${orgId}/rooms`, owner.token, { name: 'R', table_id: 'sim-1', mode: 'virtual-chips', house: 'pool', rules: { margin_bps: 0, min_stake_minor: 100, rake_bps: 1000 }, visibility: 'public' })).body;
    await h.sim.heartbeat(); await h.work();
    const n = (await h.sim.openHand())!;
    const rid = `sim-1:h${n}`;
    // Both back "three of a kind" (p = 0.24%): nobody backs the winner unless trips is dealt.
    await h.api('POST', '/v1/bets', a.token, { round_id: rid, selection_id: 'hand-class:trips', stake_minor: 500, odds_centi: 100, room_id: room.id }, { 'idempotency-key': 'pr-a-000001' });
    await h.api('POST', '/v1/bets', b.token, { round_id: rid, selection_id: 'hand-class:trips', stake_minor: 500, odds_centi: 100, room_id: room.id }, { 'idempotency-key': 'pr-b-000001' });
    const out = await h.sim.playHand(n);
    await h.work();
    const trips = new Set(out.cards.map((c) => c[0])).size === 1;
    const w = async (t: string) => (await h.api('GET', '/v1/me/wallets', t)).body.wallets.find((x: any) => x.org_id === orgId)?.balance_minor;
    if (!trips) expect([await w(a.token), await w(b.token)]).toEqual([1000, 1000]);
    for (const s of await ledgerSums(h.db)) expect(s.total).toBe(0);
  });
});
