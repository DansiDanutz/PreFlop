import { type DiamondRules, splitDiamondBet } from './diamonds.ts';
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

/**
 * Ledger account naming: `<owner>:<purpose>:<mode>:<currency>`. The currency is part of the
 * account identity, so e.g. USDT and USDC balances in real-crypto mode are never interchangeable.
 */
export const account = (owner: string, purpose: string, mode: PlayMode, currency: string): string => {
  if (!MODES[mode].currencies.includes(currency)) throw new RangeError(`currency ${currency} is not valid in mode ${mode}`);
  return `${owner}:${purpose}:${mode}:${currency}`;
};

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

interface BetFlowBase {
  readonly mode: PlayMode;
  /** Settlement currency; must belong to the mode (e.g. USDT or USDC in real-crypto). */
  readonly currency: string;
  readonly playerId: string;
  readonly stakeMinor: number;
  readonly oddsCenti: number;
  readonly won: boolean;
  readonly platformFee?: PlatformFee;
  /** Required in diamonds mode: the room's rules (rake and its predefined shares). */
  readonly diamondRules?: DiamondRules;
}

/** Who pays the winnings. An organizer house must always name its organizer — there is no shared default. */
export type BetFlowInput =
  | (BetFlowBase & { readonly house: 'preflop' })
  | (BetFlowBase & { readonly house: 'organizer'; readonly organizerId: string });

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/** Account owners are non-empty ids without the ':' separator; 'PreFlop' is reserved. */
export function assertOwnerId(id: unknown, what: string): asserts id is string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new RangeError(`${what} must be a non-empty id (letters, digits, _ . -), got ${JSON.stringify(id)}`);
  if (id === 'PreFlop') throw new RangeError(`${what} cannot be the reserved id 'PreFlop'`);
}

/**
 * All ledger movements of one fixed-odds bet, from placement to settlement.
 * Every posting moves money between two accounts, so the ledger always balances.
 *
 * Diamond bets follow their predefined split: the fixed PreFlop fee and the rake shares
 * leave the house at placement, and winnings are paid on the at-risk amount only.
 */
export function betPostings(b: BetFlowInput): Posting[] {
  assertHouseAllowed(b.mode, b.house);
  assertOwnerId(b.playerId, 'playerId');
  if (b.house === 'organizer') assertOwnerId(b.organizerId, 'organizerId');
  const acct = (owner: string, purpose: string) => account(owner, purpose, b.mode, b.currency);
  const player = acct(b.playerId, 'wallet');
  const house = b.house === 'preflop' ? acct('PreFlop', 'bankroll') : acct(b.organizerId, 'collateral');
  const out: Posting[] = [{ from: player, to: house, amountMinor: b.stakeMinor, memo: 'stake' }];

  if (b.mode === 'diamonds') {
    if (!b.diamondRules) throw new RangeError('diamond bets need the room\'s diamond rules');
    const split = splitDiamondBet(b.stakeMinor, b.diamondRules);
    out.push({ from: house, to: acct('PreFlop', 'diamond-treasury'), amountMinor: split.preflopFee, memo: 'PreFlop diamond fee' });
    for (const [party, amt] of split.rakeByParty)
      if (amt > 0) out.push({ from: house, to: acct(party, 'rake'), amountMinor: amt, memo: 'rake share' });
    if (b.won) out.push({ from: house, to: player, amountMinor: payoutMinor(split.atRisk, b.oddsCenti), memo: 'payout' });
    return out;
  }

  if (b.house === 'organizer') {
    const fee = platformFeeMinor(b.mode, b.stakeMinor, b.platformFee ?? GLOBAL_RULES.platformFee);
    if (fee > 0) out.push({ from: house, to: acct('PreFlop', 'platform-fees'), amountMinor: fee, memo: 'platform fee' });
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
  /**
   * Smallest stake the room accepts. PreFlop's fee has a fixed minimum per bet, so the fee
   * RATE is highest at the smallest stake: the organizer's edge is validated at this stake,
   * which makes it hold for every accepted stake. Bets below it must be refused (assertOrganizerStake).
   */
  readonly minStakeMinor: number;
  /** Typical stake — reported as a forecast only, never used to admit a configuration. */
  readonly typicalStakeMinor?: number;
}

export interface OrganizerHouseCheck {
  readonly ok: boolean;
  /**
   * Organizer's guaranteed EV per unit staked: the margin after the provider share, minus a
   * PROVEN upper bound on PreFlop's fee rate over every stake the room accepts.
   */
  readonly organizerEv: number;
  /** Proven upper bound of fee / stake for every stake >= minStakeMinor (see feeRateUpperBound). */
  readonly platformFeeRate: number;
  /** Forecast at the typical stake, if one was given (never used to admit a configuration). */
  readonly typicalEv?: number;
  readonly problems: readonly string[];
}

/**
 * Upper bound of platformFeeMinor(stake) / stake over ALL stakes >= minStake.
 *
 * Integer flooring makes the fee rate discontinuous (e.g. 150 bps with a 2-unit minimum: the fee
 * is 2 at 199 but 3 at 200), so one sample at the minimum stake is not the maximum (audit F10,
 * re-audit of 8cb639b). For s >= minStake:
 *   fee(s) <= max(minPerBet, fixed + s·bps/10000)
 *   fee(s)/s <= max(minPerBet/minStake, fixed/minStake + bps/10000)
 * and the fee never exceeds the stake, so the bound is also capped at 1.
 */
export function feeRateUpperBound(mode: PlayMode, minStakeMinor: number, fee: PlatformFee): number {
  if (!MODES[mode].feesApply) return 0;
  const fixed = fee.fixedPerBetMinor ?? 0;
  return Math.min(1, Math.max(fee.minPerBetMinor / minStakeMinor, fixed / minStakeMinor + fee.turnoverBps / 10000));
}

/**
 * An organizer may only be the house if its own book has the edge after paying
 * PreFlop and the provider club, for EVERY stake the room accepts. Rejects configurations
 * that could lose money on average at some admissible stake.
 */
export function validateOrganizerHouse(c: OrganizerHouseConfig): OrganizerHouseCheck {
  const problems: string[] = [];
  if (!MODES[c.mode].houses.includes('organizer')) problems.push(`mode ${c.mode} does not allow an organizer house`);
  if (c.marginBps < GLOBAL_RULES.organizerMinMarginBps)
    problems.push(`margin ${c.marginBps} bps is below the global minimum ${GLOBAL_RULES.organizerMinMarginBps} bps`);
  if (!Number.isSafeInteger(c.minStakeMinor) || c.minStakeMinor <= 0) problems.push('minStakeMinor must be a positive integer');
  if (!Number.isInteger(c.providerShareBps) || c.providerShareBps < 0 || c.providerShareBps > 10000) problems.push('providerShareBps must be 0–10000');
  const kept = (c.marginBps / 10000) * (1 - c.providerShareBps / 10000);
  const minStake = Number.isSafeInteger(c.minStakeMinor) && c.minStakeMinor > 0 ? c.minStakeMinor : 1;
  const feeRate = feeRateUpperBound(c.mode, minStake, c.platformFee);
  const ev = kept - feeRate;
  if (ev * 10000 < GLOBAL_RULES.organizerMinEvBps)
    problems.push(`organizer EV is guaranteed only down to ${(ev * 100).toFixed(4)}% over stakes >= ${minStake} (fee rate up to ${(feeRate * 100).toFixed(4)}%), below the required ${(GLOBAL_RULES.organizerMinEvBps / 100).toFixed(2)}% — raise the margin or the minimum stake`);
  const typical = c.typicalStakeMinor && c.typicalStakeMinor > 0
    ? kept - platformFeeMinor(c.mode, c.typicalStakeMinor, c.platformFee) / c.typicalStakeMinor
    : undefined;
  return { ok: problems.length === 0, organizerEv: ev, platformFeeRate: feeRate, ...(typical !== undefined ? { typicalEv: typical } : {}), problems };
}

/** Refuses a bet below the room's validated minimum stake. */
export function assertOrganizerStake(c: Pick<OrganizerHouseConfig, 'minStakeMinor'>, stakeMinor: number): void {
  if (!Number.isSafeInteger(stakeMinor) || stakeMinor < c.minStakeMinor) throw new RangeError(`stake ${stakeMinor} is below the room's minimum ${c.minStakeMinor}`);
}

/**
 * Exact organizer EV of ONE bet, in minor units, using the exact win count over 22,100 flops,
 * the integer payout and the integer fee actually charged:
 *   EV = (1 − providerShare)·(stake − p·payout) − fee
 * Returned as a rational (numerator / 22100) to avoid rounding.
 */
export function organizerBetEvNumerator(
  c: Pick<OrganizerHouseConfig, 'mode' | 'platformFee' | 'providerShareBps'>,
  stats: Pick<SelectionStats, 'wins'>, stakeMinor: number, oddsCenti: number,
): { numerator: bigint; denominator: bigint } {
  const payout = BigInt(payoutMinor(stakeMinor, oddsCenti));
  const fee = BigInt(platformFeeMinor(c.mode, stakeMinor, c.platformFee));
  const N = 22100n;
  // GGR·N = stake·N − wins·payout; organizer keeps (10000 − share)/10000 of it.
  const ggrN = BigInt(stakeMinor) * N - BigInt(stats.wins) * payout;
  return { numerator: ggrN * BigInt(10000 - c.providerShareBps) - fee * N * 10000n, denominator: N * 10000n };
}

/**
 * Admission check for one organizer-house bet: the stake is at least the room minimum AND the
 * exact EV of this bet (actual odds, payout rounding and fee) meets the global minimum EV rate.
 * The configuration bound makes this pass for well-formed rooms; this check is the backstop.
 */
export function assertOrganizerBet(c: OrganizerHouseConfig, stats: Pick<SelectionStats, 'wins'>, stakeMinor: number, oddsCenti: number): void {
  assertOrganizerStake(c, stakeMinor);
  const { numerator, denominator } = organizerBetEvNumerator(c, stats, stakeMinor, oddsCenti);
  // numerator/denominator >= stake · minEvBps / 10000
  if (numerator * 10000n < BigInt(stakeMinor) * BigInt(GLOBAL_RULES.organizerMinEvBps) * denominator)
    throw new RangeError(`organizer EV of this bet is below ${(GLOBAL_RULES.organizerMinEvBps / 100).toFixed(2)}% of the stake`);
}

/**
 * Risk reservation against an organizer's collateral account.
 *
 * The ledger is the only source of truth for the collateral balance: postings from
 * betPostings() move the money, and this class is told the current ledger balance with
 * syncBalance(). It never changes the balance itself, so results are never counted twice.
 *
 * Every open round reserves its worst-case OUTGO: the largest total payout over all 22,100
 * flops plus certain costs such as PreFlop's platform fee (= stakes + costs − minNet). The
 * ledger balance already contains the round's stakes once they are posted, so reserving only
 * the net loss (−minNet) would under-reserve by the stakes (found while wiring the backend:
 * €850 + a €100 stake could have accepted a bet paying €1,000). A bet is refused if the total
 * reserved would exceed the balance, so the organizer can always pay its winners and fees and
 * PreFlop never carries an organizer's risk. Before the stake is posted and synced the check is
 * conservative by that stake, never optimistic.
 */
export class OrganizerCollateral {
  private readonly rounds = new Map<string, { exposure: RoundExposure; certainCostsMinor: number }>();

  /** Worst-case outgo of one round: max payout over all flops + certain costs (stakes − minNet + costs). */
  private static reserveOf(exposure: RoundExposure, certainCosts: number, minNet = exposure.minNet().netMinor, stakes = exposure.totalStakesMinor): number {
    return Math.max(0, stakes - minNet + certainCosts);
  }

  constructor(private balanceMinor: number) {
    if (!(balanceMinor >= 0)) throw new RangeError('collateral must be >= 0');
  }

  get balance(): number {
    return this.balanceMinor;
  }

  /** Update from the ledger after postings are applied (deposits, stakes, fees, payouts). */
  syncBalance(ledgerBalanceMinor: number): void {
    if (!Number.isFinite(ledgerBalanceMinor)) throw new RangeError('invalid balance');
    this.balanceMinor = ledgerBalanceMinor;
  }

  /** Total reserved over all open rounds (independent tables can all lose). */
  reservedMinor(): number {
    let r = 0;
    for (const x of this.rounds.values()) r += OrganizerCollateral.reserveOf(x.exposure, x.certainCostsMinor);
    return r;
  }

  availableMinor(): number {
    return this.balanceMinor - this.reservedMinor();
  }

  /**
   * @param stakeMinor   amount playing against the house (the at-risk amount for diamond bets)
   * @param certainCostMinor costs the house pays whatever the flop, e.g. PreFlop's platform fee
   */
  tryBet(roundId: string, stats: SelectionStats, stakeMinor: number, oddsCenti: number, certainCostMinor = 0): boolean {
    let r = this.rounds.get(roundId);
    if (!r) {
      r = { exposure: new RoundExposure(Number.MAX_SAFE_INTEGER), certainCostsMinor: 0 };
      this.rounds.set(roundId, r);
    }
    const own = OrganizerCollateral.reserveOf(r.exposure, r.certainCostsMinor);
    const ownAfter = OrganizerCollateral.reserveOf(r.exposure, r.certainCostsMinor + certainCostMinor,
      r.exposure.minNetIfAdded(stats, stakeMinor, oddsCenti), r.exposure.totalStakesMinor + stakeMinor);
    if (this.reservedMinor() - own + ownAfter > this.balanceMinor) return false;
    r.exposure.tryAdd(stats, stakeMinor, oddsCenti);
    r.certainCostsMinor += certainCostMinor;
    return true;
  }

  /**
   * Closes the round for the dealt flop and releases its reservation. Returns the house's
   * result (stakes − payouts − certain costs) for reconciliation against the ledger; the
   * balance itself only changes through syncBalance().
   */
  settleRound(roundId: string, flopIndex: number): number {
    const r = this.rounds.get(roundId);
    if (!r) throw new RangeError(`unknown round: ${roundId}`);
    const net = r.exposure.houseNetFor(flopIndex) - r.certainCostsMinor; // throws on an invalid index, round kept
    this.rounds.delete(roundId);
    return net;
  }
}
