/**
 * Prize-pool and fee accounting in integer minor units (business plan section 5):
 *
 *   P = B − F            net prize pool = buy-ins − fee
 *   Σ shares of F = F    every fee unit is allocated exactly once
 *
 * Rounding uses the largest-remainder method, so allocations always sum exactly.
 */

export interface RoleShare {
  /** e.g. 'preflop', 'provider', 'organizer', 'partner'. */
  readonly role: string;
  /** Legal party receiving the money (a club can hold several roles). */
  readonly party: string;
  /** Share of the fee in basis points; all roles together must total 10,000. */
  readonly bps: number;
}

/**
 * Merges roles held by the same party (e.g. a club that is both provider and
 * organizer, Model A / D) so the fee is never deducted or paid twice.
 */
export function mergeRoles(roles: readonly RoleShare[]): Map<string, number> {
  const total = roles.reduce((a, r) => a + r.bps, 0);
  if (total !== 10000) throw new RangeError(`fee shares must total 10000 bps, got ${total}`);
  const out = new Map<string, number>();
  for (const r of roles) {
    if (!Number.isInteger(r.bps) || r.bps < 0) throw new RangeError(`invalid share for ${r.role}`);
    out.set(r.party, (out.get(r.party) ?? 0) + r.bps);
  }
  return out;
}

/** Splits an integer amount by integer weights; the result sums exactly to `amount`. */
export function allocateLargestRemainder<K>(amount: number, weights: ReadonlyMap<K, number>): Map<K, number> {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('amount must be a non-negative integer');
  for (const w of weights.values()) if (!Number.isSafeInteger(w) || w < 0) throw new RangeError(`weights must be non-negative safe integers, got ${w}`);
  const totalW = [...weights.values()].reduce((a, b) => a + b, 0);
  const out = new Map<K, number>();
  if (totalW === 0) {
    if (amount !== 0) throw new RangeError('cannot allocate a positive amount with zero weights');
    for (const k of weights.keys()) out.set(k, 0);
    return out;
  }
  const big = BigInt(amount);
  const rows = [...weights.entries()].map(([k, w], i) => {
    const num = big * BigInt(w);
    return { k, i, base: num / BigInt(totalW), rem: num % BigInt(totalW) };
  });
  let left = amount - rows.reduce((a, r) => a + Number(r.base), 0);
  // Biggest remainder first; ties broken by insertion order for determinism.
  const order = [...rows].sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  for (const r of rows) out.set(r.k, Number(r.base));
  for (const r of order) {
    if (left === 0) break;
    out.set(r.k, out.get(r.k)! + 1);
    left--;
  }
  return out;
}

function assertMinorAmount(v: number, what: string): void {
  if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`${what} must be a non-negative safe integer, got ${v}`);
}

/** A fee is a fraction of the pool: 0 ≤ feeBps ≤ 10,000 (never more than the whole pool). */
function assertFeeBps(feeBps: number): void {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) throw new RangeError(`fee must be an integer between 0 and 10000 bps, got ${feeBps}`);
}

export interface PoolBreakdown {
  readonly buyInsMinor: number;
  readonly feeMinor: number;
  readonly netPrizePoolMinor: number;
  readonly feeByParty: Map<string, number>;
}

/** Applies a percentage fee (basis points of buy-ins) and allocates it by role. */
export function poolBreakdown(buyInsMinor: number, feeBps: number, roles: readonly RoleShare[]): PoolBreakdown {
  assertMinorAmount(buyInsMinor, 'buy-ins');
  assertFeeBps(feeBps);
  const feeMinor = Number((BigInt(buyInsMinor) * BigInt(feeBps)) / 10000n);
  const feeByParty = allocateLargestRemainder(feeMinor, mergeRoles(roles));
  return { buyInsMinor, feeMinor, netPrizePoolMinor: buyInsMinor - feeMinor, feeByParty };
}

export interface PoolBet {
  readonly betId: string;
  readonly selectionId: string;
  readonly stakeMinor: number;
}

export interface ParimutuelResult {
  readonly feeMinor: number;
  readonly payouts: Map<string, number>;
  /** True when nobody backed the winning outcome: every stake is refunded and no fee is taken. */
  readonly refunded: boolean;
}

/**
 * Parimutuel (pool) betting — players bet against each other, the house only
 * takes the fee, so it carries no risk. Winners share P = B − F in proportion
 * to their stakes.
 */
export function settleParimutuel(bets: readonly PoolBet[], winningSelectionIds: ReadonlySet<string>, feeBps: number): ParimutuelResult {
  assertFeeBps(feeBps);
  const ids = new Set<string>();
  let total = 0;
  for (const b of bets) {
    if (ids.has(b.betId)) throw new RangeError(`duplicate bet id ${b.betId}`);
    ids.add(b.betId);
    assertMinorAmount(b.stakeMinor, 'stake');
    total += b.stakeMinor;
    if (!Number.isSafeInteger(total)) throw new RangeError('pool total exceeds the safe integer range');
  }
  const winners = bets.filter((b) => winningSelectionIds.has(b.selectionId));
  if (winners.length === 0) {
    return { feeMinor: 0, payouts: new Map(bets.map((b) => [b.betId, b.stakeMinor])), refunded: true };
  }
  const feeMinor = Number((BigInt(total) * BigInt(feeBps)) / 10000n);
  const shares = allocateLargestRemainder(total - feeMinor, new Map(winners.map((b) => [b.betId, b.stakeMinor])));
  const payouts = new Map(bets.map((b) => [b.betId, shares.get(b.betId) ?? 0]));
  return { feeMinor, payouts, refunded: false };
}
