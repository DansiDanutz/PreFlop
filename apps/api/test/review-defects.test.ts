import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { BASE_URL, type Harness, harness, idemKey, walletOf } from './helpers.ts';

/**
 * Production-readiness review, 2026-11-10: a paid chip purchase must respect self-exclusion, age
 * and blocked countries; an email-bound owner claim needs a verified address; the connection pool
 * must survive a dropped idle connection and fail fast when it cannot connect.
 */
let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await harness('review_defects');
  await tx(h.db, (c) => seedAdmin(c, 'rd-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'rd-admin@test.dev', password: 'admin-pass-1' })).body.token;
  await h.api('PUT', '/v1/admin/settings/modes_enabled', admin, { value: { play: true, 'virtual-chips': true, 'real-fiat': true, 'real-crypto': true } });
});
afterAll(async () => h?.close());

const buy = (token: string) => h.api('POST', '/v1/me/chips/purchases', token, { chips: 500, pay_with: 'EUR' }, idemKey());

describe('paid chip purchases', () => {
  it('an active adult in an open country can buy chips', async () => {
    const p = await h.register('Buyer');
    expect((await buy(p.token)).status).toBe(201);
    expect(await walletOf(h, p.token, 'virtual-chips')).toBe(500);
  });

  it('a self-excluded player cannot pay for chips', async () => {
    const p = await h.register('Excluded');
    await h.db.query(`update users set status = 'self_excluded', self_excluded_until = now() + interval '30 days' where id = $1`, [p.id]);
    const r = await buy(p.token);
    expect([r.status, r.body.type]).toEqual([403, 'self_excluded']);
    expect(await walletOf(h, p.token, 'virtual-chips')).toBe(0);
    expect((await h.db.query('select count(*)::int as n from payments where user_id = $1', [p.id])).rows[0].n).toBe(0);
  });

  it('an account with an under-18 date of birth cannot pay for chips', async () => {
    const p = await h.register('Minor');
    await h.db.query(`update users set date_of_birth = current_date - interval '16 years' where id = $1`, [p.id]);
    const r = await buy(p.token);
    expect([r.status, r.body.type]).toEqual([403, 'underage']);
  });

  it('an account from a blocked country cannot pay for chips', async () => {
    const p = await h.register('Blocked');
    await h.db.query(`update users set country = 'KP' where id = $1`, [p.id]);
    await h.db.query(`update settings set value = jsonb_set(value, '{blocked}', '["KP"]'::jsonb) where key = 'territories'`);
    const r = await buy(p.token);
    expect([r.status, r.body.type]).toEqual([403, 'territory_blocked']);
  });
});

describe('email-bound owner claims', () => {
  it('an account whose matching email is not verified cannot redeem the link; once verified it can', async () => {
    const email = `claim-${Date.now()}@test.dev`;
    const reg = await h.api('POST', '/v1/auth/register', undefined, { email, password: 'correct horse', display_name: 'Owner', date_of_birth: '1990-01-01', country: 'MT' });
    const org = await h.api('POST', '/v1/admin/orgs', admin, { kind: 'partner', name: 'Claimed Co', owner_email: email });
    const token = org.body.owner_claim.token as string;

    const early = await h.api('POST', '/v1/me/org-claims', reg.body.token, { token });
    expect([early.status, early.body.type]).toEqual([403, 'email_unverified']);
    expect((await h.api('GET', '/v1/me', reg.body.token)).body.memberships).toEqual([]);

    await h.db.query('update users set email_verified_at = now() where id = $1', [reg.body.user.id]);
    expect((await h.api('POST', '/v1/me/org-claims', reg.body.token, { token })).body).toMatchObject({ org_id: org.body.id, kind: 'partner' });
  });
});

describe('connection pool', () => {
  it('an error on an idle connection is handled, not thrown as an uncaught exception', async () => {
    const pool = createPool(BASE_URL, 2);
    try {
      expect(pool.listenerCount('error')).toBeGreaterThan(0);
      const c = await pool.connect();
      c.release();
      expect(() => pool.emit('error', new Error('connection terminated unexpectedly'), c)).not.toThrow();
      expect((await pool.query('select 1 as ok')).rows[0].ok).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it('gives up connecting after a bounded wait instead of hanging', async () => {
    // 203.0.113.0/24 is reserved for documentation: nothing answers there.
    const pool = createPool('postgres://nobody@203.0.113.1:5432/none', 1, { connectTimeoutMs: 300 });
    const started = Date.now();
    try {
      await expect(pool.query('select 1')).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await pool.end();
    }
  });
});
