import { allocateLargestRemainder } from './fees.ts';

/**
 * Dynamic revenue sharing. A participant's share is not a fixed percentage:
 * it is computed every billing period from what that participant actually
 * brought — hands dealt at its tables, players it brought, turnover, pools it
 * created — using tier ladders, then capped so PreFlop's net EV target holds.
 */

export type Metric = 'handsDealt' | 'activePlayers' | 'turnoverMinor' | 'poolsCreated';
export type Metrics = Readonly<Partial<Record<Metric, number>>>;

export interface Tier {
  /** Tier applies from this metric value upwards. The first tier must start at 0. */
  readonly from: number;
  readonly bps: number;
}

/**
 * - `whole-volume`: the highest tier reached applies to everything (simple, but has cliffs).
 * - `progressive`: each band of the metric earns its own rate and the result is the
 *   volume-weighted blend, like tax brackets — no cliffs, recommended for turnover.
 */
export type TierMode = 'whole-volume' | 'progressive';

export interface ShareComponent {
  readonly name: string;
  readonly metric: Metric;
  readonly mode: TierMode;
  readonly tiers: readonly Tier[];
}

export interface SharePolicy {
  readonly id: string;
  readonly description: string;
  /** Revenue base the share applies to: house GGR on fixed-odds bets, or rake on pools/contests. */
  readonly base: 'ggr' | 'rake';
  /** Components add up (e.g. content + distribution for a club). */
  readonly components: readonly ShareComponent[];
  readonly floorBps: number;
  readonly capBps: number;
}

function checkTiers(tiers: readonly Tier[]): void {
  if (tiers.length === 0 || tiers[0]!.from !== 0) throw new RangeError('tiers must start at 0');
  for (let i = 1; i < tiers.length; i++)
    if (!(tiers[i]!.from > tiers[i - 1]!.from)) throw new RangeError('tier thresholds must increase');
}

/** Effective rate (bps) of one component for a metric value. */
export function tierBps(value: number, tiers: readonly Tier[], mode: TierMode): number {
  checkTiers(tiers);
  const v = Math.max(0, value);
  if (mode === 'whole-volume' || v === 0) {
    let bps = tiers[0]!.bps;
    for (const t of tiers) if (v >= t.from) bps = t.bps;
    return bps;
  }
  let weighted = 0;
  for (let i = 0; i < tiers.length; i++) {
    const lo = tiers[i]!.from;
    const hi = i + 1 < tiers.length ? tiers[i + 1]!.from : Number.POSITIVE_INFINITY;
    if (v <= lo) break;
    weighted += (Math.min(v, hi) - lo) * tiers[i]!.bps;
  }
  return weighted / v;
}

export interface ShareResult {
  readonly policyId: string;
  /** Per-component rates before floor/cap. */
  readonly components: Readonly<Record<string, number>>;
  /** Final rate after floor and cap (bps, may be fractional for progressive tiers). */
  readonly bps: number;
}

export function computeShare(policy: SharePolicy, metrics: Metrics): ShareResult {
  const components: Record<string, number> = {};
  let sum = 0;
  for (const c of policy.components) {
    const b = tierBps(metrics[c.metric] ?? 0, c.tiers, c.mode);
    components[c.name] = b;
    sum += b;
  }
  return { policyId: policy.id, components, bps: Math.min(policy.capBps, Math.max(policy.floorBps, sum)) };
}

/**
 * The largest total share of GGR (all external parties together) PreFlop can pay
 * and still keep `netTarget` per unit staked, given the realised gross edge:
 *   edge · (1 − s − b) − c_t ≥ T   ⇒   s ≤ 1 − b − (T + c_t) / edge
 */
export function maxAffordableShare(grossEdge: number, promotionsShare: number, turnoverCostRate: number, netTarget: number): number {
  if (grossEdge <= 0) return 0;
  return Math.max(0, 1 - promotionsShare - (netTarget + turnoverCostRate) / grossEdge);
}

export interface PartyShareInput {
  readonly party: string;
  readonly policy: SharePolicy;
  readonly metrics: Metrics;
}

export interface StatementInput {
  /** Revenue base for the period in minor units (house GGR or rake). Negative GGR pays no shares. */
  readonly revenueMinor: number;
  /** Turnover for the period, used for the profit guardrail. */
  readonly turnoverMinor: number;
  readonly parties: readonly PartyShareInput[];
  /** Guardrail inputs. Omit to skip the cap (e.g. for rake, where costs are covered by the fee floor). */
  readonly guardrail?: { readonly promotionsShare: number; readonly turnoverCostRate: number; readonly netTarget: number };
  /** Negative GGR carried from earlier periods, netted before shares are paid. */
  readonly carriedLossMinor?: number;
}

export interface Statement {
  readonly rates: Readonly<Record<string, number>>;
  /** Total external share actually applied (fraction of revenue). */
  readonly appliedShare: number;
  /** True when the guardrail scaled the shares down. */
  readonly capped: boolean;
  readonly amounts: Map<string, number>;
  readonly preflopMinor: number;
  /** Loss to carry into the next period (house lost money overall). */
  readonly carryForwardMinor: number;
}

/**
 * Period statement. Every unit of revenue is allocated exactly once
 * (largest remainder), PreFlop receives the remainder after external shares.
 */
export function computeStatement(input: StatementInput): Statement {
  const shareable = input.revenueMinor - (input.carriedLossMinor ?? 0);
  const rates: Record<string, number> = {};
  let total = 0;
  for (const p of input.parties) {
    const r = computeShare(p.policy, p.metrics).bps / 10000;
    rates[p.party] = r;
    total += r;
  }
  let scale = 1;
  if (input.guardrail && input.turnoverMinor > 0 && input.revenueMinor > 0) {
    const g = input.guardrail;
    const max = maxAffordableShare(input.revenueMinor / input.turnoverMinor, g.promotionsShare, g.turnoverCostRate, g.netTarget);
    if (total > max) scale = max / total;
  }
  const applied = total * scale;
  if (shareable <= 0) {
    const zero = new Map(input.parties.map((p) => [p.party, 0]));
    return { rates, appliedShare: applied, capped: scale < 1, amounts: zero, preflopMinor: shareable, carryForwardMinor: -shareable };
  }
  // Integer weights in millionths keep the split exact.
  const weights = new Map<string, number>(input.parties.map((p) => [p.party, Math.round(rates[p.party]! * scale * 1e6)]));
  const externalTotal = weights.size ? [...weights.values()].reduce((a, b) => a + b, 0) : 0;
  weights.set('PreFlop', 1e6 - externalTotal);
  const amounts = allocateLargestRemainder(shareable, weights);
  const preflopMinor = amounts.get('PreFlop')!;
  amounts.delete('PreFlop');
  return { rates, appliedShare: applied, capped: scale < 1, amounts, preflopMinor, carryForwardMinor: 0 };
}

// ---------- Placeholder policies (planning assumptions, not agreed terms) ----------

/** Provider club: content share grows with hands dealt; distribution share with players it brings. */
export const CLUB_POLICY: SharePolicy = {
  id: 'club',
  description: 'Poker club — content (hands dealt at its tables) + distribution (its own active players)',
  base: 'ggr',
  components: [
    { name: 'content', metric: 'handsDealt', mode: 'progressive', tiers: [
      { from: 0, bps: 500 }, { from: 10_000, bps: 800 }, { from: 30_000, bps: 1000 }, { from: 60_000, bps: 1200 },
    ] },
    { name: 'distribution', metric: 'activePlayers', mode: 'whole-volume', tiers: [
      { from: 0, bps: 0 }, { from: 25, bps: 1000 }, { from: 100, bps: 1500 }, { from: 500, bps: 2000 }, { from: 2000, bps: 2500 },
    ] },
  ],
  floorBps: 500,
  capBps: 3500,
};

/** Provider-only club (players come from someone else): content component only. */
export const PROVIDER_POLICY: SharePolicy = {
  id: 'provider',
  description: 'Poker club supplying flops for players brought by others — content share only',
  base: 'ggr',
  components: [CLUB_POLICY.components[0]!],
  floorBps: 500,
  capBps: 1200,
};

/** Betting company: share grows progressively with the turnover its traffic generates. */
export const PARTNER_POLICY: SharePolicy = {
  id: 'partner',
  description: 'Betting company — distribution share, progressive by monthly turnover (EUR cents)',
  base: 'ggr',
  components: [
    { name: 'distribution', metric: 'turnoverMinor', mode: 'progressive', tiers: [
      { from: 0, bps: 2000 }, { from: 100_000_000, bps: 2500 }, { from: 500_000_000, bps: 3000 }, { from: 2_000_000_000, bps: 3500 },
    ] },
  ],
  floorBps: 2000,
  capBps: 4000,
};

/** Anyone who creates prize pools / contests in the app earns part of their rake, more for more pools. */
export const POOL_CREATOR_POLICY: SharePolicy = {
  id: 'pool-creator',
  description: 'Creator of prize pools / contests (partner, club or user) — share of rake by pools created',
  base: 'rake',
  components: [
    { name: 'creator', metric: 'poolsCreated', mode: 'whole-volume', tiers: [
      { from: 0, bps: 3000 }, { from: 50, bps: 3500 }, { from: 500, bps: 4000 }, { from: 5000, bps: 4500 },
    ] },
  ],
  floorBps: 3000,
  capBps: 4500,
};
