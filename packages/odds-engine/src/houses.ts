import { RoundExposure } from './exposure.ts';
import { GLOBAL_RULES } from './globalRules.ts';
import { type HouseKind, MODES, type PlayMode, assertHouseAllowed } from './modes.ts';
import { payoutMinor } from './pricing.ts';
import type { SelectionStats } from './probability.ts';

/**
 * Who pays the winnings.
 *
 * - PreFlop house:   stakes go to PreFlop's bankroll for the mode; PreFlop pays winners.
 * - Organizer house: stakes go to the organizer's on-platform collateral; the organizer
 *                    pays winners from it and pays PreFlop a platform fee per bet.
 * - Pool:            nobody is the house; winners share the pool (fees.ts, settleParimutuel).
 */

// ---------- ledger postings ----------

export interface Posting {
  readonly from: string;
  readonly to: string;
  readonly amountMinor: number;
  readonly memo: string;
}

/** Ledger account naming: `<owner>:<purpose>:<mode>`. */
export const account = (owner: string, purpose: string, mode: PlayMode): string => `${owner}:${purpose}:${mode}`;

export interface PlatformFee {
  readonly turnoverBps: number;
  readonly minPerBetMinor: number;
  /** Fixed amount per bet (diamonds use this). */
  readonly fixedPerBetMinor?: number;
}

/** PreFlop's fee on one organizer-house bet. Always 0 in fee-free modes. */
export function platformFeeMinor(mode: PlayMode, stakeMinor: number, fee: PlatformFee): number {
  if (!MODES[mode].feesApply) return 0;
  const pct = Number((BigInt(stakeMinor) * BigInt(fee.turnoverBps)) / 10000n);
  return Math.min(stakeMinor, Math.max(fee.minPerBetMinor, (fee.fixedPerBetMinor ?? 0) + pct));
}

export interface BetFlowInput {
  readonly mode: PlayMode;
  readonly house: Exclude<HouseKind, 'pool'>;
  /** The organizer's id when house = organizer. */
  readonly organizerId?: string;
  readonly playerId: string;
  readonly stakeMinor: number;
  readonly oddsCenti: number;
  readonly won: boolean;
  readonly platformFee?: PlatformFee;
}

/**
 * All ledger movements of one fixed-odds bet, from placement to settlement.
 * Every posting moves money between two accounts, so the ledger always balances.
 */
export function betPostings(b: BetFlowInput): Posting[] {
  assertHouseAllowed(b.mode, b.house);
  const player = account(b.playerId, 'wallet', b.mode);
  const house = b.house === 'preflop'
    ? account('PreFlop', 'bankroll', b.mode)
    : account(b.organizerId ?? 'organizer', 'collateral', b.mode);
  const out: Posting[] = [{ from: player, to: house, amountMinor: b.stakeMinor, memo: 'stake' }];
  if (b.house === 'organizer') {
    const fee = platformFeeMinor(b.mode, b.stakeMinor, b.platformFee ?? GLOBAL_RULES.platformFee);
    if (fee > 0) out.push({ from: house, to: account('PreFlop', 'platform-fees', b.mode), amountMinor: fee, memo: 'platform fee' });
  }
  if (b.won) out.push({ from: house, to: player, amountMinor: payoutMinor(b.stakeMinor, b.oddsCenti), memo: 'payout' });
  return out;
}

/** Net balance change per account; a balanced set of postings sums to zero. */
export function balances(postings: readonly Posting[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of postings) {
    m.set(p.from, (m.get(p.from) ?? 0) - p.amountMinor);
    m.set(p.to, (m.get(p.to) ?? 0) + p.amountMinor);
  }
  return m;
}

// ---------- organizer as the house ----------

export interface OrganizerHouseConfig {
  readonly mode: PlayMode;
  /** Gross margin the organizer's book applies over fair odds (bps). */
  readonly marginBps: number;
  readonly platformFee: PlatformFee;
  /** Share of the organizer's GGR owed to the provider club (bps). */
  readonly providerShareBps: number;
  /** Typical stake, used to evaluate fixed / minimum fees per bet. */
  readonly typicalStakeMinor: number;
}

export interface OrganizerHouseCheck {
  readonly ok: boolean;
  /** Organizer's expected value per unit staked after PreFlop's fee and the provider share. */
  readonly organizerEv: number;
  readonly platformFeeRate: number;
  readonly problems: readonly string[];
}

/**
 * An organizer may only be the house if its own book has the edge after paying
 * PreFlop and the provider club. Rejects configurations that would lose money on average.
 */
export function validateOrganizerHouse(c: OrganizerHouseConfig): OrganizerHouseCheck {
  const problems: string[] = [];
  if (!MODES[c.mode].houses.includes('organizer')) problems.push(`mode ${c.mode} does not allow an organizer house`);
  if (c.marginBps < GLOBAL_RULES.organizerMinMarginBps)
    problems.push(`margin ${c.marginBps} bps is below the global minimum ${GLOBAL_RULES.organizerMinMarginBps} bps`);
  const margin = c.marginBps / 10000;
  const feeRate = c.typicalStakeMinor > 0 ? platformFeeMinor(c.mode, c.typicalStakeMinor, c.platformFee) / c.typicalStakeMinor : 0;
  const organizerEv = margin * (1 - c.providerShareBps / 10000) - feeRate;
  if (organizerEv * 10000 < GLOBAL_RULES.organizerMinEvBps)
    problems.push(`organizer EV ${(organizerEv * 100).toFixed(2)}% is below the minimum ${(GLOBAL_RULES.organizerMinEvBps / 100).toFixed(2)}%`);
  return { ok: problems.length === 0, organizerEv, platformFeeRate: feeRate, problems };
}

/**
 * The organizer's collateral account. Every open round's worst-case loss is
 * reserved against it; a bet is refused if the reserved total would exceed the balance.
 * PreFlop therefore never has to pay an organizer's winners.
 */
export class OrganizerCollateral {
  private readonly rounds = new Map<string, RoundExposure>();

  constructor(private balanceMinor: number) {
    if (!(balanceMinor >= 0)) throw new RangeError('collateral must be >= 0');
  }

  get balance(): number {
    return this.balanceMinor;
  }

  /** Sum of worst-case losses over all open rounds (independent tables can all lose). */
  reservedMinor(): number {
    let r = 0;
    for (const e of this.rounds.values()) r += e.worstCase().lossMinor;
    return r;
  }

  availableMinor(): number {
    return this.balanceMinor - this.reservedMinor();
  }

  deposit(amountMinor: number): void {
    this.balanceMinor += amountMinor;
  }

  tryBet(roundId: string, stats: SelectionStats, stakeMinor: number, oddsCenti: number): boolean {
    let exp = this.rounds.get(roundId);
    if (!exp) {
      exp = new RoundExposure(Number.MAX_SAFE_INTEGER);
      this.rounds.set(roundId, exp);
    }
    const others = this.reservedMinor() - exp.worstCase().lossMinor;
    if (others + exp.lossIfAdded(stats, stakeMinor, oddsCenti) > this.balanceMinor) return false;
    exp.tryAdd(stats, stakeMinor, oddsCenti);
    return true;
  }

  /** Applies the round's result (house net for the dealt flop) and releases its reservation. */
  settleRound(roundId: string, flopIndex: number): number {
    const exp = this.rounds.get(roundId);
    if (!exp) return 0;
    const net = exp.houseNetFor(flopIndex);
    this.balanceMinor += net;
    this.rounds.delete(roundId);
    return net;
  }
}
