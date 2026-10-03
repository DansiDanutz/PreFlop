import {
  CLUB_POLICY, DEFAULT_COST_MODEL, type Entitlement, type EntitlementResult, type JointStatement, type Metrics, PARTNER_POLICY,
  PROVIDER_POLICY, type RevenueCell, type SharePolicy, carryForward, computeJointStatement, computeShare, tierTurnoverEurCents, turnoverCostRate,
} from '@preflop/odds-engine';
import type { Db } from './db.ts';

/**
 * Period statements from the bets table using the engine's dynamic sharing (docs/09).
 *
 * PreFlop-house GGR is attributed to revenue buckets, one per (currency, club whose tables dealt
 * the hands, partner that acquired the player or none). A club earns its club policy (content +
 * distribution) on its direct traffic and only the provider policy (content) on partner-acquired
 * traffic at its tables; the partner earns its turnover policy on its own traffic. All
 * entitlements of a period are computed together, so every pool of overlapping buckets is capped
 * once and PreFlop's net-margin floor holds however many parties share the same GGR.
 * Losses are carried forward per (org, currency, policy), rebuilt from earlier periods every time.
 * Money is in minor units of the statement's currency; only tier metrics are normalised (EUR cents).
 */

export interface StatementLine { label: string; metric?: number; tier?: string; rate_bps?: number; base_minor?: number; amount_minor: number }
export interface StatementView { party: string; period: string; currency: string; lines: StatementLine[]; total_minor: number }

export const currentPeriod = () => new Date().toISOString().slice(0, 7);
const validPeriod = (p?: string) => (p && /^\d{4}-\d{2}$/.test(p) ? p : currentPeriod());

function componentLines(policy: SharePolicy, metrics: Metrics): StatementLine[] {
  const r = computeShare(policy, metrics);
  return policy.components.map((c) => ({ label: `${c.name} (${c.metric}, ${c.mode})`, metric: metrics[c.metric] ?? 0, tier: `${(r.components[c.name]! / 100).toFixed(2)}%`, rate_bps: Math.round(r.components[c.name]!), amount_minor: 0 }));
}

// ------------------------------------------------------------------ revenue buckets

interface CellRow { month: string; currency: string; club: string; partner: string | null; ggr: number; turnover: number }

const cellId = (club: string, partner: string | null) => `${club}\u0000${partner ?? ''}`;

const CLUB_COSTS = DEFAULT_COST_MODEL.channels.club;
const PARTNER_COSTS = DEFAULT_COST_MODEL.channels.partner;

/** Per-month PreFlop-house GGR and turnover by (currency, club, partner), up to and including `period`. */
async function cellRows(db: Db, period: string): Promise<CellRow[]> {
  return (await db.query<CellRow>(
    `select to_char(b.placed_at, 'YYYY-MM') as month, b.currency, t.club_id as club, b.partner_id as partner,
            coalesce(sum(b.stake_minor - coalesce(b.payout_minor, 0)), 0)::bigint as ggr, coalesce(sum(b.stake_minor), 0)::bigint as turnover
       from bets b join rounds r on r.id = b.round_id join poker_tables t on t.id = r.table_id
      where b.status in ('won','lost') and b.house_kind = 'preflop' and to_char(b.placed_at, 'YYYY-MM') <= $1
      group by 1, 2, 3, 4 order by 1, 2, 3, 4`, [period])).rows.map((r) => ({ ...r, ggr: Number(r.ggr), turnover: Number(r.turnover) }));
}

const claimKey = (party: string, policyId: string) => `${party}\u0000${policyId}`;

/**
 * Who claims a bucket, under which policy: direct traffic → the club (club policy);
 * partner-acquired traffic → the club whose tables dealt it (provider policy) and the partner.
 */
const claimantsOf = (r: { club: string; partner: string | null }): [string, SharePolicy][] =>
  r.partner === null ? [[r.club, CLUB_POLICY]] : [[r.club, PROVIDER_POLICY], [r.partner, PARTNER_POLICY]];

interface Claim { party: string; policy: SharePolicy; cells: string[]; metrics: Metrics; turnoverMinor: number }

export interface PeriodShares {
  period: string;
  /** One joint statement per currency. */
  byCurrency: Map<string, { cells: RevenueCell[]; claims: Map<string, Claim>; result: JointStatement }>;
}

/**
 * Every entitlement of a period, computed jointly per currency. Deterministic from the bets
 * table: a rerun gives the same result, and a backdated correction to an earlier month flows
 * into this period's carried losses on the next computation.
 */
export async function periodShares(db: Db, periodIn?: string): Promise<PeriodShares> {
  const period = validPeriod(periodIn);
  const rows = await cellRows(db, period);
  const current = rows.filter((r) => r.month === period);
  const history = rows.filter((r) => r.month < period);

  const hands = new Map((await db.query<{ club: string; n: number }>(
    `select t.club_id as club, count(*)::int as n from rounds r join poker_tables t on t.id = r.table_id
      where r.state = 'SETTLED' and to_char(r.settled_at, 'YYYY-MM') = $1 group by 1`, [period])).rows.map((r) => [r.club, Number(r.n)]));
  const directPlayers = new Map((await db.query<{ club: string; currency: string; n: number }>(
    `select t.club_id as club, b.currency, count(distinct b.user_id)::int as n
       from bets b join rounds r on r.id = b.round_id join poker_tables t on t.id = r.table_id
      where b.status in ('won','lost') and b.house_kind = 'preflop' and b.partner_id is null and to_char(b.placed_at, 'YYYY-MM') = $1
      group by 1, 2`, [period])).rows.map((r) => [`${r.club}\u0000${r.currency}`, Number(r.n)]));
  // Partner tiers use the partner's turnover in ALL currencies, normalised to EUR cents (docs/09 §1).
  const partnerTierCents = new Map<string, number>();
  for (const r of current) if (r.partner !== null)
    partnerTierCents.set(r.partner, (partnerTierCents.get(r.partner) ?? 0) + tierTurnoverEurCents(r.currency, r.turnover));

  const byCurrency: PeriodShares['byCurrency'] = new Map();
  for (const currency of [...new Set(current.map((r) => r.currency))].sort()) {
    const cells: RevenueCell[] = [];
    const claims = new Map<string, Claim>();
    for (const r of current) {
      if (r.currency !== currency) continue;
      const id = cellId(r.club, r.partner);
      const costs = r.partner === null ? CLUB_COSTS : PARTNER_COSTS;
      cells.push({ id, revenueMinor: r.ggr, turnoverMinor: r.turnover, promotionsShare: costs.promotionsShareOfGGR, turnoverCostRate: turnoverCostRate(costs) });
      for (const [party, policy] of claimantsOf(r)) {
        const k = claimKey(party, policy.id);
        const metrics: Metrics = policy === CLUB_POLICY ? { handsDealt: hands.get(party) ?? 0, activePlayers: directPlayers.get(`${party}\u0000${currency}`) ?? 0 }
          : policy === PROVIDER_POLICY ? { handsDealt: hands.get(party) ?? 0 } : { turnoverMinor: partnerTierCents.get(party) ?? 0 };
        const c = claims.get(k) ?? { party, policy, cells: [], metrics, turnoverMinor: 0 };
        c.cells.push(id);
        c.turnoverMinor += r.turnover;
        claims.set(k, c);
      }
    }
    // Loss carried in by each (party, policy) in this currency: its GGR month by month before this
    // period, netted in order (a month without traffic leaves the carry unchanged).
    const past = new Map<string, Map<string, number>>();
    for (const r of history) {
      if (r.currency !== currency) continue;
      for (const [party, policy] of claimantsOf(r)) {
        const k = claimKey(party, policy.id);
        const byMonth = past.get(k) ?? new Map<string, number>();
        byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.ggr);
        past.set(k, byMonth);
      }
    }
    const carried = (k: string) => carryForward([...(past.get(k) ?? new Map<string, number>()).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v));
    const entitlements: Entitlement[] = [...claims.entries()].map(([k, c]) => ({ party: c.party, policy: c.policy, metrics: c.metrics, cells: c.cells, carriedLossMinor: carried(k) }));
    byCurrency.set(currency, { cells, claims, result: computeJointStatement({ cells, entitlements, netTarget: DEFAULT_COST_MODEL.netTargetMargin }) });
  }
  return { period, byCurrency };
}

const WORDING: Record<string, { ggr: string; turnover: string; share: string }> = {
  club: { ggr: 'House GGR at your tables: direct players', turnover: 'Turnover at your tables: direct players', share: 'Revenue share: club policy (direct players)' },
  provider: { ggr: 'House GGR at your tables: partner-acquired players', turnover: 'Turnover at your tables: partner-acquired players', share: 'Revenue share: provider policy (partner traffic)' },
  partner: { ggr: 'House GGR from your players', turnover: 'Turnover from your players', share: 'Revenue share' },
};

/** Lines of one entitlement: base, tier components, carried loss in, share paid, loss carried out. Only the share line has an amount. */
function entitlementLines(e: EntitlementResult, c: Claim): StatementLine[] {
  const w = WORDING[e.policyId]!;
  const applied = e.shareableMinor > 0 ? Math.round((e.amountMinor * 10000) / e.shareableMinor) : 0;
  const components = componentLines(c.policy, c.metrics).map((l) =>
    c.policy === PARTNER_POLICY ? { ...l, label: `${l.label}: tier turnover in EUR cents, all currencies (1 USDT = 1 USDC = €1)` } : l);
  return [
    { label: w.ggr, base_minor: e.baseMinor, amount_minor: 0 },
    { label: w.turnover, base_minor: c.turnoverMinor, amount_minor: 0 },
    ...components,
    ...(e.carriedLossMinor ? [{ label: 'Loss carried in from earlier periods (netted first)', base_minor: -e.carriedLossMinor, amount_minor: 0 }] : []),
    { label: `${w.share}${e.capped ? ' (capped by the joint profit guardrail)' : ''}`, rate_bps: applied, base_minor: Math.max(0, e.shareableMinor), amount_minor: e.amountMinor },
    ...(e.carryForwardMinor ? [{ label: 'Loss carried forward (no share this period)', base_minor: -e.carryForwardMinor, amount_minor: 0 }] : []),
  ];
}

function sharingViews(org: { id: string; name: string }, shares: PeriodShares): StatementView[] {
  const out: StatementView[] = [];
  for (const [currency, { claims, result }] of shares.byCurrency) {
    const mine = result.entitlements.filter((e) => e.party === org.id);
    if (!mine.length) continue;
    out.push({
      party: org.name, period: shares.period, currency, total_minor: mine.reduce((a, e) => a + e.amountMinor, 0),
      lines: mine.flatMap((e) => entitlementLines(e, claims.get(claimKey(e.party, e.policyId))!)),
    });
  }
  return out;
}

/** Room P&L of an organizer that is the house (unchanged by sharing). */
async function organizerViews(db: Db, org: { id: string; name: string }, period: string): Promise<StatementView[]> {
  const out: StatementView[] = [];
  const rows = (await db.query<{ currency: string; house: string; stakes: number; at_risk: number; payouts: number; fees: number; bets: number }>(
    `select b.currency, b.house_kind as house, coalesce(sum(b.stake_minor), 0)::bigint as stakes, coalesce(sum(coalesce(b.at_risk_minor, b.stake_minor)), 0)::bigint as at_risk,
            coalesce(sum(coalesce(b.payout_minor, 0)), 0)::bigint as payouts, coalesce(sum(b.fee_minor), 0)::bigint as fees, count(*)::int as bets
       from bets b where b.house_owner = $1 and b.status in ('won','lost') and to_char(b.placed_at, 'YYYY-MM') = $2 group by 1, 2 order by 1, 2`, [org.id, period])).rows;
  for (const r of rows) {
    const stakes = Number(r.stakes), atRisk = Number(r.at_risk), payouts = Number(r.payouts), fees = Number(r.fees);
    const rake = stakes - atRisk - (r.currency === 'DIAMOND' || r.house === 'pool' ? fees : 0);
    const houseNet = r.house === 'organizer' ? atRisk - payouts : 0;
    const feesPaidByHouse = r.house === 'organizer' && r.currency !== 'DIAMOND' ? fees : 0;
    const net = houseNet + rake - feesPaidByHouse;
    out.push({ party: org.name, period, currency: r.currency, total_minor: net, lines: [
      { label: `${r.house === 'pool' ? 'Pool' : 'House'} bets settled`, metric: r.bets, amount_minor: 0 },
      { label: 'Stakes', base_minor: stakes, amount_minor: 0 },
      ...(r.house === 'organizer' ? [{ label: 'House result on at-risk stakes', base_minor: atRisk, amount_minor: houseNet }] : []),
      { label: 'Rake kept', amount_minor: rake },
      r.currency === 'DIAMOND' || r.house === 'pool'
        ? { label: `PreFlop fees paid by players (${fees})`, amount_minor: 0 }
        : { label: 'PreFlop platform fees paid by the house', amount_minor: -fees },
    ] });
  }
  return out;
}

/** Statement for one organization (club: direct + provider shares; partner: distribution by turnover; organizer: room P&L). */
export async function orgStatements(db: Db, org: { id: string; kind: string; name: string }, periodIn?: string): Promise<StatementView[]> {
  const period = validPeriod(periodIn);
  if (org.kind === 'club' || org.kind === 'partner') return sharingViews(org, await periodShares(db, period));
  return organizerViews(db, org, period);
}

/** PreFlop-wide statements: one per club and partner, plus PreFlop's own result per currency. */
export async function platformStatements(db: Db, periodIn?: string): Promise<StatementView[]> {
  const period = validPeriod(periodIn);
  const orgs = (await db.query<{ id: string; kind: string; name: string }>(`select id, kind, name from organizations where kind in ('club','partner','organizer') order by kind, name`)).rows;
  const shares = await periodShares(db, period);
  const out: StatementView[] = [];
  for (const o of orgs) out.push(...(o.kind === 'organizer' ? await organizerViews(db, o, period) : sharingViews(o, shares)));
  for (const [currency, { cells, result }] of shares.byCurrency) {
    const ggr = cells.reduce((a, c) => a + c.revenueMinor, 0);
    const owed = result.entitlements.reduce((a, e) => a + e.amountMinor, 0);
    const capped = result.pools.filter((p) => p.capped).length;
    const shortfall = result.pools.reduce((a, p) => a + p.shortfallMinor, 0);
    out.push({ party: 'PreFlop', period, currency, total_minor: ggr - owed, lines: [
      { label: 'House GGR (PreFlop house)', base_minor: ggr, amount_minor: ggr },
      { label: 'Turnover', base_minor: cells.reduce((a, c) => a + c.turnoverMinor, 0), amount_minor: 0 },
      { label: 'Revenue shares owed (clubs, partners)', amount_minor: -owed },
      ...(capped ? [{ label: 'Revenue pools capped by the joint profit guardrail', metric: capped, amount_minor: 0 }] : []),
      ...(shortfall ? [{ label: 'Below the net-margin floor even with no shares', base_minor: shortfall, amount_minor: 0 }] : []),
    ] });
  }
  return out;
}
