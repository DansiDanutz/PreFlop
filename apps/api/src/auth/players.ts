import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db, Tx } from '../lib/db.ts';
import { forbidden, unauthorized } from '../lib/errors.ts';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, salt, key] = stored.split('$');
  if (alg !== 'scrypt' || !n || !salt || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = await scryptAsync(pw, Buffer.from(salt, 'base64'), want.length, { ...PARAMS, N: Number(n) });
  return got.length === want.length && timingSafeEqual(got, want);
}

let nobody: Promise<string> | null = null;
/**
 * Spends one scrypt verification against a throwaway hash, so a sign-in with an unknown email
 * costs the same as one with a wrong password: response time does not tell which emails exist.
 */
export async function verifyAgainstNobody(pw: string): Promise<false> {
  nobody ??= hashPassword(randomBytes(16).toString('base64url'));
  await verifyPassword(pw, await nobody);
  return false;
}

export const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');
export const SESSION_DAYS = 30;

/** How long a proof of the password or authenticator code lets a session move money out. */
export const CONFIRMATION_WINDOW_MINUTES = 10;

/**
 * Opens a session. `confirmed` is for a session opened by the holder's own credentials (sign-in,
 * registration): it may withdraw for the confirmation window without proving them again. A session
 * someone else opens for the player (a partner's token exchange) starts unconfirmed.
 */
export async function createSession(c: Db | Tx, userId: string, opts: { confirmed?: boolean } = {}): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await c.query(`insert into sessions (token_sha256, user_id, expires_at, confirmed_at) values ($1, $2, now() + interval '${SESSION_DAYS} days', case when $3 then now() end)`,
    [tokenHash(token), userId, opts.confirmed === true]);
  return token;
}

/** Marks the session as confirmed now; returns when the confirmation lapses, or null for an unknown session. */
export async function confirmSession(c: Db | Tx, token: string): Promise<Date | null> {
  const r = await c.query<{ until: Date }>(
    `update sessions set confirmed_at = now() where token_sha256 = $1 and expires_at > now()
     returning confirmed_at + interval '${CONFIRMATION_WINDOW_MINUTES} minutes' as until`, [tokenHash(token)]);
  return r.rows[0]?.until ?? null;
}

/** Refuses unless this session proved its holder's credentials within the confirmation window. */
export async function assertRecentlyConfirmed(c: Db | Tx, token: string | undefined): Promise<void> {
  const fresh = token && (await c.query(
    `select 1 from sessions where token_sha256 = $1 and confirmed_at > now() - interval '${CONFIRMATION_WINDOW_MINUTES} minutes'`, [tokenHash(token)])).rowCount;
  if (!fresh) throw forbidden('confirmation_required', 'confirm it is you with your password or authenticator code, then try again');
}

export async function endSession(c: Db, token: string): Promise<void> {
  await c.query('delete from sessions where token_sha256 = $1', [tokenHash(token)]);
}

/** Signs the user out everywhere, or everywhere but the session whose token hash is `keep`. */
export async function revokeSessions(c: Db | Tx, userId: string, keep?: string): Promise<number> {
  const r = await c.query('delete from sessions where user_id = $1 and token_sha256 is distinct from $2', [userId, keep ?? null]);
  return r.rowCount ?? 0;
}

export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
  status: string;
  kyc_status: string;
  platform_role: string | null;
  country: string | null;
  partner_id: string | null;
  /** YYYY-MM-DD, or null when never declared (accounts created before the age gate). */
  date_of_birth: string | null;
  email_verified: boolean;
  /** TOTP two-factor authentication is enabled for sign-in. */
  mfa_enabled: boolean;
}

export function bearer(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice(7).trim() || undefined;
}

export async function userFromToken(db: Db, token: string | undefined): Promise<SessionUser> {
  if (!token) throw unauthorized('unauthorized', 'sign in required');
  const row = (await db.query<SessionUser & { partner_status: string | null }>(
    `select u.id, u.email, u.display_name, u.status, u.kyc_status, u.platform_role, u.country, u.partner_id, o.status as partner_status,
            to_char(u.date_of_birth, 'YYYY-MM-DD') as date_of_birth, u.email_verified_at is not null as email_verified,
            exists (select 1 from user_mfa m where m.user_id = u.id and m.enabled_at is not null) as mfa_enabled
       from sessions s join users u on u.id = s.user_id left join organizations o on o.id = u.partner_id
      where s.token_sha256 = $1 and s.expires_at > now()`, [tokenHash(token)])).rows[0];
  if (!row) throw unauthorized('unauthorized', 'session expired or invalid');
  // A partner's player exists only through that partner: while it is suspended, the account is too.
  const { partner_status, ...u } = row;
  if (u.partner_id && partner_status !== 'active') throw forbidden('partner_suspended', 'the operator of this account is suspended');
  // Suspension and closure sign the account out; a session that survived (issued in between) is refused too.
  if (u.status === 'suspended' || u.status === 'closed') throw forbidden('account_blocked', `account is ${u.status}`);
  return u;
}
