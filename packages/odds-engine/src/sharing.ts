import { allocateLargestRemainder } from './fees.ts';
import { GLOBAL_RULES } from './globalRules.ts';
import { MODES } from './modes.ts';

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
  /** True when the guardrail (or the 100% ceiling) scaled the shares down. */
  readonly capped: boolean;
  /**
   * With a guardrail: how far PreFlop's net result falls short of its target even after
   * capping (minor units, 0 when the target is met). A positive value means the period's
   * economics are unfunded — external shares were cut to zero and it still wasn't enough.
   */
  readonly shortfallMinor: number;
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
  for (const [v, what] of [[input.revenueMinor, 'revenueMinor'], [input.turnoverMinor, 'turnoverMinor'], [input.carriedLossMinor ?? 0, 'carriedLossMinor']] as const)
    if (!Number.isSafeInteger(v)) throw new RangeError(`${what} must be a safe integer, got ${v}`);
  if (input.turnoverMinor < 0 || (input.carriedLossMinor ?? 0) < 0) throw new RangeError('turnover and carried loss must be non-negative');
  // One entry per party. A party holding several roles (e.g. provider + distributor) must be
  // expressed as ONE policy with several components, so no entitlement is silently dropped.
  const seen = new Set<string>();
  for (const p of input.parties) {
    if (p.party === 'PreFlop') throw new RangeError("'PreFlop' is reserved for PreFlop's own remainder");
    if (!p.party) throw new RangeError('party id must be non-empty');
    if (seen.has(p.party)) throw new RangeError(`duplicate party '${p.party}': combine its roles into one policy (multiple components)`);
    seen.add(p.party);
  }
  const shareable = input.revenueMinor - (input.carriedLossMinor ?? 0);
  const rates: Record<string, number> = {};
  let total = 0;
  for (const p of input.parties) {
    const r = computeShare(p.policy, p.metrics).bps / 10000;
    rates[p.party] = r;
    total += r;
  }
  // Never allocate more than 100% of revenue, guardrail or not.
  let scale = total > 1 ? 1 / total : 1;
  let shortfallMinor = 0;
  if (input.guardrail && input.turnoverMinor > 0 && input.revenueMinor > 0) {
    const g = input.guardrail;
    const max = maxAffordableShare(input.revenueMinor / input.turnoverMinor, g.promotionsShare, g.turnoverCostRate, g.netTarget);
    if (total * scale > max) scale = total > 0 ? max / total : 1;
    const netAtZeroShare = input.revenueMinor * (1 - g.promotionsShare) - input.turnoverMinor * g.turnoverCostRate;
    shortfallMinor = Math.max(0, Math.ceil(input.turnoverMinor * g.netTarget - netAtZeroShare));
  }
  const applied = total * scale;
  if (shareable <= 0) {
    const zero = new Map(input.parties.map((p) => [p.party, 0]));
    return { rates, appliedShare: applied, capped: scale < 1, shortfallMinor, amounts: zero, preflopMinor: shareable, carryForwardMinor: -shareable };
  }
  // Integer weights in millionths keep the split exact.
  const weights = new Map<string, number>(input.parties.map((p) => [p.party, Math.round(rates[p.party]! * scale * 1e6)]));
  const externalTotal = weights.size ? [...weights.values()].reduce((a, b) => a + b, 0) : 0;
  weights.set('PreFlop', Math.max(0, 1e6 - externalTotal));
  const amounts = allocateLargestRemainder(shareable, weights);
  const preflopMinor = amounts.get('PreFlop')!;
  amounts.delete('PreFlop');
  return { rates, appliedShare: applied, capped: scale < 1, shortfallMinor, amounts, preflopMinor, carryForwardMinor: 0 };
}

// ---------- Tier metrics in one unit (EUR cents) ----------

/**
 * POLICY ASSUMPTION, not a market rate: for TIER THRESHOLDS ONLY, one USDT and one USDC count
 * as one euro. Tier ladders (e.g. PARTNER_POLICY) are written in EUR cents; turnover in any
 * other currency is converted with this table before it is compared with a threshold.
 * Settlement amounts are never converted: a USDT statement pays USDT.
 * Change it here (and in docs/09 §1) if the commercial team adopts a different rule.
 */
export const STABLECOIN_EUR_RATE = 1;

/** EUR per ONE MAJOR unit of each currency that counts towards turnover tiers. */
export const TIER_EUR_PER_MAJOR: Readonly<Record<string, number>> = Object.freeze({
  EUR: 1,
  USDT: STABLECOIN_EUR_RATE,
  USDC: STABLECOIN_EUR_RATE,
  // Virtual chips are sold at a fixed list price (globalRules.ts).
  CHIP: 1 / GLOBAL_RULES.virtualChips.chipsPerEuro,
});

/** Decimal places of a currency's minor unit, from the play modes (EUR 2, USDT/USDC 6, CHIP 0). */
export function currencyMinorDigits(currency: string): number {
  for (const m of Object.values(MODES)) if (m.currencies.includes(currency)) return m.minorDigits;
  throw new RangeError(`unknown currency '${currency}'`);
}

/**
 * A turnover amount (minor units of `currency`) expressed in EUR cents, the unit every
 * turnover tier ladder uses. Rounded down to a whole cent. Currencies without a EUR value
 * (play money, diamonds) count as 0, i.e. they never lift a party above its first tier.
 */
export function tierTurnoverEurCents(currency: string, minor: number): number {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError(`turnover must be a non-negative safe integer, got ${minor}`);
  const rate = TIER_EUR_PER_MAJOR[currency];
  if (rate === undefined) return 0;
  const digits = currencyMinorDigits(currency);
  // Exact integer scaling to whole cents first (BigInt), then the policy rate.
  const cents = digits >= 2 ? Number(BigInt(minor) / 10n ** BigInt(digits - 2)) : minor * 10 ** (2 - digits);
  return Math.floor(cents * rate + 1e-9);
}

// ---------- Joint statements: every entitlement on the same GGR under one cap ----------

/**
 * A revenue bucket: the PreFlop-house GGR and turnover of one slice of traffic, e.g.
 * "direct players at club X's tables" or "partner P's players at club X's tables".
 * Each bucket carries the costs PreFlop bears on that traffic (its channel in costModel.ts).
 */
export interface RevenueCell {
  readonly id: string;
  /** GGR in minor units; may be negative. */
  readonly revenueMinor: number;
  readonly turnoverMinor: number;
  /** Promotions PreFlop funds, as a fraction of positive GGR. */
  readonly promotionsShare: number;
  /** Variable cost per unit staked (payments, KYC, streaming). */
  readonly turnoverCostRate: number;
}

/** One party's claim under one policy, on the GGR of the buckets it is entitled to. */
export interface Entitlement {
  readonly party: string;
  readonly policy: SharePolicy;
  readonly metrics: Metrics;
  readonly cells: readonly string[];
  /** Loss carried in for this (party, policy), netted before any share is paid. */
  readonly carriedLossMinor?: number;
}

export interface JointStatementInput {
  readonly cells: readonly RevenueCell[];
  readonly entitlements: readonly Entitlement[];
  /** PreFlop's net-margin floor per unit staked. */
  readonly netTarget: number;
}

export interface EntitlementResult {
  readonly party: string;
  readonly policyId: string;
  /** Rate from the tier ladders, before the joint cap (bps). */
  readonly rateBps: number;
  /** Σ GGR of the entitlement's buckets this period. */
  readonly baseMinor: number;
  readonly carriedLossMinor: number;
  /** base − carried loss; no share is paid unless it is positive. */
  readonly shareableMinor: number;
  /** rate × shareable, before the cap (may be fractional). */
  readonly nominalMinor: number;
  /** What is paid, after the joint cap. */
  readonly amountMinor: number;
  /** Loss carried into the next period for this (party, policy). */
  readonly carryForwardMinor: number;
  /** Index into `pools`, or -1 for an entitlement with no buckets. */
  readonly pool: number;
  readonly capped: boolean;
}

export interface PoolResult {
  readonly pool: number;
  readonly cells: readonly string[];
  readonly revenueMinor: number;
  readonly turnoverMinor: number;
  /** Most PreFlop can pay out of this pool and still keep netTarget per unit staked (≥ 0). */
  readonly budgetMinor: number;
  readonly nominalMinor: number;
  readonly paidMinor: number;
  readonly capped: boolean;
  /** How far PreFlop's net falls short of the floor even at zero shares (0 when funded). */
  readonly shortfallMinor: number;
  /** GGR − shares paid (before PreFlop's own costs). */
  readonly preflopMinor: number;
}

export interface JointStatement {
  readonly entitlements: readonly EntitlementResult[];
  readonly pools: readonly PoolResult[];
}

/**
 * Computes every entitlement of a period TOGETHER. Buckets that share a claimant (a club's
 * direct traffic and the partner traffic at its tables, a partner's traffic across clubs) form
 * one pool (connected components: a party links every bucket it claims from, under any policy); all entitlements in a pool are scaled down by one factor so that
 *
 *   Σ shares ≤ Σ_cells [ GGR − b·max(GGR, 0) − c_t·turnover ] − T·Σ turnover
 *
 * i.e. PreFlop's net after shares and costs never falls below the floor T for the pool,
 * however many parties are paid out of the same GGR. Losing buckets reduce the budget of their
 * pool (adjustments are netted), and each (party, policy) nets its own carried loss first.
 * Amounts are rounded down, so the floor holds to the unit.
 */
export function computeJointStatement(input: JointStatementInput): JointStatement {
  const cells = new Map<string, RevenueCell>();
  for (const c of input.cells) {
    if (cells.has(c.id)) throw new RangeError(`duplicate cell '${c.id}'`);
    if (!Number.isSafeInteger(c.revenueMinor) || !Number.isSafeInteger(c.turnoverMinor) || c.turnoverMinor < 0)
      throw new RangeError(`cell '${c.id}': revenue and turnover must be safe integers, turnover non-negative`);
    cells.set(c.id, c);
  }
  const seen = new Set<string>();
  for (const e of input.entitlements) {
    if (e.party === 'PreFlop' || !e.party) throw new RangeError(`invalid party '${e.party}'`);
    const key = `${e.party}\u0000${e.policy.id}`;
    if (seen.has(key)) throw new RangeError(`duplicate entitlement '${e.party}' / '${e.policy.id}'`);
    seen.add(key);
    const carried = e.carriedLossMinor ?? 0;
    if (!Number.isSafeInteger(carried) || carried < 0) throw new RangeError('carried loss must be a non-negative safe integer');
    for (const id of e.cells) if (!cells.has(id)) throw new RangeError(`entitlement '${e.party}' names unknown cell '${id}'`);
  }

  // Pools: connected components of cells linked by a shared entitlement (union-find).
  const parent = new Map<string, string>([...cells.keys()].map((k) => [k, k]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  // Every bucket a party claims from (under any of its policies) joins that party's pool.
  const anchor = new Map<string, string>();
  for (const e of input.entitlements) for (const id of e.cells) {
    const first = anchor.get(e.party);
    if (first === undefined) { anchor.set(e.party, id); continue; }
    const a = find(first), b = find(id);
    if (a !== b) parent.set(b, a);
  }
  const poolOf = new Map<string, number>();
  const poolCells: string[][] = [];
  for (const id of cells.keys()) {
    const root = find(id);
    if (!poolOf.has(root)) { poolOf.set(root, poolCells.length); poolCells.push([]); }
    poolCells[poolOf.get(root)!]!.push(id);
  }

  const pre = input.entitlements.map((e) => {
    const rateBps = computeShare(e.policy, e.metrics).bps;
    const baseMinor = e.cells.reduce((a, id) => a + cells.get(id)!.revenueMinor, 0);
    const carriedLossMinor = e.carriedLossMinor ?? 0;
    const shareableMinor = baseMinor - carriedLossMinor;
    const nominalMinor = shareableMinor > 0 ? (rateBps * shareableMinor) / 10000 : 0;
    const pool = e.cells.length ? poolOf.get(find(e.cells[0]!))! : -1;
    return { e, rateBps, baseMinor, carriedLossMinor, shareableMinor, nominalMinor, pool, carryForwardMinor: shareableMinor < 0 ? -shareableMinor : 0 };
  });

  const amounts = new Array<number>(pre.length).fill(0);
  const pools: PoolResult[] = poolCells.map((ids, pool) => {
    let revenueMinor = 0, turnoverMinor = 0, atZero = 0;
    for (const id of ids) {
      const c = cells.get(id)!;
      revenueMinor += c.revenueMinor;
      turnoverMinor += c.turnoverMinor;
      atZero += c.revenueMinor - c.promotionsShare * Math.max(0, c.revenueMinor) - c.turnoverCostRate * c.turnoverMinor;
    }
    const headroom = atZero - input.netTarget * turnoverMinor;
    // Rounded down (never up), so the floor holds even with floating-point noise.
    const budgetMinor = Math.max(0, Math.floor(headroom));
    const members = pre.map((p, i) => ({ p, i })).filter((x) => x.p.pool === pool);
    const nominalMinor = members.reduce((a, x) => a + x.p.nominalMinor, 0);
    const capped = nominalMinor > budgetMinor;
    const scale = capped ? budgetMinor / nominalMinor : 1;
    let paid = 0;
    for (const { p, i } of members) {
      amounts[i] = Math.max(0, Math.floor(p.nominalMinor * scale + 1e-6));
      paid += amounts[i]!;
    }
    // Rounding must never take the pool above its budget: trim any excess unit from the largest amounts.
    for (const { i } of [...members].sort((a, b) => amounts[b.i]! - amounts[a.i]! || a.i - b.i)) {
      if (paid <= budgetMinor) break;
      const cut = Math.min(amounts[i]!, paid - budgetMinor);
      amounts[i] = amounts[i]! - cut;
      paid -= cut;
    }
    return {
      pool, cells: ids, revenueMinor, turnoverMinor, budgetMinor, nominalMinor, paidMinor: paid, capped,
      shortfallMinor: Math.max(0, Math.ceil(-headroom - 1e-6)), preflopMinor: revenueMinor - paid,
    };
  });

  return {
    pools,
    entitlements: pre.map((p, i) => ({
      party: p.e.party, policyId: p.e.policy.id, rateBps: p.rateBps, baseMinor: p.baseMinor, carriedLossMinor: p.carriedLossMinor,
      shareableMinor: p.shareableMinor, nominalMinor: p.nominalMinor, amountMinor: amounts[i]!, carryForwardMinor: p.carryForwardMinor,
      pool: p.pool, capped: p.pool >= 0 && pools[p.pool]!.capped,
    })),
  };
}

/**
 * Closing carry of one (party, policy) after a run of periods, oldest first:
 * each period nets its GGR against the loss carried in; a negative result is carried on.
 * Deterministic from the per-period GGR alone, so a rerun or a backdated correction
 * (which changes an earlier period's GGR) always yields the same carry for the same ledger.
 */
export function carryForward(periodRevenuesMinor: readonly number[], openingCarryMinor = 0): number {
  let carry = openingCarryMinor;
  for (const r of periodRevenuesMinor) {
    const shareable = r - carry;
    carry = shareable < 0 ? -shareable : 0;
  }
  return carry;
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
