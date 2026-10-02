import type { ChannelCosts, CostModel } from './costModel.ts';

/**
 * Net expected value ("EV") model. Per unit staked on a fixed-odds selection:
 *
 *   gross edge g      = 1 − p · odds                 (the house's GGR per unit staked)
 *   net house EV      = g · (1 − s − b) − c_t
 *
 * where s = revenue shares paid away, b = promotions (both fractions of GGR) and
 * c_t = costs that scale with turnover. The gross margin needed to clear a net
 * target is therefore  m = (target + c_t) / (1 − s − b).
 */

/** Share of GGR that does not stay with PreFlop (revenue shares + promotions). */
export function paidAwayShare(ch: ChannelCosts): number {
  return Object.values(ch.revenueShares).reduce((a, b) => a + b, 0) + ch.promotionsShareOfGGR;
}

/** Variable costs per unit of turnover (c_t). */
export function turnoverCostRate(ch: ChannelCosts): number {
  return ch.paymentFeeOnDeposits * ch.depositsPerUnitTurnover + ch.kycAndChargebacksPerTurnover + ch.variableOpsPerTurnover;
}

/** Gross margin (or contest fee rate) needed so PreFlop keeps `netTarget` per unit staked. */
export function requiredGrossMargin(ch: ChannelCosts, netTarget: number): number {
  const keep = 1 - paidAwayShare(ch);
  if (keep <= 0) return Number.POSITIVE_INFINITY;
  return (netTarget + turnoverCostRate(ch)) / keep;
}

/** PreFlop's net expected value per unit staked, given the gross edge actually offered. */
export function netEdge(grossEdge: number, ch: ChannelCosts): number {
  return grossEdge * (1 - paidAwayShare(ch)) - turnoverCostRate(ch);
}

/**
 * Monthly turnover needed to cover fixed costs after subscription income,
 * at the given net margin per unit staked.
 */
export function breakEvenMonthlyTurnover(model: CostModel, netMarginPerTurnover = model.netTargetMargin): number {
  const fixed = Object.values(model.fixedMonthlyCostsEUR).reduce((a, b) => a + b, 0);
  const subs = model.clubSubscription.pricePerMonthEUR * model.clubSubscription.payingClubs;
  return Math.max(0, fixed - subs) / netMarginPerTurnover;
}

export function totalFixedMonthlyCosts(model: CostModel): number {
  return Object.values(model.fixedMonthlyCostsEUR).reduce((a, b) => a + b, 0);
}
