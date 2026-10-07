import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ageOn } from '../src/lib/accounts.ts';
import { COUNTRY_CODES } from '../src/lib/countries.ts';
import { tx } from '../src/lib/db.ts';
import { type MailTransport, deliverMail } from '../src/lib/mailer.ts';
import { base32Decode, base32Encode, hotp, otpauthUri, stepAt, totpAt, verifyTotp } from '../src/lib/totp.ts';
import { seedAdmin, seedSimTable } from '../src/seed.ts';
import { SimTable, keysToFile } from '../src/sim/tableSim.ts';
import { type Harness, bet, harness, realMoneyReady, idemKey } from './helpers.ts';

/** Account security and responsible gaming before real money (docs/14 "Accounts and security"). */
let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await harness('accounts');
  await tx(h.db, (c) => seedAdmin(c, 'acc-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'acc-admin@test.dev', password: 'admin-pass-1' })).body.token;
});
afterAll(async () => h?.close());

let n = 0;
const emailOf = (name: string) => `${name}-${++n}-${Date.now()}@acc.dev`;
async function register(name: string, extra: Record<string, unknown> = {}) {
  const email = emailOf(name);
  const r = await h.api('POST', '/v1/auth/register', undefined, { email, password: 'correct horse', display_name: name, date_of_birth: '1990-01-01', country: 'MT', ...extra });
  return { status: r.status, body: r.body, token: r.body?.token as string, id: r.body?.user?.id as string, email };
}
/** The token in the newest queued email to `email` (the outbox keeps the body until it is sent). */
async function linkToken(email: string, template: 'verify_email' | 'reset_password'): Promise<string> {
  const row = (await h.db.query<{ body: string }>('select body from email_outbox where to_email = $1 and template = $2 order by id desc limit 1', [email, template])).rows[0];
  const m = row?.body.match(/token=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error(`no ${template} email for ${email}`);
  return m[1]!;
}
const isoDaysAgo = (years: number, days = 0) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** The open round of the default simulated table. */
async function openRound(): Promise<string> {
  await h.sim.heartbeat();
  await h.work();
  return `sim-1:h${await h.sim.openHand()}`;
}
const setTerritories = (value: unknown) => h.api('PUT', '/v1/admin/settings/territories', admin, { value });
const modes = (real: boolean) => h.api('PUT', '/v1/admin/settings/modes_enabled', admin,
  { value: { play: true, 'virtual-chips': true, diamonds: true, 'real-fiat': real, 'real-crypto': false } });

describe('age', () => {
  it('counts whole years on the UTC calendar; 29 February comes of age on 1 March', () => {
    const at = (s: string) => new Date(`${s}T00:00:00Z`);
    expect(ageOn('2008-06-15', at('2026-06-14'))).toBe(17);
    expect(ageOn('2008-06-15', at('2026-06-15'))).toBe(18);
    expect(ageOn('2008-02-29', at('2026-02-28'))).toBe(17);
    expect(ageOn('2008-02-29', at('2026-03-01'))).toBe(18);
    // 23:30 UTC on the eve of the birthday is still the eve, whatever the server's zone.
    expect(ageOn('2008-06-15', new Date('2026-06-14T23:30:00Z'))).toBe(17);
  });

  it('registration needs a date of birth and refuses under-18s (403 underage)', async () => {
    const r = await h.api('POST', '/v1/auth/register', undefined, { email: emailOf('nodob'), password: 'correct horse', display_name: 'N', country: 'MT' });
    expect(r.status).toBe(400);
    expect((await register('teen', { date_of_birth: isoDaysAgo(18, 1) })).body.type).toBe('underage');
    expect((await register('adult', { date_of_birth: isoDaysAgo(18) })).status).toBe(201);
    for (const bad of ['1990-02-30', '31/12/1990', '1850-01-01', isoDaysAgo(-1)]) expect((await register('bad', { date_of_birth: bad })).status).toBe(400);
  });

  it('an account without a date of birth can add it once; real money needs it (dob_required) and 18+ (underage)', async () => {
    await modes(true);
    try {
      const p = await register('legacy');
      await h.db.query(`update users set date_of_birth = null, kyc_status = 'verified' where id = $1`, [p.id]);
      await realMoneyReady(h, p.id);
      const dep = { mode: 'real-fiat', currency: 'EUR', amount_minor: 1_000, method: 'card' };
      expect((await h.api('POST', '/v1/me/deposits', p.token, dep, idemKey())).body.type).toBe('dob_required');
      expect((await h.api('GET', '/v1/me', p.token)).body.date_of_birth).toBeNull();
      expect((await h.api('PATCH', '/v1/me', p.token, { date_of_birth: '1991-04-30' })).body.date_of_birth).toBe('1991-04-30');
      expect((await h.api('PATCH', '/v1/me', p.token, { date_of_birth: '1980-01-01' })).body.type).toBe('already_set');
      expect((await h.api('POST', '/v1/me/deposits', p.token, dep, idemKey())).status).toBe(201);
      // A recorded age under 18 refuses real money and every bet.
      await h.db.query('update users set date_of_birth = $2 where id = $1', [p.id, isoDaysAgo(17)]);
      expect((await h.api('POST', '/v1/me/deposits', p.token, dep, idemKey())).body.type).toBe('underage');
      const round = await openRound();
      expect((await bet(h, p.token, round, 'colour:mixed', 10)).body.type).toBe('underage');
    } finally { await modes(false); }
  });
});

describe('territories', () => {
  it('the API and the typed client list the same 250 ISO countries', () => {
    const client = readFileSync(new URL('../../../packages/client/src/countries.ts', import.meta.url), 'utf8');
    const codes = [...client.matchAll(/'([A-Z ]+)'/g)].map((m) => m[1]!).join('').trim().split(/\s+/);
    expect(codes).toEqual([...COUNTRY_CODES]);
    expect(new Set(COUNTRY_CODES).size).toBe(250);
  });

  it('the setting is validated and normalised', async () => {
    expect((await setTerritories({ blocked: ['XX'] })).body.type).toBe('invalid_value');
    expect((await setTerritories({ blocked: ['US'], real_money_allowed: ['US'] })).body.type).toBe('invalid_value');
    expect((await setTerritories({ blocked: ['US'], other: 1 })).body.type).toBe('invalid_value');
    expect((await setTerritories(['US'])).body.type).toBe('invalid_value');
    const ok = await setTerritories({ blocked: ['us', 'FR', 'US'], real_money_allowed: ['MT'] });
    expect(ok.body.value).toEqual({ blocked: ['FR', 'US'], real_money_allowed: ['MT'] });
  });

  it('country is required (ISO alpha-2); blocked countries cannot register or bet; real money only where licensed', async () => {
    await setTerritories({ blocked: ['FR'], real_money_allowed: [] });
    expect((await h.api('POST', '/v1/auth/register', undefined, { email: emailOf('noc'), password: 'correct horse', display_name: 'N', date_of_birth: '1990-01-01' })).status).toBe(400);
    expect((await register('uk', { country: 'UK' })).status).toBe(400); // not ISO 3166 (GB is)
    expect((await register('fr', { country: 'fr' })).body.type).toBe('territory_blocked');
    const de = await register('de', { country: 'de' });
    expect(de.status).toBe(201);
    expect((await h.api('GET', '/v1/me', de.token)).body.country).toBe('DE');
    // Free chips from a country that is not blocked are fine.
    const round = await openRound();
    expect((await bet(h, de.token, round, 'colour:mixed', 10)).status).toBe(201);
    // Blocking the country afterwards stops its accounts betting.
    await setTerritories({ blocked: ['FR', 'DE'], real_money_allowed: [] });
    expect((await bet(h, de.token, round, 'colour:mixed', 10)).body.type).toBe('territory_blocked');
    // Real money: only in real_money_allowed.
    await setTerritories({ blocked: [], real_money_allowed: [] });
    await modes(true);
    try {
      await h.db.query(`update users set kyc_status = 'verified', email_verified_at = now() where id = $1`, [de.id]);
      const dep = { mode: 'real-fiat', currency: 'EUR', amount_minor: 1_000, method: 'card' };
      expect((await h.api('POST', '/v1/me/deposits', de.token, dep, idemKey())).body.type).toBe('territory_not_licensed');
      await setTerritories({ blocked: [], real_money_allowed: ['DE'] });
      expect((await h.api('POST', '/v1/me/deposits', de.token, dep, idemKey())).status).toBe(201);
      // Withdrawals return the player's own money whatever the territory.
      await setTerritories({ blocked: [], real_money_allowed: [] });
      expect((await h.api('POST', '/v1/me/withdrawals', de.token, { ...dep, method: 'bank' }, idemKey())).status).toBe(201);
    } finally { await modes(false); }
  });
});

describe('email verification', () => {
  it('registration queues a link; verifying it marks the email; links are single-use', async () => {
    const p = await register('verify');
    expect((await h.api('GET', '/v1/me', p.token)).body.email_verified).toBe(false);
    const first = await linkToken(p.email, 'verify_email');
    // A resend replaces the earlier link.
    expect((await h.api('POST', '/v1/me/resend-verification', p.token)).status).toBe(200);
    const token = await linkToken(p.email, 'verify_email');
    expect(token).not.toBe(first);
    expect((await h.api('POST', '/v1/auth/verify-email', undefined, { token: first })).body.type).toBe('invalid_token');
    expect((await h.api('POST', '/v1/auth/verify-email', undefined, { token })).body).toEqual({ ok: true, email_verified: true });
    expect((await h.api('POST', '/v1/auth/verify-email', undefined, { token })).body.type).toBe('invalid_token');
    expect((await h.api('GET', '/v1/me', p.token)).body.email_verified).toBe(true);
    expect((await h.api('POST', '/v1/me/resend-verification', p.token)).body.type).toBe('already_verified');
    // Only hashes are stored.
    expect((await h.db.query('select 1 from email_tokens where token_hash = $1', [token])).rowCount).toBe(0);
  });

  it('expired links are refused', async () => {
    const p = await register('expired');
    const token = await linkToken(p.email, 'verify_email');
    await h.db.query(`update email_tokens set expires_at = now() - interval '1 second' where user_id = $1`, [p.id]);
    expect((await h.api('POST', '/v1/auth/verify-email', undefined, { token })).body.type).toBe('invalid_token');
  });

  it('a real-money bet needs a verified email', async () => {
    const keys = await tx(h.db, (c) => seedSimTable(c, { clubId: 'club-sim', tableId: 'sim-eur', name: 'EUR table', mode: 'real-fiat', currency: 'EUR' }));
    await h.db.query(`update poker_tables set real_money_approved_at = now(), real_money_approved_by = 'test' where id = 'sim-eur'`);
    const t = new SimTable(h.send, keysToFile(keys));
    await t.heartbeat();
    await modes(true);
    try {
      await h.work();
      const hand = (await t.openHand())!;
      const p = await register('rmbet');
      await h.db.query(`update users set kyc_status = 'verified' where id = $1`, [p.id]);
      expect((await bet(h, p.token, `sim-eur:h${hand}`, 'colour:mixed', 100)).body.type).toBe('email_unverified');
      await realMoneyReady(h, p.id);
      expect((await bet(h, p.token, `sim-eur:h${hand}`, 'colour:mixed', 100)).body.type).toBe('insufficient_funds'); // every account check passed
      await h.db.query(`update poker_tables set status = 'paused' where id = 'sim-eur'`);
    } finally { await modes(false); }
  });

  it('the worker hands queued mail to the transport and erases the body once sent', async () => {
    const sent: string[] = [];
    const fake: MailTransport = { name: 'fake', send: async (m) => { sent.push(m.to); } };
    expect(await deliverMail(h.db, null, 'x@y')).toBe(0);
    const before = Number((await h.db.query<{ n: string }>(`select count(*) as n from email_outbox where status = 'pending'`)).rows[0]!.n);
    expect(await deliverMail(h.db, fake, 'PreFlop <no-reply@test.dev>', 1000)).toBe(before);
    expect(sent).toHaveLength(before);
    expect((await h.db.query(`select 1 from email_outbox where status = 'pending' or body <> ''`)).rowCount).toBe(0);
  });
});

describe('passwords', () => {
  it('forgot-password answers the same for unknown and known addresses; reset signs out everywhere', async () => {
    const p = await register('forgot');
    const unknown = await h.api('POST', '/v1/auth/forgot-password', undefined, { email: `nobody-${Date.now()}@acc.dev` });
    const known = await h.api('POST', '/v1/auth/forgot-password', undefined, { email: p.email.toUpperCase() });
    expect([unknown.status, known.status]).toEqual([200, 200]);
    expect(unknown.body).toEqual(known.body);
    const token = await linkToken(p.email, 'reset_password');
    expect((await h.api('POST', '/v1/auth/reset-password', undefined, { token, password: 'short' })).status).toBe(400);
    expect((await h.api('POST', '/v1/auth/reset-password', undefined, { token, password: 'a brand new one' })).body).toEqual({ ok: true });
    expect((await h.api('GET', '/v1/me', p.token)).status).toBe(401);
    expect((await h.api('POST', '/v1/auth/reset-password', undefined, { token, password: 'another new one' })).body.type).toBe('invalid_token');
    expect((await h.api('POST', '/v1/auth/login', undefined, { email: p.email, password: 'correct horse' })).status).toBe(401);
    const s = await h.api('POST', '/v1/auth/login', undefined, { email: p.email, password: 'a brand new one' });
    expect(s.status).toBe(200);
    // The link proved the address.
    expect((await h.api('GET', '/v1/me', s.body.token)).body.email_verified).toBe(true);
  });

  it('forgot-password is rate-limited per address', async () => {
    const limited = await harness('accounts_rl', { rateLimit: { enabled: true, authPerMinute: 100, partnerTokenPerMinute: 10, betsPerMinute: 10 } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await limited.api('POST', '/v1/auth/forgot-password', undefined, { email: 'same@acc.dev' })).status);
      expect(statuses).toEqual([200, 200, 200, 429]);
    } finally { await limited.close(); }
  });

  it('change password needs the current one and signs out the other sessions', async () => {
    const p = await register('change');
    const other = (await h.api('POST', '/v1/auth/login', undefined, { email: p.email, password: 'correct horse' })).body.token;
    expect((await h.api('POST', '/v1/me/password', p.token, { current: 'wrong one!', new: 'brand new pass' })).body.type).toBe('wrong_password');
    expect((await h.db.query('select 1 from login_failures where email = $1', [p.email])).rowCount).toBe(1);
    expect((await h.api('POST', '/v1/me/password', p.token, { current: 'correct horse', new: 'brand new pass' })).body).toEqual({ ok: true });
    expect((await h.api('GET', '/v1/me', p.token)).status).toBe(200);
    expect((await h.api('GET', '/v1/me', other)).status).toBe(401);
    expect((await h.api('POST', '/v1/auth/login', undefined, { email: p.email, password: 'brand new pass' })).status).toBe(200);
  });

  it('PreFlop team accounts need a strong password', async () => {
    const s = await register('staffpw');
    await h.api('PUT', `/v1/admin/users/${s.id}`, admin, { platform_role: 'support' });
    expect((await h.api('POST', '/v1/me/password', s.token, { current: 'correct horse', new: 'longbutweak1' })).body.type).toBe('weak_password');
    expect((await h.api('POST', '/v1/me/password', s.token, { current: 'correct horse', new: 'Str0ng-Enough-9' })).status).toBe(200);
  });
});

describe('play sessions (session_minutes)', () => {
  it('reports the session; once the limit has passed bets are refused until a new sign-in', async () => {
    const p = await register('session');
    const s0 = (await h.api('GET', '/v1/me/session', p.token)).body;
    expect(s0).toMatchObject({ minutes_played: 0, limit_minutes: null, ends_at: null, limit_reached: false, reality_check_minutes: 60, results: [] });
    const round = await openRound();
    expect((await bet(h, p.token, round, 'colour:mixed', 100)).status).toBe(201);
    expect((await h.api('PUT', '/v1/me/limits', p.token, { session_minutes: 30 })).body.session_minutes).toBe(30);
    // 31 minutes into this session
    await h.db.query(`update sessions set play_started_at = now() - interval '31 minutes' where user_id = $1`, [p.id]);
    const s1 = (await h.api('GET', '/v1/me/session', p.token)).body;
    expect(s1).toMatchObject({ minutes_played: 31, limit_minutes: 30, limit_reached: true, reality_check_minutes: 30 });
    expect(s1.results).toEqual([expect.objectContaining({ mode: 'play', currency: 'PLAY', bets: 1, open_stake_minor: 100, net_minor: 0 })]);
    const refused = await bet(h, p.token, round, 'colour:mixed', 100);
    expect(refused.status).toBe(403);
    expect(refused.body.type).toBe('session_limit');
    // Sign in again: a new session, betting resumes.
    const fresh = (await h.api('POST', '/v1/auth/login', undefined, { email: p.email, password: 'correct horse' })).body.token;
    expect((await h.api('GET', '/v1/me/session', fresh)).body.limit_reached).toBe(false);
    expect((await bet(h, fresh, round, 'colour:mixed', 100)).status).toBe(201);
  });
});

describe('two-factor authentication (TOTP)', () => {
  it('matches the RFC 6238 SHA-1 test vectors and base32 round-trips', () => {
    const key = Buffer.from('12345678901234567890');
    const vectors: [number, string][] = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
    for (const [t, code] of vectors) expect(hotp(key, stepAt(t * 1000), 8)).toBe(code);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('mzxw6ytboi======').toString()).toBe('foobar');
    expect(otpauthUri('ABC', 'a@b.dev')).toBe('otpauth://totp/PreFlop:a%40b.dev?secret=ABC&issuer=PreFlop&algorithm=SHA1&digits=6&period=30');
  });

  it('accepts ±1 step, never the same step twice', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, now + 30_000), null, now)).toBe(step + 1);
    expect(verifyTotp(secret, totpAt(secret, now - 60_000), null, now)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, now), step, now)).toBeNull(); // replay
    expect(verifyTotp(secret, totpAt(secret, now), step - 1, now)).toBe(step);
    expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull();
  });

  it('enrol, sign in with a code (missing → mfa_required, wrong → counts toward the lockout), replay refused, disable', async () => {
    const p = await register('mfa');
    const setup = (await h.api('POST', '/v1/me/mfa/setup', p.token)).body;
    expect(setup.otpauth_uri).toContain(`secret=${setup.secret}`);
    expect((await h.api('POST', '/v1/me/mfa/enable', p.token, { code: '000000' })).body.type).toBe('invalid_otp');
    expect((await h.api('POST', '/v1/me/mfa/enable', p.token, { code: totpAt(setup.secret, Date.now()) })).body).toEqual({ mfa_enabled: true });
    expect((await h.api('GET', '/v1/me', p.token)).body.mfa_enabled).toBe(true);
    expect((await h.api('POST', '/v1/me/mfa/setup', p.token)).body.type).toBe('mfa_already_enabled');

    const login = (otp?: string) => h.api('POST', '/v1/auth/login', undefined, { email: p.email, password: 'correct horse', ...(otp ? { otp } : {}) });
    const failures = async () => (await h.db.query('select 1 from login_failures where email = $1', [p.email])).rowCount;
    const missing = await login();
    expect(missing.status).toBe(401);
    expect(missing.body.type).toBe('mfa_required');
    expect(missing.body.token).toBeUndefined();
    expect(await failures()).toBe(0);
    expect((await login('123456')).body.type).toBe('invalid_otp');
    expect(await failures()).toBe(1);
    // A missing code neither records nor clears failures.
    await login();
    expect(await failures()).toBe(1);
    // The code used to enable is spent; the next step's code works once.
    const next = totpAt(setup.secret, Date.now() + 30_000);
    const ok = await login(next);
    expect(ok.status).toBe(200);
    expect(await failures()).toBe(0);
    expect((await login(next)).body.type).toBe('invalid_otp');
    // A wrong password with MFA on is a plain failure.
    expect((await h.api('POST', '/v1/auth/login', undefined, { email: p.email, password: 'nope', otp: next })).body.type).toBe('invalid_credentials');

    expect((await h.api('POST', '/v1/me/mfa/disable', ok.body.token, { code: next })).body.type).toBe('invalid_otp'); // replayed
    await h.db.query('update user_mfa set last_step = last_step - 5 where user_id = $1', [p.id]); // move past the window used above
    expect((await h.api('POST', '/v1/me/mfa/disable', ok.body.token, { code: totpAt(setup.secret, Date.now()) })).body).toEqual({ mfa_enabled: false });
    expect((await login()).status).toBe(200);
  });

  it('enabling MFA revokes older sessions while retaining the enrolment session', async () => {
    const p = await register('mfa-sessions');
    const other = await h.api('POST', '/v1/auth/login', undefined, { email: p.email, password: 'correct horse' });
    expect(other.status).toBe(200);
    const setup = (await h.api('POST', '/v1/me/mfa/setup', p.token)).body;
    const invalid = await h.api('POST', '/v1/me/mfa/enable', p.token, { code: 'not-a-code' });
    expect(invalid.status).toBe(400);
    expect((await h.api('GET', '/v1/me', other.body.token)).status).toBe(200);
    expect((await h.api('POST', '/v1/me/mfa/enable', p.token, { code: totpAt(setup.secret, Date.now()) })).status).toBe(200);
    expect((await h.api('GET', '/v1/me', p.token)).status).toBe(200);
    expect((await h.api('GET', '/v1/me', other.body.token)).status).toBe(401);
  });

  it('refuses a password-only sign-in that waits while MFA is enabled', async () => {
    const p = await register('mfa-race');
    await h.api('POST', '/v1/me/mfa/setup', p.token);
    const c = await h.db.connect();
    let login: ReturnType<typeof h.api> | undefined;
    try {
      await c.query('begin');
      await c.query('select 1 from users where id = $1 for update', [p.id]);
      login = h.api('POST', '/v1/auth/login', undefined, { email: p.email, password: 'correct horse' });
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const r = await h.db.query(`select 1 from pg_stat_activity where datname = current_database()
          and wait_event_type = 'Lock' and query like 'select password_hash, status from users%'`);
        if (r.rowCount) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      // Model enrolment committing while session issuance is waiting on the same account lock.
      await c.query('update user_mfa set enabled_at = now() where user_id = $1', [p.id]);
      await c.query('commit');
      const result = await login;
      expect(result.status).toBe(401);
      expect(result.body.type).toBe('mfa_required');
      expect(result.body.token).toBeUndefined();
    } finally {
      await c.query('rollback');
      c.release();
      await login;
    }
  });

  it('require_staff_mfa: team accounts without 2FA can only enrol; players are not affected', async () => {
    const s = await register('ops');
    await h.api('PUT', `/v1/admin/users/${s.id}`, admin, { platform_role: 'ops' });
    // The admin enrols first, so turning it on does not lock them out.
    const as = (await h.api('POST', '/v1/me/mfa/setup', admin)).body;
    await h.api('POST', '/v1/me/mfa/enable', admin, { code: totpAt(as.secret, Date.now()) });
    expect((await h.api('PUT', '/v1/admin/settings/require_staff_mfa', admin, { value: 'yes' })).body.type).toBe('invalid_value');
    expect((await h.api('PUT', '/v1/admin/settings/require_staff_mfa', admin, { value: true })).status).toBe(200);
    try {
      const blocked = await h.api('GET', '/v1/admin/overview', s.token);
      expect(blocked.status).toBe(403);
      expect(blocked.body.type).toBe('mfa_enrollment_required');
      expect((await h.api('GET', '/v1/me', s.token)).body).toMatchObject({ mfa_enabled: false, mfa_enrollment_required: true });
      expect((await h.api('GET', '/v1/me/bets', s.token)).body.type).toBe('mfa_enrollment_required');
      const setup = (await h.api('POST', '/v1/me/mfa/setup', s.token)).body;
      expect((await h.api('POST', '/v1/me/mfa/enable', s.token, { code: totpAt(setup.secret, Date.now()) })).status).toBe(200);
      expect((await h.api('GET', '/v1/admin/overview', s.token)).status).toBe(200);
      expect((await h.api('GET', '/v1/me', s.token)).body.mfa_enrollment_required).toBe(false);
      const player = await register('plain');
      expect((await h.api('GET', '/v1/me/bets', player.token)).status).toBe(200);
      expect((await h.api('GET', '/v1/admin/overview', admin)).status).toBe(200);
    } finally {
      await h.api('PUT', '/v1/admin/settings/require_staff_mfa', admin, { value: false });
    }
  });
});

describe('partner players', () => {
  it('the partner may send a date of birth; under-18s are refused, partner flows otherwise unchanged', async () => {
    const owner = await register('ptnr');
    const r = await h.api('POST', '/v1/admin/orgs', admin, { kind: 'partner', name: 'DOB Partner', owner_email: owner.email });
    await h.api('POST', '/v1/me/org-claims', owner.token, { token: r.body.owner_claim.token });
    const client = (await h.api('POST', `/v1/org/${r.body.id}/api-clients`, owner.token, { name: 'c' })).body;
    const tok = (await h.api('POST', '/v1/partner/oauth/token', undefined, { grant_type: 'client_credentials', client_id: client.id, client_secret: client.secret })).body.access_token;
    const auth = { authorization: `Bearer ${tok}` };
    expect((await h.api('POST', '/v1/partner/players', undefined, { player_ref: 'kid', date_of_birth: isoDaysAgo(16) }, auth)).body.type).toBe('underage');
    expect((await h.api('POST', '/v1/partner/players', undefined, { player_ref: 'p1' }, auth)).status).toBe(201);
    const s = await h.api('POST', '/v1/partner/players/p1/session', undefined, { date_of_birth: '1985-05-05' }, auth);
    expect(s.status).toBe(200);
    expect((await h.api('GET', '/v1/me', s.body.token)).body).toMatchObject({ date_of_birth: '1985-05-05', country: null });
    expect((await h.api('POST', '/v1/partner/players/p2/session', undefined, {}, auth)).status).toBe(200);
  });
});
