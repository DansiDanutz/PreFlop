import type { Channel, ChannelCosts } from './costModel.ts';
import { DEFAULT_COST_MODEL } from './costModel.ts';
import { type DiamondRules, dilution, quoteDiamonds, splitDiamondBet, type DilutionReport } from './diamonds.ts';
import { type RoleShare, poolBreakdown } from './fees.ts';
import { FLOP_COUNT } from './flops.ts';
import { GLOBAL_RULES } from './globalRules.ts';
import { type PlatformFee, platformFeeMinor, validateOrganizerHouse } from './houses.ts';
import { getSelection } from './markets.ts';
import type { HouseKind, PlayMode } from './modes.ts';
import { oddsForMargin, price, tierFor } from './pricing.ts';
import { statsFor } from './probability.ts';
import { type Metrics, type SharePolicy, computeStatement } from './sharing.ts';
import { turnoverCostRate } from './economics.ts';

/**
 * Monthly profit-and-loss for every participant of a scenario: PreFlop, provider
 * club(s), organizer / partner and the players. All money in EUR (or the mode's
 * unit converted to EUR). Expected values — real months vary with luck.
 */

/** Assumed share of stakes by market for the "typical" bet (first-release markets). */
export const DEFAULT_MARKET_MIX: Readonly<Record<string, number>> = Object.freeze({
  'suit-pattern:rainbow': 0.12, 'suit-pattern:two-tone': 0.1, 'suit-pattern:monotone': 0.05,
  'rank-pattern:pair': 0.12, 'rank-pattern:no-pair': 0.05, 'rank-pattern:trips': 0.03,
  'colour:all-red': 0.05, 'colour:all-black': 0.05,
  'sum-24:over': 0.1, 'sum-24:under': 0.1, 'sum-24:exactly': 0.03,
  'face-count:0': 0.05, 'face-count:3': 0.02, 'all-below:8': 0.05, 'all-below:T': 0.08,
});

function mixAverage(f: (id: string) => number, mix = DEFAULT_MARKET_MIX): number {
  let w = 0;
  let s = 0;
  for (const [id, weight] of Object.entries(mix)) { s += weight * f(id); w += weight; }
  return s / w;
}

/** Stake-weighted gross edge of PreFlop's book for a channel. */
export function bookEdge(channel: Channel = 'direct', mix = DEFAULT_MARKET_MIX): number {
  return mixAverage((id) => price(statsFor(getSelection(id)), channel).grossEdge, mix);
}

/** Stake-weighted gross edge of an organizer's book at its own margin (tier floors still apply). */
export function organizerBookEdge(marginBps: number, mix = DEFAULT_MARKET_MIX): number {
  return mixAverage((id) => {
    const st = statsFor(getSelection(id));
    const m = Math.max(marginBps, tierFor(st.probability).marginBps);
    return 1 - (oddsForMargin(st.wins, m) * st.wins) / (100 * FLOP_COUNT);
  }, mix);
}

export interface Activity {
  readonly players: number;
  /** Flops dealt per month on the tables these players bet on. */
  readonly flopsPerMonth: number;
  /** Fraction of players betting on any given flop. */
  readonly participation: number;
  /** Bets per participating player per flop. */
  readonly betsPerFlop: number;
  /** Average stake in the mode's unit (EUR, USDT, chips or diamonds). */
  readonly avgStake: number;
}

export const monthlyBets = (a: Activity): number => a.players * a.participation * a.betsPerFlop * a.flopsPerMonth;

export interface PartyDef {
  readonly party: string;
  readonly role: string;
  readonly policy: SharePolicy;
  readonly metrics: Metrics;
}

interface Base {
  readonly id: string;
  readonly title: string;
  readonly story: string;
  readonly mode: PlayMode;
  readonly activity: Activity;
}

export type Scenario =
  | (Base & { readonly kind: 'preflop-house'; readonly channel: Channel; readonly costs: ChannelCosts; readonly parties: readonly PartyDef[] })
  | (Base & {
      readonly kind: 'organizer-house'; readonly organizer: string; readonly provider: string;
      readonly marginBps: number; readonly platformFee: PlatformFee; readonly providerShareBps: number;
      /** Organizer's own variable costs per unit staked (payments, KYC, support). */
      readonly organizerCostRate: number;
    })
  | (Base & {
      readonly kind: 'diamonds'; readonly organizer: string; readonly provider: string;
      readonly rules: DiamondRules; readonly marginBps: number;
      /** What the organizer earns off-platform per player per month (memberships, sponsorship) — EUR. */
      readonly organizerIncomePerPlayerEUR: number;
      /** Months of consumption the organizer keeps in stock (for the dilution report). */
      readonly diamondFloatMonths: number;
    })
  | (Base & { readonly kind: 'pool'; readonly rakeBps: number; readonly roles: readonly RoleShare[]; readonly unitsPerEuro: number; readonly poolsCreated: number })
  | (Base & { readonly kind: 'play'; readonly costPerActivePlayerEUR: number });

export interface PnlLine {
  readonly participant: string;
  readonly role: string;
  /** Expected EUR per month (negative = cost). */
  readonly eur: number;
  readonly note: string;
}

export interface ScenarioResult {
  readonly scenario: Scenario;
  readonly house: HouseKind;
  readonly bets: number;
  /** Turnover in the mode's unit. */
  readonly turnover: number;
  readonly turnoverEUR: number;
  readonly lines: readonly PnlLine[];
  /** Expected cost to all players per month in EUR (negative of their expected result). */
  readonly playersCostEUR: number;
  /** Σ lines must equal playersCostEUR (money only moves between participants). */
  readonly reconciles: boolean;
  readonly checks: readonly { readonly name: string; readonly ok: boolean }[];
  readonly dilution?: DilutionReport;
  readonly extra: Readonly<Record<string, number | string>>;
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)) + 0.01;

function finish(s: Scenario, house: HouseKind, bets: number, turnover: number, turnoverEUR: number, lines: PnlLine[],
  playersCostEUR: number, checks: { name: string; ok: boolean }[], extra: Record<string, number | string> = {}, dil?: DilutionReport): ScenarioResult {
  const sum = lines.reduce((a, l) => a + l.eur, 0);
  return { scenario: s, house, bets, turnover, turnoverEUR, lines, playersCostEUR, reconciles: near(sum, playersCostEUR), checks, extra, ...(dil ? { dilution: dil } : {}) };
}

export function evaluate(s: Scenario): ScenarioResult {
  const bets = monthlyBets(s.activity);
  const turnover = bets * s.activity.avgStake;
  const target = DEFAULT_COST_MODEL.netTargetMargin;

  switch (s.kind) {
    case 'preflop-house': {
      const edge = bookEdge(s.channel);
      const ggr = turnover * edge;
      const ct = turnoverCostRate(s.costs);
      const st = computeStatement({
        revenueMinor: Math.round(ggr * 100), turnoverMinor: Math.round(turnover * 100),
        parties: s.parties.map((p) => ({ party: p.party, policy: p.policy, metrics: p.metrics })),
        guardrail: { promotionsShare: s.costs.promotionsShareOfGGR, turnoverCostRate: ct, netTarget: target },
      });
      const promos = ggr * s.costs.promotionsShareOfGGR;
      const costs = turnover * ct;
      const preflopNet = st.preflopMinor / 100 - promos - costs;
      const lines: PnlLine[] = [
        { participant: 'PreFlop', role: 'House (pays the winnings)', eur: preflopNet, note: `GGR ${eur(ggr)} − shares − promotions − variable costs` },
        ...s.parties.map((p) => ({
          participant: p.party, role: p.role, eur: (st.amounts.get(p.party) ?? 0) / 100,
          note: `${(st.rates[p.party]! * 100).toFixed(2)}% of GGR${st.capped ? ' (capped by guardrail)' : ''}`,
        })),
        { participant: 'Payment / KYC / infra providers', role: 'Variable costs', eur: costs, note: `${(ct * 100).toFixed(2)}% of turnover` },
      ];
      return finish(s, 'preflop', bets, turnover, turnover, lines, ggr - promos, [
        { name: 'PreFlop net ≥ target × turnover', ok: preflopNet >= target * turnover - 1 },
        { name: 'Every partner share ≥ 0', ok: [...st.amounts.values()].every((x) => x >= 0) },
      ], { edge, ggr, promotions: promos, appliedShare: st.appliedShare });
    }

    case 'organizer-house': {
      const edge = organizerBookEdge(s.marginBps);
      const ggr = turnover * edge;
      const feePerBet = platformFeeMinor(s.mode, Math.round(s.activity.avgStake * 100), s.platformFee) / 100;
      const fee = bets * feePerBet;
      const provider = ggr * (s.providerShareBps / 10000);
      const orgCosts = turnover * s.organizerCostRate;
      const preflopCosts = turnover * DEFAULT_COST_MODEL.channels.partner.variableOpsPerTurnover;
      const check = validateOrganizerHouse({ mode: s.mode, marginBps: s.marginBps, platformFee: s.platformFee,
        providerShareBps: s.providerShareBps, typicalStakeMinor: Math.round(s.activity.avgStake * 100) });
      const lines: PnlLine[] = [
        { participant: s.organizer, role: 'House (pays the winnings from its collateral)', eur: ggr - fee - provider - orgCosts,
          note: `GGR ${eur(ggr)} − platform fee − provider share − own costs` },
        { participant: 'PreFlop', role: 'Platform (no risk)', eur: fee - preflopCosts, note: `fee ${eur(feePerBet, 3)} per bet − infra` },
        { participant: s.provider, role: 'Flop provider', eur: provider, note: `${s.providerShareBps / 100}% of organizer GGR` },
        { participant: 'Payment / KYC / infra providers', role: 'Variable costs', eur: orgCosts + preflopCosts, note: 'organizer + PreFlop' },
      ];
      return finish(s, 'organizer', bets, turnover, turnover, lines, ggr, [
        { name: 'Organizer house config valid (has the edge after fees)', ok: check.ok },
        { name: 'Organizer net ≥ 0', ok: lines[0]!.eur >= 0 },
        { name: 'PreFlop net ≥ 0 with zero risk', ok: lines[1]!.eur >= 0 },
      ], { edge, ggr, organizerEvPerUnit: check.organizerEv, platformFeeRate: check.platformFeeRate });
    }

    case 'diamonds': {
      const stake = Math.round(s.activity.avgStake);
      const split = splitDiamondBet(stake, s.rules);
      const edge = organizerBookEdge(s.marginBps);
      const fees = bets * split.preflopFee;
      const orgShareOfRake = (split.rakeByParty.get(s.organizer) ?? 0) / Math.max(1, split.rake);
      const rake = bets * split.rake;
      const rakeToOrganizer = rake * orgShareOfRake;
      const rakeToOthers = rake - rakeToOrganizer;
      const houseNet = bets * split.atRisk * edge;
      const rebuy = fees + rakeToOthers; // diamonds that leave the organizer's economy each month
      const quote = quoteDiamonds(Math.round(rebuy));
      const eurPerDiamond = quote.centsPerHundred / 10000;
      const revenue = fees * eurPerDiamond; // organizer rebuys what PreFlop's fee sinks
      const provider = revenue * (GLOBAL_RULES.diamonds.providerShareOfDiamondRevenueBps / 10000);
      const othersEUR = rakeToOthers * eurPerDiamond;
      const preflopOps = s.activity.players * 0.15;
      const orgIncome = s.activity.players * s.organizerIncomePerPlayerEUR;
      const playersDiamonds = fees + rake + houseNet;
      const lines: PnlLine[] = [
        { participant: s.organizer, role: 'House in diamonds (pays winnings from its diamond collateral)',
          eur: orgIncome - rebuy * eurPerDiamond,
          note: `off-platform income ${eur(orgIncome)} − diamond rebuys ${eur(rebuy * eurPerDiamond)}; rake + house wins (${Math.round(rakeToOrganizer + houseNet).toLocaleString('en-US')} ◆) recirculate to its players` },
        { participant: 'PreFlop', role: 'Diamond seller + platform', eur: revenue - provider - preflopOps, note: `${Math.round(fees).toLocaleString('en-US')} ◆ fees sunk × ${eur(eurPerDiamond, 4)} − provider share − ops` },
        { participant: s.provider, role: 'Flop provider (paid in EUR)', eur: provider, note: `${GLOBAL_RULES.diamonds.providerShareOfDiamondRevenueBps / 100}% of PreFlop diamond revenue` },
        ...(rakeToOthers > 0 ? [{ participant: 'Other rake holders', role: 'Co-hosts / referrers (diamonds)', eur: othersEUR, note: 'predefined rake shares, valued at the diamond price' }] : []),
        { participant: 'Infra providers', role: 'Variable costs', eur: preflopOps, note: '€0.15 per active player' },
      ];
      // Money view: players' "cost" is what the organizer charges them off-platform (orgIncome);
      // that money funds the organizer, which buys diamonds from PreFlop.
      return finish(s, 'organizer', bets, turnover, turnover * eurPerDiamond, lines, orgIncome, [
        { name: 'Fixed fee ≤ 5% of minimum stake', ok: split.preflopFee / s.rules.minStake <= 0.05 + 1e-12 },
        { name: 'Organizer net ≥ 0', ok: lines[0]!.eur >= 0 },
        { name: 'Diamonds conserved per bet', ok: split.preflopFee + split.rake + split.atRisk === split.stake },
      ], { edge, eurPerDiamond, diamondsSunk: fees, diamondsRebuy: rebuy, playersDiamondCost: playersDiamonds, houseNetDiamonds: houseNet },
      dilution({ bought: rebuy * s.diamondFloatMonths, bets, stakes: turnover, preflopFees: fees, rakeToOrganizer, rakeToOthers, houseNet }));
    }

    case 'pool': {
      const unitsToEUR = 1 / s.unitsPerEuro;
      const rake = turnover * (s.rakeBps / 10000);
      const b = poolBreakdown(Math.round(turnover), s.rakeBps, s.roles);
      const totalFee = b.feeMinor || 1;
      const lines: PnlLine[] = [...b.feeByParty.entries()].map(([party, amt]) => ({
        participant: party, role: party === 'PreFlop' ? 'Platform (no risk)' : s.roles.find((r) => r.party === party)!.role,
        eur: (rake * amt) / totalFee * unitsToEUR, note: `${((amt / totalFee) * 100).toFixed(1)}% of rake`,
      }));
      const costs = s.activity.players * 0.15;
      lines.push({ participant: 'Infra providers', role: 'Variable costs', eur: costs, note: '€0.15 per active player (paid by PreFlop)' });
      const pre = lines.find((l) => l.participant === 'PreFlop')!;
      (pre as { eur: number }).eur -= costs;
      return finish(s, 'pool', bets, turnover, turnover * unitsToEUR, lines, rake * unitsToEUR, [
        { name: 'Rake within global bounds', ok: s.rakeBps >= GLOBAL_RULES.poolRakeBpsMin && s.rakeBps <= GLOBAL_RULES.poolRakeBpsMax },
        { name: 'PreFlop net ≥ 0', ok: pre.eur >= 0 },
      ], { rake, poolsCreated: s.poolsCreated });
    }

    case 'play': {
      const cost = s.activity.players * s.costPerActivePlayerEUR;
      const lines: PnlLine[] = [
        { participant: 'PreFlop', role: 'Virtual house (no money at stake)', eur: -cost, note: 'acquisition cost: streaming + infra' },
        { participant: 'Infra providers', role: 'Variable costs', eur: cost, note: `€${s.costPerActivePlayerEUR} per active player` },
      ];
      return finish(s, 'preflop', bets, turnover, 0, lines, 0, [{ name: 'No fees charged in play mode', ok: true }], { costPerPlayer: s.costPerActivePlayerEUR });
    }
  }
}

function eur(x: number, digits = 0): string {
  return `€${x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
