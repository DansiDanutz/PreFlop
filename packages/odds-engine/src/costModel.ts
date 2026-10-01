/**
 * PLACEHOLDER COST MODEL — every number below is an assumption for planning,
 * not an agreed commercial term. Change them here and re-run `pnpm book`;
 * margins, odds and the net-EV columns in docs/odds-book.md follow automatically.
 *
 * All rates are fractions (0.05 = 5%). "GGR" = gross gaming revenue = stakes − payouts
 * (for contests and pools: the deducted fee F).
 */

export type Channel = 'direct' | 'club' | 'partner' | 'contest-user' | 'contest-club';

export interface ChannelCosts {
  readonly label: string;
  /** Business-plan distribution model this channel implements. */
  readonly planModel: string;
  /** Whether bets here are fixed-odds against the house (true) or fee-based contests / pools (false). */
  readonly houseRisk: boolean;
  /** Fractions of GGR (or of the fee) paid to parties other than PreFlop. */
  readonly revenueShares: Readonly<Record<string, number>>;
  /** Bonuses, free bets and promotions funded by PreFlop, as a fraction of GGR. */
  readonly promotionsShareOfGGR: number;
  /** Payment-processor fee charged on deposits (and withdrawals, folded in). */
  readonly paymentFeeOnDeposits: number;
  /** Deposits per unit of turnover: 0.25 means each deposited unit is staked four times on average. */
  readonly depositsPerUnitTurnover: number;
  /** KYC checks, fraud and chargeback losses, amortised over turnover. */
  readonly kycAndChargebacksPerTurnover: number;
  /** Variable streaming, data and infrastructure cost per unit of turnover. */
  readonly variableOpsPerTurnover: number;
}

export interface CostModel {
  /** Minimum NET house expected value per unit staked, after every variable cost. */
  readonly netTargetMargin: number;
  readonly channels: Readonly<Record<Channel, ChannelCosts>>;
  /** Fixed monthly costs in EUR — not priced into odds; used for break-even turnover. */
  readonly fixedMonthlyCostsEUR: Readonly<Record<string, number>>;
  readonly clubSubscription: { readonly pricePerMonthEUR: number; readonly payingClubs: number };
}

export const DEFAULT_COST_MODEL: CostModel = Object.freeze({
  netTargetMargin: 0.025,
  channels: {
    direct: {
      label: 'PreFlop app (direct players)',
      planModel: 'Direct — PreFlop + provider club',
      houseRisk: true,
      revenueShares: { providerClub: 0.2 },
      promotionsShareOfGGR: 0.1,
      paymentFeeOnDeposits: 0.025,
      depositsPerUnitTurnover: 0.25,
      kycAndChargebacksPerTurnover: 0.002,
      variableOpsPerTurnover: 0.003,
    },
    club: {
      label: "Club's own players",
      planModel: 'Model A — club is provider and distributor',
      houseRisk: true,
      revenueShares: { club: 0.5 },
      promotionsShareOfGGR: 0.05,
      paymentFeeOnDeposits: 0.025,
      depositsPerUnitTurnover: 0.25,
      kycAndChargebacksPerTurnover: 0.002,
      variableOpsPerTurnover: 0.003,
    },
    partner: {
      label: 'Third-party betting platform',
      planModel: 'Model B — partner distributes, PreFlop is the house',
      houseRisk: true,
      revenueShares: { providerClub: 0.15, partner: 0.35 },
      promotionsShareOfGGR: 0,
      // Seamless wallet: the partner holds player funds and pays its own payment costs.
      paymentFeeOnDeposits: 0,
      depositsPerUnitTurnover: 0,
      kycAndChargebacksPerTurnover: 0,
      variableOpsPerTurnover: 0.003,
    },
    'contest-user': {
      label: 'User-organized tournament / challenge',
      planModel: 'Model C — organizer gets the largest single share',
      houseRisk: false,
      revenueShares: { organizer: 0.45, providerClub: 0.2 },
      promotionsShareOfGGR: 0,
      paymentFeeOnDeposits: 0.025,
      depositsPerUnitTurnover: 1,
      kycAndChargebacksPerTurnover: 0.002,
      variableOpsPerTurnover: 0.003,
    },
    'contest-club': {
      label: 'Club-organized event',
      planModel: 'Model D — club is organizer and provider (shares combined)',
      houseRisk: false,
      revenueShares: { club: 0.5 },
      promotionsShareOfGGR: 0,
      paymentFeeOnDeposits: 0.025,
      depositsPerUnitTurnover: 1,
      kycAndChargebacksPerTurnover: 0.002,
      variableOpsPerTurnover: 0.003,
    },
  },
  fixedMonthlyCostsEUR: {
    engineeringAndProduct: 45000,
    operationsAndSupport: 15000,
    complianceAndLegal: 8000,
    baseInfrastructureAndStreaming: 5000,
    marketing: 12000,
  },
  clubSubscription: { pricePerMonthEUR: 1500, payingClubs: 10 },
});
