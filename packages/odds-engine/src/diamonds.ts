import { type RoleShare, allocateLargestRemainder, mergeRoles } from './fees.ts';
import { GLOBAL_RULES } from './globalRules.ts';
import { payoutMinor } from './pricing.ts';

/**
 * Diamonds — PreFlop sells diamonds to organizers; organizers hand them to their
 * players and run rooms with their own rules inside PreFlop's global bounds.
 *
 * Every diamond bet is split at placement, and the split is stamped on the bet:
 *
 *   stake = PreFlop fixed fee (sunk back to PreFlop) + organizer rake (split by predefined shares) + at-risk amount
 *
 * The at-risk amount plays against the organizer's house (or goes into a pool).
 * Because the PreFlop fee leaves the organizer's economy on every bet, the
 * organizer's diamond supply shrinks with play, and the organizer rebuys.
 */

export interface DiamondRules {
  /** Organizer rake on each bet, bps of stake, within the global bounds. */
  readonly rakeBps: number;
  /** Who receives the rake. Must total 10,000 bps. */
  readonly rakeShares: readonly RoleShare[];
  /** Minimum stake in diamonds (≥ the global minimum). */
  readonly minStake: number;
}

export function validateDiamondRules(r: DiamondRules): string[] {
  const g = GLOBAL_RULES.diamonds;
  const problems: string[] = [];
  if (r.rakeBps < g.rakeBpsMin || r.rakeBps > g.rakeBpsMax) problems.push(`rake ${r.rakeBps} bps outside ${g.rakeBpsMin}–${g.rakeBpsMax}`);
  if (r.minStake < g.minStake) problems.push(`minimum stake ${r.minStake} below global minimum ${g.minStake}`);
  try { mergeRoles(r.rakeShares); } catch (e) { problems.push((e as Error).message); }
  return problems;
}

export interface DiamondBetSplit {
  readonly stake: number;
  readonly preflopFee: number;
  readonly rake: number;
  readonly rakeByParty: Map<string, number>;
  /** What actually plays against the house / pool. */
  readonly atRisk: number;
}

/** The predefined split of one diamond bet. Exact: stake = fee + rake + atRisk. */
export function splitDiamondBet(stake: number, rules: DiamondRules): DiamondBetSplit {
  const problems = validateDiamondRules(rules);
  if (problems.length) throw new RangeError(`invalid diamond rules: ${problems.join('; ')}`);
  if (!Number.isSafeInteger(stake) || stake < rules.minStake) throw new RangeError(`stake must be an integer ≥ ${rules.minStake}`);
  const preflopFee = GLOBAL_RULES.diamonds.preflopFeePerBet;
  const rake = Math.floor((stake * rules.rakeBps) / 10000);
  return { stake, preflopFee, rake, rakeByParty: allocateLargestRemainder(rake, mergeRoles(rules.rakeShares)), atRisk: stake - preflopFee - rake };
}

/** Winnings paid by the organizer house on a winning diamond bet. */
export function diamondPayout(split: DiamondBetSplit, oddsCenti: number): number {
  return payoutMinor(split.atRisk, oddsCenti);
}

/** EUR cents for a purchase of `diamonds`, using the whole-volume pack price ladder. */
export function quoteDiamonds(diamonds: number): { cents: number; centsPerHundred: number } {
  let rate = GLOBAL_RULES.diamonds.priceTiers[0]!.centsPerHundred;
  for (const t of GLOBAL_RULES.diamonds.priceTiers) if (diamonds >= t.fromDiamonds) rate = t.centsPerHundred;
  return { cents: Math.ceil((diamonds * rate) / 100), centsPerHundred: rate };
}

// ---------- dilution tracking ----------

export interface DiamondFlows {
  readonly bought: number;
  readonly bets: number;
  readonly stakes: number;
  readonly preflopFees: number;
  /** Rake that stays with the organizer. */
  readonly rakeToOrganizer: number;
  /** Rake paid to other diamond holders (co-hosts, referrers). */
  readonly rakeToOthers: number;
  /** Organizer house result on at-risk amounts (positive = organizer won). */
  readonly houseNet: number;
}

export interface DilutionReport {
  /** Diamonds still in the organizer's economy (organizer + its players). */
  readonly circulating: number;
  /** Share of every staked diamond that leaves the economy (PreFlop fee + rake to others). */
  readonly sinkRate: number;
  /** Average number of times a diamond can be staked before it is consumed. */
  readonly stakesPerDiamondLife: number;
  /** Diamonds consumed per bet on average. */
  readonly consumedPerBet: number;
  /** Bets the remaining supply supports at the current pace. */
  readonly betsUntilEmpty: number;
}

export function dilution(f: DiamondFlows): DilutionReport {
  const sunk = f.preflopFees + f.rakeToOthers;
  const circulating = f.bought - sunk;
  const sinkRate = f.stakes > 0 ? sunk / f.stakes : 0;
  const consumedPerBet = f.bets > 0 ? sunk / f.bets : 0;
  return {
    circulating,
    sinkRate,
    stakesPerDiamondLife: sinkRate > 0 ? 1 / sinkRate : Number.POSITIVE_INFINITY,
    consumedPerBet,
    betsUntilEmpty: consumedPerBet > 0 ? Math.floor(circulating / consumedPerBet) : Number.POSITIVE_INFINITY,
  };
}
