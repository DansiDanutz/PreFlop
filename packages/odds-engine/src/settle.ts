import type { Flop } from './flops.ts';
import { getSelection } from './markets.ts';
import { payoutMinor } from './pricing.ts';

export interface AcceptedBet {
  readonly betId: string;
  readonly selectionId: string;
  readonly stakeMinor: number;
  /** Odds locked at acceptance, in hundredths. */
  readonly oddsCenti: number;
}

export type Settlement =
  | { readonly betId: string; readonly status: 'won'; readonly payoutMinor: number }
  | { readonly betId: string; readonly status: 'lost'; readonly payoutMinor: 0 }
  | { readonly betId: string; readonly status: 'void'; readonly payoutMinor: number; readonly reason: string };

/**
 * Settles a fixed-odds bet. `flop === null` means the round was voided
 * (no verified flop): the stake is refunded in full.
 * Deterministic and side-effect free, so retries can never pay twice — the
 * caller persists the result under the bet id (idempotency key).
 */
export function settle(bet: AcceptedBet, flop: Flop | null, voidReason = 'round void'): Settlement {
  if (flop === null) return { betId: bet.betId, status: 'void', payoutMinor: bet.stakeMinor, reason: voidReason };
  return getSelection(bet.selectionId).wins(flop)
    ? { betId: bet.betId, status: 'won', payoutMinor: payoutMinor(bet.stakeMinor, bet.oddsCenti) }
    : { betId: bet.betId, status: 'lost', payoutMinor: 0 };
}
