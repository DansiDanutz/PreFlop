import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { totpAt } from '../src/lib/totp.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness, idemKey, realMoneyReady, walletOf } from './helpers.ts';

/**
 * Production-readiness review, 2026-11-10: a withdrawal needs a recently confirmed session. Signing
 * in confirms the session for a short window; after that the player proves the password again, or
 * the authenticator code when 2FA is on (POST /v1/me/confirm). A session token alone, stolen or
 * left on a shared device, cannot move money out.
 */
let h: Harness;
const PASSWORD = 'correct horse';
const out = { mode: 'real-fiat', currency: 'EUR', amount_minor: 1_000, method: 'bank' };

beforeAll(async () => {
  h = await harness('withdrawal_stepup');
  await tx(h.db, (c) => seedAdmin(c, 'ws-admin@test.dev', 'admin-pass-1'));
  const admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'ws-admin@test.dev', password: 'admin-pass-1' })).body.token;
  await h.api('PUT', '/v1/admin/settings/modes_enabled', admin, { value: { play: true, 'real-fiat': true, 'real-crypto': true } });
});
afterAll(async () => h?.close());

async function fundedPlayer(name: string) {
  const p = await h.register(name);
  await realMoneyReady(h, p.id);
  expect((await h.api('POST', '/v1/me/kyc', p.token, {})).body.kyc_status).toBe('verified');
  expect((await h.api('POST', '/v1/me/deposits', p.token, { mode: 'real-fiat', currency: 'EUR', amount_minor: 5_000, method: 'card' }, idemKey())).status).toBe(201);
  return p;
}
const withdraw = (token: string, key = idemKey()) => h.api('POST', '/v1/me/withdrawals', token, out, key);
const expireConfirmation = (userId: string) => h.db.query(`update sessions set confirmed_at = now() - interval '11 minutes' where user_id = $1`, [userId]);
const confirm = (token: string, body: Record<string, unknown>) => h.api('POST', '/v1/me/confirm', token, body);

describe('withdrawal step-up', () => {
  it('a session that just signed in can withdraw', async () => {
    const p = await fundedPlayer('Fresh');
    expect((await withdraw(p.token)).status).toBe(201);
    expect(await walletOf(h, p.token, 'real-fiat')).toBe(4_000);
  });

  it('a session confirmed too long ago, or never, is refused and nothing leaves the wallet', async () => {
    const p = await fundedPlayer('Stale');
    await expireConfirmation(p.id);
    const stale = await withdraw(p.token);
    expect(stale.status).toBe(403);
    expect(stale.body.type).toBe('confirmation_required');
    await h.db.query('update sessions set confirmed_at = null where user_id = $1', [p.id]);
    expect((await withdraw(p.token)).body.type).toBe('confirmation_required');
    expect(await walletOf(h, p.token, 'real-fiat')).toBe(5_000);
  });

  it('the password confirms the session again; a wrong one does not', async () => {
    const p = await fundedPlayer('Reconfirm');
    await expireConfirmation(p.id);
    const wrong = await confirm(p.token, { password: 'not my password' });
    expect(wrong.status).toBe(403);
    expect(wrong.body.type).toBe('wrong_password');
    expect((await withdraw(p.token)).body.type).toBe('confirmation_required');
    const ok = await confirm(p.token, { password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.confirmed).toBe(true);
    expect(Date.parse(ok.body.confirmed_until)).toBeGreaterThan(Date.now());
    expect((await withdraw(p.token)).status).toBe(201);
  });

  it('confirming one session leaves the account\'s other sessions unconfirmed', async () => {
    const p = await fundedPlayer('TwoDevices');
    const email = (await h.api('GET', '/v1/me', p.token)).body.email;
    const other = (await h.api('POST', '/v1/auth/login', undefined, { email, password: PASSWORD })).body.token;
    await expireConfirmation(p.id);
    expect((await confirm(p.token, { password: PASSWORD })).status).toBe(200);
    expect((await withdraw(other)).body.type).toBe('confirmation_required');
    expect((await withdraw(p.token)).status).toBe(201);
  });

  it('with 2FA on, the password alone is not enough: the authenticator code confirms', async () => {
    const p = await fundedPlayer('TwoFactor');
    const setup = (await h.api('POST', '/v1/me/mfa/setup', p.token)).body;
    expect((await h.api('POST', '/v1/me/mfa/enable', p.token, { password: PASSWORD, code: totpAt(setup.secret, Date.now()) })).body).toEqual({ mfa_enabled: true });
    await expireConfirmation(p.id);
    const passwordOnly = await confirm(p.token, { password: PASSWORD });
    expect(passwordOnly.status).toBe(403);
    expect(passwordOnly.body.type).toBe('mfa_required');
    expect((await confirm(p.token, { code: '000000' })).body.type).toBe('invalid_otp');
    expect((await withdraw(p.token)).body.type).toBe('confirmation_required');
    // The enabling code is spent; the next step's code is still inside the accepted window.
    expect((await confirm(p.token, { code: totpAt(setup.secret, Date.now() + 30_000) })).status).toBe(200);
    expect((await withdraw(p.token)).status).toBe(201);
  });

  it('a retry of a withdrawal that already went through replays its answer after the confirmation lapsed', async () => {
    const p = await fundedPlayer('Retry');
    const key = idemKey();
    const first = await withdraw(p.token, key);
    expect(first.status).toBe(201);
    await expireConfirmation(p.id);
    const again = await withdraw(p.token, key);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(await walletOf(h, p.token, 'real-fiat')).toBe(4_000);
  });

  it('a confirmation needs a password or a code', async () => {
    const p = await h.register('Empty');
    expect((await confirm(p.token, {})).status).toBe(400);
  });
});
