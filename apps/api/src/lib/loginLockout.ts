import { type Db, type Tx, tx } from './db.ts';
import { type ApiError, tooManyRequests, unauthorized } from './errors.ts';

export interface LockoutPolicy {
  /** Failed logins for one email within the window that lock it. */
  maxFailures: number;
  windowMs: number;
}

export const LOGIN_LOCKOUT: LockoutPolicy = { maxFailures: 5, windowMs: 15 * 60_000 };

/**
 * Returned by verify() to refuse with a specific error. `countsAsFailure` records it like a wrong
 * password (e.g. a wrong one-time code); otherwise nothing is recorded and nothing is cleared
 * (e.g. "a one-time code is required"), so it can never reset the failure count.
 */
export class LoginRefusal {
  constructor(readonly error: ApiError, readonly countsAsFailure: boolean) {}
}

/**
 * Runs a password check under the per-email login lockout, stored in Postgres so it holds across
 * every API instance. Attempts for one email are serialised by a transaction-scoped advisory lock
 * (no row locks, so the global lock order is untouched), which makes "check, verify, record"
 * atomic: concurrent guesses can never slip past the limit.
 *
 * - locked (maxFailures failures within the window) → 429 login_locked + Retry-After, and the
 *   password is not even checked;
 * - verify() returns null → the failure is recorded, then 401 invalid_credentials;
 * - success → the email's failures are cleared.
 */
export async function guardedLogin<T>(db: Db, email: string, ip: string, policy: LockoutPolicy, verify: (c: Tx) => Promise<T | LoginRefusal | null>): Promise<T> {
  const out = await tx(db, async (c) => {
    await c.query('select pg_advisory_xact_lock(7462, hashtext($1))', [email]);
    const window = String(policy.windowMs);
    await c.query(`delete from login_failures where email = $1 and at <= clock_timestamp() - ($2 || ' milliseconds')::interval`, [email, window]);
    // The maxFailures-th most recent failure inside the window: the lock lifts when it ages out.
    const nth = (await c.query<{ retry_ms: number }>(
      `select greatest(0, extract(epoch from (at + ($2 || ' milliseconds')::interval - clock_timestamp())) * 1000)::bigint as retry_ms
         from login_failures where email = $1 and at > clock_timestamp() - ($2 || ' milliseconds')::interval
        order by at desc offset $3 limit 1`, [email, window, policy.maxFailures - 1])).rows[0];
    if (nth) return { locked: Number(nth.retry_ms) } as const;
    const ok = await verify(c);
    if (ok instanceof LoginRefusal) {
      if (ok.countsAsFailure) await c.query('insert into login_failures (email, ip) values ($1, $2)', [email, ip]);
      return { refused: ok.error } as const;
    }
    if (ok === null) {
      await c.query('insert into login_failures (email, ip) values ($1, $2)', [email, ip]);
      return { failed: true } as const;
    }
    await c.query('delete from login_failures where email = $1', [email]);
    return { ok } as const;
  });
  if ('locked' in out) throw tooManyRequests('login_locked', 'too many failed logins for this account; retry later', out.locked);
  if ('failed' in out) throw unauthorized('invalid_credentials', 'wrong email or password');
  if ('refused' in out) throw out.refused;
  return out.ok;
}
