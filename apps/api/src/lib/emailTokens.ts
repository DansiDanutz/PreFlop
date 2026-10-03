import { createHash, randomBytes } from 'node:crypto';
import type { Config } from '../config.ts';
import { audit } from './audit.ts';
import type { Tx } from './db.ts';
import { ApiError } from './errors.ts';
import { queueMail } from './mailer.ts';

/**
 * Single-use links sent by email (verify the address, reset the password). As with owner claims
 * (lib/ownerClaims.ts) the token is random, sent once, and only its SHA-256 is stored. A link
 * only works while the account still has the address it was sent to.
 */
export type EmailPurpose = 'verify' | 'reset';
export const EMAIL_TOKEN_TTL_MS: Record<EmailPurpose, number> = { verify: 48 * 3_600_000, reset: 3_600_000 };

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Issues a fresh token, replacing every earlier unused one of the same purpose for this user. */
export async function issueEmailToken(c: Tx, userId: string, email: string, purpose: EmailPurpose): Promise<string> {
  // The account row lock serialises issuance: two requests at once can't both keep a live link.
  await c.query('select 1 from users where id = $1 for update', [userId]);
  await c.query('delete from email_tokens where user_id = $1 and purpose = $2 and used_at is null', [userId, purpose]);
  const token = randomBytes(32).toString('base64url');
  await c.query(`insert into email_tokens (token_hash, user_id, purpose, email, expires_at) values ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)`,
    [hash(token), userId, purpose, email, String(EMAIL_TOKEN_TTL_MS[purpose])]);
  await audit(c, { type: `email.${purpose}_sent`, userId });
  return token;
}

/** Marks the token used and returns its user. Unknown, used, expired or stale links → 400 invalid_token. */
export async function consumeEmailToken(c: Tx, token: string, purpose: EmailPurpose): Promise<{ userId: string; email: string }> {
  const row = (await c.query<{ user_id: string; email: string; expires_at: Date; used_at: Date | null; current: string }>(
    `select t.user_id, t.email, t.expires_at, t.used_at, u.email as current from email_tokens t join users u on u.id = t.user_id
      where t.token_hash = $1 and t.purpose = $2 for update of t`, [hash(token), purpose])).rows[0];
  const invalid = new ApiError(400, 'invalid_token', 'this link is invalid or has expired; ask for a new one');
  if (!row || row.used_at || row.expires_at.getTime() <= Date.now() || row.current !== row.email) throw invalid;
  await c.query('update email_tokens set used_at = now() where token_hash = $1', [hash(token)]);
  return { userId: row.user_id, email: row.email };
}

/** Queues the "verify your email" message for a user. */
export async function sendVerification(c: Tx, config: Config, userId: string, email: string): Promise<void> {
  const token = await issueEmailToken(c, userId, email, 'verify');
  const link = `${config.mail.webUrl}/verify-email?token=${token}`;
  await queueMail(c, {
    to: email, template: 'verify_email', subject: 'Confirm your email for PreFlop',
    text: `Confirm that this is your email address by opening this link within 48 hours:\n\n${link}\n\nIf you did not create a PreFlop account, ignore this message.`,
  });
}

/** Queues the password-reset message for a user. */
export async function sendPasswordReset(c: Tx, config: Config, userId: string, email: string): Promise<void> {
  const token = await issueEmailToken(c, userId, email, 'reset');
  const link = `${config.mail.webUrl}/reset-password?token=${token}`;
  await queueMail(c, {
    to: email, template: 'reset_password', subject: 'Reset your PreFlop password',
    text: `Someone asked to reset the password of your PreFlop account. To choose a new one, open this link within 1 hour:\n\n${link}\n\nIf it was not you, ignore this message: your password stays the same.`,
  });
}
