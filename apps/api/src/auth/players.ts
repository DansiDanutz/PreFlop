import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db, Tx } from '../lib/db.ts';
import { unauthorized } from '../lib/errors.ts';

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

const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');
export const SESSION_DAYS = 30;

export async function createSession(c: Db | Tx, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await c.query(`insert into sessions (token_sha256, user_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`, [tokenHash(token), userId]);
  return token;
}

export async function endSession(c: Db, token: string): Promise<void> {
  await c.query('delete from sessions where token_sha256 = $1', [tokenHash(token)]);
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
}

export function bearer(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice(7).trim() || undefined;
}

export async function userFromToken(db: Db, token: string | undefined): Promise<SessionUser> {
  if (!token) throw unauthorized('unauthorized', 'sign in required');
  const u = (await db.query<SessionUser>(
    `select u.id, u.email, u.display_name, u.status, u.kyc_status, u.platform_role, u.country, u.partner_id
       from sessions s join users u on u.id = s.user_id
      where s.token_sha256 = $1 and s.expires_at > now()`, [tokenHash(token)])).rows[0];
  if (!u) throw unauthorized('unauthorized', 'session expired or invalid');
  return u;
}
