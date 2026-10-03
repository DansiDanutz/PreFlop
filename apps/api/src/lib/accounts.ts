import { z } from 'zod';
import { isCountryCode } from './countries.ts';
import type { Db, Tx } from './db.ts';
import { ApiError } from './errors.ts';
import { applyDueLimits } from './rg.ts';

/**
 * Account rules that hold before any real money moves: age, verified email and territory
 * (docs/14 "Accounts and security"). Country is SELF-DECLARED at registration until a KYC or
 * geolocation provider confirms it; see countryHint() for where such a signal would plug in.
 */

export const MIN_AGE = 18;

/** An ISO date (YYYY-MM-DD) that exists on the calendar, from 1900 until today. */
export const DateOfBirth = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').refine((s) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && t.getTime() <= Date.now();
}, 'not a valid date of birth');

/** An ISO 3166-1 alpha-2 code, upper-cased (e.g. "mt" → "MT"). */
export const Country = z.string().length(2).transform((s) => s.toUpperCase()).refine(isCountryCode, 'not an ISO 3166-1 alpha-2 country code');

/**
 * Whole years between a date of birth and `now`, on the UTC calendar. Someone born on 29 February
 * comes of age on 1 March in a non-leap year.
 */
export function ageOn(dob: string, now = new Date()): number {
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  const cy = now.getUTCFullYear(), cm = now.getUTCMonth() + 1, cd = now.getUTCDate();
  return cy - y - (cm < m || (cm === m && cd < d) ? 1 : 0);
}

export const isAdult = (dob: string, now = new Date()) => ageOn(dob, now) >= MIN_AGE;

// ---------------------------------------------------------------- territories

/**
 * settings.territories. `blocked`: no account may be opened from these countries and their
 * accounts cannot bet at all. `real_money_allowed`: the only countries where real-money bets,
 * buy-ins and deposits are accepted (the licensed ones). Free chips work everywhere not blocked.
 */
export const Territories = z.object({
  blocked: z.array(Country).max(250).default([]),
  real_money_allowed: z.array(Country).max(250).default([]),
}).strict().superRefine((t, ctx) => {
  const both = t.blocked.filter((c) => t.real_money_allowed.includes(c));
  if (both.length) ctx.addIssue({ code: 'custom', message: `${both.join(', ')} cannot be both blocked and allowed for real money` });
});
export type Territories = z.infer<typeof Territories>;

export async function loadTerritories(c: Db | Tx): Promise<Territories> {
  const v = (await c.query<{ value: unknown }>("select value from settings where key = 'territories'")).rows[0]?.value;
  const p = Territories.safeParse(v ?? {});
  // A malformed value (written before validation existed) fails closed: no real money anywhere.
  return p.success ? p.data : { blocked: [], real_money_allowed: [] };
}

/**
 * Hook for a verified location signal. Today it always returns null: the country is what the
 * player declared. When a geolocation or KYC provider is integrated (or a trusted edge header
 * such as cf-ipcountry behind TRUST_PROXY), return its answer here and compare it with the
 * declared country. Never trust such a header without a trusted proxy in front.
 */
export function countryHint(_headers: Record<string, string | string[] | undefined>): string | null {
  return null;
}

// ---------------------------------------------------------------- real-money gate

interface AccountFacts { partner_id: string | null; country: string | null; dob: string | null; email_verified: boolean }

async function facts(c: Db | Tx, userId: string): Promise<AccountFacts> {
  return (await c.query<AccountFacts>(
    `select partner_id, country, to_char(date_of_birth, 'YYYY-MM-DD') as dob, email_verified_at is not null as email_verified from users where id = $1`, [userId])).rows[0]
    ?? { partner_id: null, country: null, dob: null, email_verified: false };
}

/**
 * Refuses real money (bets, buy-ins, deposits) unless the account has a date of birth showing
 * 18+, a verified email, and a country in territories.real_money_allowed. Called next to the KYC
 * check. Partner players are identified, age-checked and located by their licensed operator:
 * only what PreFlop knows about them is enforced (an under-18 date of birth, a blocked country).
 */
export async function assertRealMoneyAccount(c: Db | Tx, userId: string): Promise<void> {
  const u = await facts(c, userId);
  const partner = u.partner_id !== null;
  if (u.dob === null) {
    if (!partner) throw new ApiError(403, 'dob_required', 'add your date of birth before playing for real money');
  } else if (!isAdult(u.dob)) throw new ApiError(403, 'underage', `real money is for players aged ${MIN_AGE} or over`);
  if (!partner && !u.email_verified) throw new ApiError(403, 'email_unverified', 'verify your email address before playing for real money');
  const t = await loadTerritories(c);
  if (u.country && t.blocked.includes(u.country)) throw new ApiError(403, 'territory_blocked', 'PreFlop is not available in your country');
  if (!partner && (!u.country || !t.real_money_allowed.includes(u.country))) throw new ApiError(403, 'territory_not_licensed', 'real money is not available in your country');
}

/**
 * Checks for every bet, whatever the mode: an account from a blocked country, or with a declared
 * age under 18, cannot bet (free chips included).
 */
export async function assertMayBet(c: Db | Tx, u: { country: string | null; date_of_birth: string | null }): Promise<void> {
  if (u.date_of_birth && !isAdult(u.date_of_birth)) throw new ApiError(403, 'underage', `PreFlop is for players aged ${MIN_AGE} or over`);
  if (u.country && (await loadTerritories(c)).blocked.includes(u.country)) throw new ApiError(403, 'territory_blocked', 'PreFlop is not available in your country');
}

// ---------------------------------------------------------------- play sessions (session_minutes)

/** Reality checks fall due every session_minutes, or every hour when no limit is set. */
export const DEFAULT_REALITY_CHECK_MINUTES = 60;

export interface PlaySession {
  started_at: string;
  minutes_played: number;
  /** The player's session_minutes limit (null: none). */
  limit_minutes: number | null;
  /** When the limit ends betting in this session (null: no limit). */
  ends_at: string | null;
  limit_reached: boolean;
  reality_check_minutes: number;
}

/**
 * The play session of a signed-in token. It starts when the session is created (sign-in); with a
 * session_minutes limit, betting stops once that many minutes have passed and resumes only in a
 * NEW session, i.e. after signing in again.
 */
export async function playSession(c: Db | Tx, tokenSha256: string, userId: string): Promise<PlaySession> {
  await applyDueLimits(c, userId);
  const r = (await c.query<{ started: Date; now: Date; limit: number | null }>(
    `select s.play_started_at as started, now() as now, l.session_minutes as limit
       from sessions s left join rg_limits l on l.user_id = s.user_id
      where s.token_sha256 = $1 and s.user_id = $2`, [tokenSha256, userId])).rows[0];
  if (!r) throw new ApiError(401, 'unauthorized', 'session expired or invalid');
  const elapsedMs = Math.max(0, r.now.getTime() - r.started.getTime());
  const ends = r.limit === null ? null : new Date(r.started.getTime() + r.limit * 60_000);
  return {
    started_at: r.started.toISOString(),
    minutes_played: Math.floor(elapsedMs / 60_000),
    limit_minutes: r.limit,
    ends_at: ends?.toISOString() ?? null,
    limit_reached: ends !== null && r.now.getTime() >= ends.getTime(),
    reality_check_minutes: r.limit ?? DEFAULT_REALITY_CHECK_MINUTES,
  };
}

export async function assertSessionTime(c: Db | Tx, tokenSha256: string, userId: string): Promise<void> {
  const s = await playSession(c, tokenSha256, userId);
  if (s.limit_reached) {
    throw new ApiError(403, 'session_limit', `your ${s.limit_minutes}-minute session limit is reached; take a break and sign in again to continue`, { ends_at: s.ends_at });
  }
}
