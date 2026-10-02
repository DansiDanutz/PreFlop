import { FLOP_COUNT } from './flops.ts';
import { assertMinor, payoutMinor } from './pricing.ts';
import type { SelectionStats } from './probability.ts';

/**
 * Exact live exposure for one betting round.
 *
 * Because there are only 22,100 possible flops, the house's net result can be
 * tracked for EVERY possible flop: houseNet[f] = stakes taken − payouts owed if
 * flop f is dealt. Correlated bets (e.g. "pair" and "pair of kings") are handled
 * exactly, with no approximations. A bet is accepted only if the worst flop still
 * leaves the round's loss within its limit.
 */
export class RoundExposure {
  private readonly houseNet = new Float64Array(FLOP_COUNT);
  private stakes = 0;
  /**
   * Σ stakes + Σ payouts of all bets added. Every |houseNet[f]| is bounded by this, so keeping
   * it within Number.MAX_SAFE_INTEGER keeps every Float64 entry an exact integer.
   */
  private gross = 0;

  /** @param maxLossMinor largest loss the house accepts on this round, in minor units. */
  constructor(readonly maxLossMinor: number) {
    assertMinor(maxLossMinor, 'maxLossMinor');
  }

  /** Validates a bet and returns its payout; throws on any input that could break exactness. */
  private checkBet(stakeMinor: number, oddsCenti: number): number {
    assertMinor(stakeMinor, 'stake');
    if (stakeMinor === 0) throw new RangeError('stake must be positive');
    const pay = payoutMinor(stakeMinor, oddsCenti); // validates odds and the payout range
    if (this.gross + stakeMinor + pay > Number.MAX_SAFE_INTEGER) throw new RangeError('round totals would exceed the safe integer range');
    return pay;
  }

  get totalStakesMinor(): number {
    return this.stakes;
  }

  /** Lowest house net result over all flops (negative = a loss) and the flop that causes it. */
  minNet(): { netMinor: number; flopIndex: number } {
    let min = Number.POSITIVE_INFINITY;
    let at = 0;
    for (let f = 0; f < FLOP_COUNT; f++) {
      const v = this.houseNet[f]!;
      if (v < min) { min = v; at = f; }
    }
    return { netMinor: min, flopIndex: at };
  }

  /** Largest possible house loss over all flops (0 if every flop is profitable) and the flop that causes it. */
  worstCase(): { lossMinor: number; flopIndex: number } {
    const { netMinor, flopIndex } = this.minNet();
    return { lossMinor: Math.max(0, -netMinor), flopIndex };
  }

  /** Lowest house net result over all flops if this bet were added, without adding it. */
  minNetIfAdded(stats: SelectionStats, stakeMinor: number, oddsCenti: number): number {
    const pay = this.checkBet(stakeMinor, oddsCenti);
    const win = new Uint8Array(FLOP_COUNT);
    for (const f of stats.winningFlops) win[f] = 1;
    let min = Number.POSITIVE_INFINITY;
    for (let f = 0; f < FLOP_COUNT; f++) {
      const v = this.houseNet[f]! + stakeMinor - (win[f] ? pay : 0);
      if (v < min) min = v;
    }
    return min;
  }

  /** Worst-case loss if this bet were added, without adding it. */
  lossIfAdded(stats: SelectionStats, stakeMinor: number, oddsCenti: number): number {
    return Math.max(0, -this.minNetIfAdded(stats, stakeMinor, oddsCenti));
  }

  canAccept(stats: SelectionStats, stakeMinor: number, oddsCenti: number): boolean {
    return this.lossIfAdded(stats, stakeMinor, oddsCenti) <= this.maxLossMinor;
  }

  /** Adds the bet if it fits the limit. Returns whether it was accepted. */
  tryAdd(stats: SelectionStats, stakeMinor: number, oddsCenti: number): boolean {
    if (!this.canAccept(stats, stakeMinor, oddsCenti)) return false;
    this.apply(stats, stakeMinor, oddsCenti, 1);
    return true;
  }

  /** Removes a previously added bet (void, cancellation). */
  remove(stats: SelectionStats, stakeMinor: number, oddsCenti: number): void {
    this.apply(stats, stakeMinor, oddsCenti, -1);
  }

  /** House net result if the given flop is dealt. */
  houseNetFor(flopIndex: number): number {
    if (!Number.isInteger(flopIndex) || flopIndex < 0 || flopIndex >= FLOP_COUNT) throw new RangeError(`invalid flop index: ${flopIndex}`);
    return this.houseNet[flopIndex]!;
  }

  private apply(stats: SelectionStats, stakeMinor: number, oddsCenti: number, sign: 1 | -1): void {
    const pay = sign === 1 ? this.checkBet(stakeMinor, oddsCenti) : payoutMinor(stakeMinor, oddsCenti);
    if (sign === -1 && (stakeMinor > this.stakes || stakeMinor + pay > this.gross)) throw new RangeError('cannot remove a bet that was not added');
    for (let f = 0; f < FLOP_COUNT; f++) this.houseNet[f]! += sign * stakeMinor;
    for (const f of stats.winningFlops) this.houseNet[f]! -= sign * pay;
    this.stakes += sign * stakeMinor;
    this.gross += sign * (stakeMinor + pay);
  }
}
