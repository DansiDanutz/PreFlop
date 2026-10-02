import type { Db, Tx } from './db.ts';
import { ApiError } from './errors.ts';

/** EUR cents of an amount: stablecoins (6 decimals) count 1:1 with EUR, so 10,000 micro-units = 1 cent. */
export const toEurCents = (currency: string, amountMinor: number): number =>
  currency === 'EUR' ? amountMinor : currency === 'USDT' || currency === 'USDC' ? Math.ceil(amountMinor / 10_000) : amountMinor;

/**
 * Promotes responsible-gaming limit changes whose 24 h cooling-off has ended. Called before every
 * read and every enforcement, so a due increase (or removal) takes effect exactly when it should.
 */
export async function applyDueLimits(c: Db | Tx, userId: string): Promise<void> {
  await c.query(
    `update rg_limits set
        deposit_day_minor = case when pending ? 'deposit_day_minor' then (pending->>'deposit_day_minor')::bigint else deposit_day_minor end,
        loss_day_minor    = case when pending ? 'loss_day_minor'    then (pending->>'loss_day_minor')::bigint    else loss_day_minor end,
        session_minutes   = case when pending ? 'session_minutes'   then (pending->>'session_minutes')::integer  else session_minutes end,
        pending = null, pending_effective_at = null, updated_at = now()
      where user_id = $1 and pending is not null and pending_effective_at <= now()`, [userId]);
}

/**
 * Enforces the daily loss limit (EUR cents, every real-money currency) before `addCents` more is put
 * at risk. Losses over the last 24 h are real-money bets (stake − payout) plus tournament buy-ins
 * net of prizes; a cancelled tournament (refunded) or one left before the start counts nothing.
 */
export async function assertLossLimit(c: Db | Tx, userId: string, addCents: number): Promise<void> {
  await applyDueLimits(c, userId);
  const l = (await c.query<{ loss_day_minor: number | null }>('select loss_day_minor from rg_limits where user_id = $1', [userId])).rows[0];
  if (l?.loss_day_minor == null) return;
  const rows = (await c.query<{ currency: string; n: string }>(
    `select currency, sum(n)::bigint as n from (
       select currency, stake_minor - coalesce(payout_minor, 0) as n from bets
        where user_id = $1 and mode in ('real-fiat','real-crypto') and placed_at > now() - interval '24 hours' and status <> 'void'
       union all
       select t.currency, e.buy_in_minor - coalesce(e.prize_minor, 0) from tournament_entries e join tournaments t on t.id = e.tournament_id
        where e.user_id = $1 and t.mode in ('real-fiat','real-crypto') and t.status <> 'cancelled' and e.created_at > now() - interval '24 hours'
     ) x group by currency`, [userId])).rows;
  const lostCents = rows.reduce((a, x) => a + toEurCents(x.currency, Number(x.n)), 0);
  if (lostCents + addCents > l.loss_day_minor) throw new ApiError(403, 'limit_reached', 'your daily loss limit would be exceeded');
}
