import type { Db, Tx } from './db.ts';

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
