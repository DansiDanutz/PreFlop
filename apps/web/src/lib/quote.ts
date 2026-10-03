import type { PlayMode, Room } from '@preflop/client';
import { GLOBAL_RULES, payoutMinor, platformFeeMinor, splitDiamondBet } from '@preflop/odds-engine/stake-split';

/**
 * What one bet costs and returns, with the same engine arithmetic the API uses at placement
 * (apps/api bets/service.ts and bets/rooms.ts), so the slip and the confirm sheet show exactly the
 * potential_payout_minor the API returns:
 *
 * - PreFlop house (free chips, real money): the whole stake plays; return = floor(stake × odds).
 * - Diamond rooms: 1 ◆ PreFlop fee and the room's rake come out of the stake; the rest is at risk.
 * - Chip rooms, organizer house: the platform fee is paid by the organizer's collateral, so the
 *   whole stake plays.
 * - Chip rooms, pool: the platform fee and the rake come out of the stake; the rest joins the pool.
 *
 * A pool's return is a share known only at settlement (totalReturnMinor null).
 */
export interface BetQuote {
  stakeMinor: number;
  /** PreFlop's fee taken from the player's stake (0 when the house pays it, or no fee applies). */
  feeMinor: number;
  /** The room's rake taken from the stake. */
  rakeMinor: number;
  /** What plays against the house or goes into the pool: stake − fee − rake. */
  atRiskMinor: number;
  /** Total return if correct (at-risk × decimal odds, rounded down); null for a pool. */
  totalReturnMinor: number | null;
  pool: boolean;
}

export type QuoteRoom = Pick<Room, 'mode' | 'house' | 'rules'>;

/** null when the stake cannot be placed as is (not a whole number, below the minimum, or eaten by fees). */
export function betQuote(stakeMinor: number, oddsCenti: number, room: QuoteRoom | null | undefined): BetQuote | null {
  if (!Number.isSafeInteger(stakeMinor) || stakeMinor < 1 || !Number.isSafeInteger(oddsCenti) || oddsCenti < 100) return null;
  const pool = room?.house === 'pool';
  let fee = 0;
  let rake = 0;
  if (room) {
    if (stakeMinor < room.rules.min_stake_minor) return null;
    const mode = room.mode as PlayMode;
    if (mode === 'diamonds') {
      try {
        const split = splitDiamondBet(stakeMinor, { rakeBps: room.rules.rake_bps ?? 0, minStake: room.rules.min_stake_minor, rakeShares: [{ role: 'organizer', party: 'organizer', bps: 10000 }] });
        fee = split.preflopFee;
        rake = split.rake;
      } catch {
        return null;
      }
    } else if (pool) {
      fee = platformFeeMinor(mode, stakeMinor, GLOBAL_RULES.platformFee);
      rake = Math.floor((stakeMinor * (room.rules.rake_bps ?? 0)) / 10000);
    }
  }
  const atRisk = stakeMinor - fee - rake;
  if (atRisk <= 0) return null;
  return { stakeMinor, feeMinor: fee, rakeMinor: rake, atRiskMinor: atRisk, totalReturnMinor: pool ? null : payoutMinor(atRisk, oddsCenti), pool };
}

/** The confirm sheet's and the slip's breakdown: only the lines that differ from "the whole stake plays". */
export function quoteLines(q: BetQuote | null, format: (minor: number) => string): { label: string; value: string }[] {
  if (!q || (q.feeMinor === 0 && q.rakeMinor === 0)) return [];
  return [
    ...(q.feeMinor > 0 ? [{ label: 'PreFlop fee', value: format(q.feeMinor) }] : []),
    ...(q.rakeMinor > 0 ? [{ label: 'Room rake', value: format(q.rakeMinor) }] : []),
    { label: q.pool ? 'Into the pool' : 'At risk', value: format(q.atRiskMinor) },
  ];
}
