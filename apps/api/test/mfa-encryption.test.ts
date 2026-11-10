import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { SEALED_PREFIX, secretBox } from '../src/lib/secretBox.ts';
import { totpAt } from '../src/lib/totp.ts';
import { type Harness, harness } from './helpers.ts';

/**
 * Production-readiness review, 2026-11-10: authenticator (TOTP) secrets are encrypted at rest when
 * MFA_ENCRYPTION_KEY is set, so a copy of the database alone does not yield working second factors.
 */
const KEY = randomBytes(32).toString('base64');
const PASSWORD = 'correct horse';

describe('secretBox', () => {
  const box = secretBox(KEY);

  it('seals to something that hides the value and opens back to it', () => {
    const sealed = box.seal('JBSWY3DPEHPK3PXP', 'u_1');
    expect(sealed.startsWith(SEALED_PREFIX)).toBe(true);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed, 'u_1')).toBe('JBSWY3DPEHPK3PXP');
    expect(box.seal('JBSWY3DPEHPK3PXP', 'u_1')).not.toBe(sealed); // a fresh nonce every time
  });

  it('refuses a value sealed for another owner, a tampered one, and another key', () => {
    const sealed = box.seal('JBSWY3DPEHPK3PXP', 'u_1');
    expect(() => box.open(sealed, 'u_2')).toThrow();
    const flipped = sealed.slice(0, -2) + (sealed.at(-2) === 'A' ? 'B' : 'A') + sealed.slice(-1);
    expect(() => box.open(flipped, 'u_1')).toThrow();
    expect(() => secretBox(randomBytes(32).toString('base64')).open(sealed, 'u_1')).toThrow();
  });

  it('reads values stored before encryption was turned on', () => {
    expect(box.open('JBSWY3DPEHPK3PXP', 'u_1')).toBe('JBSWY3DPEHPK3PXP');
    expect(box.isSealed('JBSWY3DPEHPK3PXP')).toBe(false);
  });

  it('without a key stores values as they are, and says so when asked to open a sealed one', () => {
    const none = secretBox(null);
    expect(none.encrypts).toBe(false);
    expect(none.seal('JBSWY3DPEHPK3PXP', 'u_1')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => none.open(box.seal('JBSWY3DPEHPK3PXP', 'u_1'), 'u_1')).toThrow(/MFA_ENCRYPTION_KEY/);
  });

  it('the configuration refuses a key that is not 32 random bytes in base64', () => {
    expect(loadConfig({ MFA_ENCRYPTION_KEY: KEY }).mfaEncryptionKey).toBe(KEY);
    expect(loadConfig({}).mfaEncryptionKey).toBeNull();
    expect(() => loadConfig({ MFA_ENCRYPTION_KEY: 'too-short' })).toThrow(/MFA_ENCRYPTION_KEY/);
  });
});

describe('authenticator secrets at rest', () => {
  let h: Harness;
  beforeAll(async () => { h = await harness('mfa_encryption', { mfaEncryptionKey: KEY }); });
  afterAll(async () => h?.close());

  const stored = async (userId: string) => (await h.db.query<{ secret: string }>('select secret from user_mfa where user_id = $1', [userId])).rows[0]!.secret;
  const emailOf = async (token: string) => (await h.api('GET', '/v1/me', token)).body.email as string;

  it('a new secret is stored encrypted, and enrolment and sign-in still work with it', async () => {
    const p = await h.register('Sealed');
    const setup = (await h.api('POST', '/v1/me/mfa/setup', p.token)).body;
    const atRest = await stored(p.id);
    expect(atRest.startsWith(SEALED_PREFIX)).toBe(true);
    expect(atRest).not.toContain(setup.secret);
    expect((await h.api('POST', '/v1/me/mfa/enable', p.token, { password: PASSWORD, code: totpAt(setup.secret, Date.now()) })).body).toEqual({ mfa_enabled: true });
    const login = await h.api('POST', '/v1/auth/login', undefined, { email: await emailOf(p.token), password: PASSWORD, otp: totpAt(setup.secret, Date.now() + 30_000) });
    expect(login.status).toBe(200);
  });

  it('a secret stored before encryption still works and is encrypted the next time it is used', async () => {
    const p = await h.register('Legacy');
    const setup = (await h.api('POST', '/v1/me/mfa/setup', p.token)).body;
    await h.db.query('update user_mfa set secret = $2 where user_id = $1', [p.id, setup.secret]);
    expect((await h.api('POST', '/v1/me/mfa/enable', p.token, { password: PASSWORD, code: totpAt(setup.secret, Date.now()) })).body).toEqual({ mfa_enabled: true });
    expect(await stored(p.id)).toBe(setup.secret);
    const login = await h.api('POST', '/v1/auth/login', undefined, { email: await emailOf(p.token), password: PASSWORD, otp: totpAt(setup.secret, Date.now() + 30_000) });
    expect(login.status).toBe(200);
    expect((await stored(p.id)).startsWith(SEALED_PREFIX)).toBe(true);
  });
});
