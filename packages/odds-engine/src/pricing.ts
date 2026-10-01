import { type Channel, type CostModel, DEFAULT_COST_MODEL } from './costModel.ts';
import { netEdge, requiredGrossMargin } from './economics.ts';
import { FLOP_COUNT } from './flops.ts';
import type { SelectionStats } from './probability.ts';

/**
 * Fixed-odds pricing against the house.
 *
 *   margin m   = max(tier floor for p, gross margin required by the channel's net-EV target)
 *   odds       = floorToTick((1 − m) / p)
 *
 * Odds are always rounded DOWN, so the player's expected return p · odds is never
 * above 1 − m: the house edge can only grow from rounding. All comparisons are
 * done in integers (odds in hundredths, margins in basis points) — no float drift.
 */

/** Minimum margin by probability band (basis points). Rarer outcomes carry more variance and more incentive to cheat. */
export const MARGIN_TIERS: readonly { readonly minProbability: number; readonly marginBps: number; readonly name: string }[] = [
  { minProbability: 0.25, marginBps: 500, name: 'Common (p ≥ 25%)' },
  { minProbability: 0.1, marginBps: 600, name: 'Frequent (10–25%)' },
  { minProbability: 0.03, marginBps: 800, name: 'Medium (3–10%)' },
  { minProbability: 0.01, marginBps: 1000, name: 'Long (1–3%)' },
  { minProbability: 0.003, marginBps: 1200, name: 'Rare (0.3–1%)' },
  { minProbability: 0, marginBps: 1500, name: 'Very rare (< 0.3%)' },
];

/** Selections whose fair odds exceed this are not offered (liability and integrity risk). */
export const MAX_FAIR_ODDS = 1000;
/** Lowest decimal odds we will offer, in hundredths. */
export const MIN_ODDS_CENTI = 105;

/** Odds ladder in hundredths: [from, tick]. Fine enough that rounding costs players little. */
const LADDER: readonly (readonly [number, number])[] = [
  [100, 1], [500, 5], [1000, 10], [2000, 25], [5000, 50], [10000, 100],
];

export function floorToTick(centi: number): number {
  let band = LADDER[0]!;
  for (const b of LADDER) if (centi >= b[0]) band = b;
  const [from, tick] = band;
  return from + Math.floor((centi - from) / tick) * tick;
}

export function tierFor(probability: number): (typeof MARGIN_TIERS)[number] {
  return MARGIN_TIERS.find((t) => probability >= t.minProbability)!;
}

export interface Price {
  readonly selectionId: string;
  readonly channel: Channel;
  readonly wins: number;
  readonly probability: number;
  readonly fairOdds: number;
  readonly tierBps: number;
  readonly requiredBps: number;
  /** Margin actually applied (max of the two above). */
  readonly marginBps: number;
  readonly offered: boolean;
  readonly reason?: string;
  /** Decimal odds in hundredths (238 = 2.38). 0 when not offered. */
  readonly oddsCenti: number;
  readonly odds: number;
  /** House GGR per unit staked at the offered odds: 1 − p · odds. */
  readonly grossEdge: number;
  /** PreFlop's net EV per unit staked after revenue shares, promotions and variable costs. */
  readonly netEdge: number;
}

export function price(stats: SelectionStats, channel: Channel = 'direct', model: CostModel = DEFAULT_COST_MODEL): Price {
  const ch = model.channels[channel];
  const { wins, probability } = stats;
  const fairOdds = wins === 0 ? Number.POSITIVE_INFINITY : FLOP_COUNT / wins;
  const tierBps = tierFor(probability).marginBps;
  const required = requiredGrossMargin(ch, model.netTargetMargin);
  const requiredBps = Number.isFinite(required) ? Math.ceil(required * 10000 - 1e-9) : Number.POSITIVE_INFINITY;
  const marginBps = Math.max(tierBps, requiredBps);
  const base = { selectionId: stats.selection.id, channel, wins, probability, fairOdds, tierBps, requiredBps, marginBps };

  const reject = (reason: string): Price => ({ ...base, offered: false, reason, oddsCenti: 0, odds: 0, grossEdge: 1, netEdge: Number.NaN });

  if (!ch.houseRisk) return reject('channel is fee-based (contests / pools), not fixed odds');
  if (wins === 0) return reject('impossible outcome');
  if (fairOdds > MAX_FAIR_ODDS) return reject(`fair odds ${fairOdds.toFixed(0)} above cap ${MAX_FAIR_ODDS}`);
  if (marginBps >= 10000) return reject('costs exceed any achievable margin');

  // Largest odds (hundredths) with oddsCenti * wins / 100 / N <= (10000 − marginBps) / 10000.
  const maxCenti = Math.floor(((10000 - marginBps) * FLOP_COUNT) / (wins * 100));
  const oddsCenti = floorToTick(maxCenti);
  if (oddsCenti < MIN_ODDS_CENTI) return reject(`odds below minimum ${MIN_ODDS_CENTI / 100}`);

  const grossEdge = 1 - (oddsCenti * wins) / (100 * FLOP_COUNT);
  return { ...base, offered: true, oddsCenti, odds: oddsCenti / 100, grossEdge, netEdge: netEdge(grossEdge, ch) };
}

/** Exact integer check of the house-edge invariant: p · odds ≤ 1 − margin. */
export function satisfiesMargin(p: Price): boolean {
  return !p.offered || p.oddsCenti * p.wins * 100 <= (10000 - p.marginBps) * FLOP_COUNT;
}

/** Payout in minor units (stake returned plus winnings), rounded down in the house's favour. */
export function payoutMinor(stakeMinor: number, oddsCenti: number): number {
  if (!Number.isSafeInteger(stakeMinor) || stakeMinor < 0) throw new RangeError('stake must be a non-negative integer in minor units');
  return Number((BigInt(stakeMinor) * BigInt(oddsCenti)) / 100n);
}
