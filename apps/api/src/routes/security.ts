import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { bearer, hashPassword, revokeSessions, tokenHash, verifyPassword } from '../auth/players.ts';
import { passwordWeakness } from '../config.ts';
import { playSession } from '../lib/accounts.ts';
import { audit } from '../lib/audit.ts';
import { type Db, type Tx, tx } from '../lib/db.ts';
import { consumeEmailToken, sendPasswordReset, sendVerification } from '../lib/emailTokens.ts';
import { ApiError, conflict, unauthorized, unprocessable } from '../lib/errors.ts';
import { LOGIN_LOCKOUT, guardedLogin } from '../lib/loginLockout.ts';
import { perIp } from '../lib/rateLimit.ts';
import { generateSecret, otpauthUri, verifyTotp } from '../lib/totp.ts';

/**
 * Account security (docs/14 "Accounts and security"): email verification, password reset and
 * change, TOTP two-factor authentication, and the player's play session.
 */

/** Player passwords: 8–200 characters (as at registration). */
export const PlayerPassword = z.string().min(8).max(200);

/** PreFlop team accounts also need a strong password (the ADMIN_PASSWORD rules). */
export function assertPasswordAllowed(pw: string, staff: boolean): void {
  if (!staff) return;
  const why = passwordWeakness(pw);
  if (why) throw unprocessable('weak_password', `a PreFlop team password ${why}`);
}

/** settings.require_staff_mfa: PreFlop team accounts must enrol in 2FA before using the console. */
export async function staffMfaRequired(db: Db | Tx): Promise<boolean> {
  return (await db.query<{ value: unknown }>("select value from settings where key = 'require_staff_mfa'")).rows[0]?.value === true;
}

/** Routes a staff account without 2FA may still call while require_staff_mfa is on. */
export const MFA_ENROLMENT_ROUTES = new Set(['GET /v1/me', 'POST /v1/me/mfa/setup', 'POST /v1/me/mfa/enable']);

export const mfaEnrolmentAllowed = (req: FastifyRequest) => MFA_ENROLMENT_ROUTES.has(`${req.method} ${req.routeOptions.url ?? ''}`);

/**
 * Checks the one-time code of a user with 2FA enabled, inside the caller's transaction (the
 * user_mfa row is locked, so one code is accepted once even under concurrency). Returns false for
 * a wrong, stale or replayed code; true when it was accepted (last_step moves forward).
 */
export async function checkOtp(c: Tx, userId: string, code: string): Promise<boolean> {
  const m = (await c.query<{ secret: string; last_step: number | null }>(
    'select secret, last_step from user_mfa where user_id = $1 and enabled_at is not null for update', [userId])).rows[0];
  if (!m) return false;
  const step = verifyTotp(m.secret, code, m.last_step === null ? null : Number(m.last_step));
  if (step === null) return false;
  await c.query('update user_mfa set last_step = $2 where user_id = $1', [userId, step]);
  return true;
}

const Code = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'a 6-digit code') });

export async function securityRoutes(app: FastifyInstance, ctx: AppContext) {
  // ---------------------------------------------------------------- email verification
  app.post('/v1/auth/verify-email', { preHandler: perIp(ctx.limits.emailLinks) }, async (req) => {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
    return tx(ctx.db, async (c) => {
      const t = await consumeEmailToken(c, token, 'verify');
      await c.query('update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1', [t.userId]);
      await audit(c, { type: 'user.email_verified', userId: t.userId });
      return { ok: true, email_verified: true };
    });
  });

  app.post('/v1/me/resend-verification', async (req) => {
    const u = await ctx.user(req);
    ctx.limits.accountEmail.consume(`verify:${u.id}`);
    if (u.partner_id) throw conflict('email_not_applicable', 'partner accounts are verified by their operator');
    if (u.email_verified) throw conflict('already_verified', 'your email is already verified');
    await tx(ctx.db, (c) => sendVerification(c, ctx.config, u.id, u.email));
    return { ok: true };
  });

  // ---------------------------------------------------------------- password reset (signed out)
  /** Always 200 with the same body: the response never tells whether an account exists. */
  app.post('/v1/auth/forgot-password', { preHandler: perIp(ctx.limits.emailLinks) }, async (req) => {
    const { email } = z.object({ email: z.string().email().max(200).transform((s) => s.toLowerCase()) }).parse(req.body);
    ctx.limits.accountEmail.consume(`reset:${email}`);
    await tx(ctx.db, async (c) => {
      const u = (await c.query<{ id: string }>(`select id from users where email = $1 and partner_id is null and status <> 'closed'`, [email])).rows[0];
      if (u) await sendPasswordReset(c, ctx.config, u.id, email);
    });
    return { ok: true };
  });

  /** Sets a new password from a reset link and signs the account out everywhere. */
  app.post('/v1/auth/reset-password', { preHandler: perIp(ctx.limits.emailLinks) }, async (req) => {
    const b = z.object({ token: z.string().min(20).max(200), password: PlayerPassword }).parse(req.body);
    const hash = await hashPassword(b.password);
    return tx(ctx.db, async (c) => {
      const t = await consumeEmailToken(c, b.token, 'reset');
      const staff = (await c.query<{ platform_role: string | null }>('select platform_role from users where id = $1', [t.userId])).rows[0]?.platform_role != null;
      assertPasswordAllowed(b.password, staff);
      // Opening the link proves the address, so it also counts as verifying it.
      await c.query('update users set password_hash = $2, email_verified_at = coalesce(email_verified_at, now()) where id = $1', [t.userId, hash]);
      const revoked = await revokeSessions(c, t.userId);
      await c.query('delete from login_failures where email = $1', [t.email]);
      await audit(c, { type: 'user.password_reset', userId: t.userId, sessionsRevoked: revoked });
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------- password change (signed in)
  /** Needs the current password (wrong ones count toward the login lockout); signs out every other session. */
  app.post('/v1/me/password', async (req) => {
    const u = await ctx.user(req);
    const b = z.object({ current: z.string().min(1).max(200), new: PlayerPassword }).parse(req.body);
    assertPasswordAllowed(b.new, u.platform_role !== null);
    if (b.current === b.new) throw unprocessable('same_password', 'choose a password different from the current one');
    const hash = await hashPassword(b.new);
    const keep = tokenHash(bearer(req.headers.authorization) ?? '');
    await guardedLogin(ctx.db, u.email, req.ip, LOGIN_LOCKOUT, async (c) => {
      const row = (await c.query<{ password_hash: string }>('select password_hash from users where id = $1 for update', [u.id])).rows[0];
      if (!row || !(await verifyPassword(b.current, row.password_hash))) return null;
      await c.query('update users set password_hash = $2 where id = $1', [u.id, hash]);
      const revoked = await revokeSessions(c, u.id, keep);
      await audit(c, { type: 'user.password_changed', userId: u.id, sessionsRevoked: revoked });
      return true;
    }).catch((e: unknown) => {
      // Same lockout as sign-in, but a clearer message than "wrong email or password".
      if (e instanceof ApiError && e.type === 'invalid_credentials') throw unauthorized('invalid_credentials', 'the current password is wrong');
      throw e;
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- two-factor authentication (TOTP)
  /** Starts (or restarts) enrolment: a new secret, not active until confirmed with a code. */
  app.post('/v1/me/mfa/setup', async (req) => {
    const u = await ctx.user(req);
    if (u.mfa_enabled) throw conflict('mfa_already_enabled', 'two-factor authentication is already on; disable it first to start over');
    const secret = generateSecret();
    await tx(ctx.db, async (c) => {
      await c.query(`insert into user_mfa (user_id, secret) values ($1, $2)
                     on conflict (user_id) do update set secret = excluded.secret, created_at = now(), enabled_at = null, last_step = null`, [u.id, secret]);
      await audit(c, { type: 'mfa.setup_started', userId: u.id });
    });
    return { secret, otpauth_uri: otpauthUri(secret, u.email) };
  });

  app.post('/v1/me/mfa/enable', async (req) => {
    const u = await ctx.user(req);
    ctx.limits.otp.consume(`user:${u.id}`);
    const { code } = Code.parse(req.body);
    return tx(ctx.db, async (c) => {
      const m = (await c.query<{ secret: string; enabled_at: Date | null }>('select secret, enabled_at from user_mfa where user_id = $1 for update', [u.id])).rows[0];
      if (!m) throw conflict('mfa_not_set_up', 'start with POST /v1/me/mfa/setup');
      if (m.enabled_at) throw conflict('mfa_already_enabled', 'two-factor authentication is already on');
      const step = verifyTotp(m.secret, code, null);
      if (step === null) throw unprocessable('invalid_otp', 'that code is not valid; check the time on your device');
      await c.query('update user_mfa set enabled_at = now(), last_step = $2 where user_id = $1', [u.id, step]);
      await audit(c, { type: 'mfa.enabled', userId: u.id });
      return { mfa_enabled: true };
    });
  });

  app.post('/v1/me/mfa/disable', async (req) => {
    const u = await ctx.user(req);
    ctx.limits.otp.consume(`user:${u.id}`);
    const { code } = Code.parse(req.body);
    if (!u.mfa_enabled) throw conflict('mfa_not_enabled', 'two-factor authentication is off');
    return tx(ctx.db, async (c) => {
      if (!(await checkOtp(c, u.id, code))) throw unprocessable('invalid_otp', 'that code is not valid');
      await c.query('delete from user_mfa where user_id = $1', [u.id]);
      await audit(c, { type: 'mfa.disabled', userId: u.id });
      return { mfa_enabled: false };
    });
  });

  // ---------------------------------------------------------------- play session (session_minutes, reality checks)
  app.get('/v1/me/session', async (req) => {
    const u = await ctx.user(req);
    const s = await playSession(ctx.db, tokenHash(bearer(req.headers.authorization) ?? ''), u.id);
    // Net result of the bets placed in this session, per wallet. Open bets are listed apart.
    const results = (await ctx.db.query<{ mode: string; currency: string; bets: number; staked_minor: number; returned_minor: number; open_stake_minor: number }>(
      `select mode, currency, count(*)::int as bets,
              coalesce(sum(stake_minor) filter (where status in ('won','lost')), 0)::bigint as staked_minor,
              coalesce(sum(payout_minor) filter (where status = 'won'), 0)::bigint as returned_minor,
              coalesce(sum(stake_minor) filter (where status = 'accepted'), 0)::bigint as open_stake_minor
         from bets where user_id = $1 and placed_at >= $2 and status <> 'void'
        group by mode, currency order by mode, currency`, [u.id, s.started_at])).rows
      .map((r) => ({ ...r, net_minor: r.returned_minor - r.staked_minor }));
    return { ...s, results };
  });
}
