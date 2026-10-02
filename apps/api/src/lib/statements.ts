import {
  CLUB_POLICY, DEFAULT_COST_MODEL, PARTNER_POLICY, type SharePolicy, computeShare, computeStatement, turnoverCostRate,
} from '@preflop/odds-engine';
import type { Db } from './db.ts';

/**
 * Period statements from the bets table using the engine's dynamic sharing (docs/09).
 * Shares are computed per currency; money is in minor units.
 */

export interface StatementLine { label: string; metric?: number; tier?: string; rate_bps?: number; base_minor?: number; amount_minor: number }
export interface StatementView { party: string; period: string; currency: string; lines: StatementLine[]; total_minor: number }

export const currentPeriod = () => new Date().toISOString().slice(0, 7);
const validPeriod = (p?: string) => (p && /^\d{4}-\d{2}$/.test(p) ? p : currentPeriod());

function componentLines(policy: SharePolicy, metrics: Record<string, number>): StatementLine[] {
  const r = computeShare(policy, metrics);
  return policy.components.map((c) => ({ label: `${c.name} (${c.metric}, ${c.mode})`, metric: metrics[c.metric] ?? 0, tier: `${(r.components[c.name]! / 100).toFixed(2)}%`, rate_bps: Math.round(r.components[c.name]!), amount_minor: 0 }));
}

interface Agg { currency: string; ggr: number; turnover: number; players: number }

async function aggregate(db: Db, where: string, params: unknown[]): Promise<Agg[]> {
  return (await db.query<Agg>(
    `select b.currency, coalesce(sum(b.stake_minor - coalesce(b.payout_minor, 0)), 0)::bigint as ggr,
            coalesce(sum(b.stake_minor), 0)::bigint as turnover, count(distinct b.user_id)::int as players
       from bets b join rounds r on r.id = b.round_id
      where b.status in ('won','lost') and b.house_kind = 'preflop' and ${where}
      group by b.currency order by b.currency`, params)).rows.map((a) => ({ ...a, ggr: Number(a.ggr), turnover: Number(a.turnover) }));
}

/** Statement for one organization (club: content + distribution; partner: distribution by turnover; organizer: room P&L). */
export async function orgStatements(db: Db, org: { id: string; kind: string; name: string }, periodIn?: string): Promise<StatementView[]> {
  const period = validPeriod(periodIn);
  const inPeriod = `to_char(b.placed_at, 'YYYY-MM') = $2`;
  const out: StatementView[] = [];
  if (org.kind === 'club') {
    const hands = Number((await db.query<{ n: number }>(`select count(*)::int as n from rounds r where r.state = 'SETTLED' and r.table_id in (select id from poker_tables where club_id = $1) and to_char(r.settled_at, 'YYYY-MM') = $2`, [org.id, period])).rows[0]!.n);
    for (const a of await aggregate(db, `r.table_id in (select id from poker_tables where club_id = $1) and ${inPeriod}`, [org.id, period])) {
      const metrics = { handsDealt: hands, activePlayers: a.players };
      const st = computeStatement({ revenueMinor: a.ggr, turnoverMinor: a.turnover, parties: [{ party: org.id, policy: CLUB_POLICY, metrics }],
        guardrail: { promotionsShare: DEFAULT_COST_MODEL.channels.club.promotionsShareOfGGR, turnoverCostRate: turnoverCostRate(DEFAULT_COST_MODEL.channels.club), netTarget: DEFAULT_COST_MODEL.netTargetMargin } });
      const amount = st.amounts.get(org.id) ?? 0;
      out.push({ party: org.name, period, currency: a.currency, total_minor: amount, lines: [
        { label: 'House GGR at your tables', base_minor: a.ggr, amount_minor: 0 },
        { label: 'Turnover at your tables', base_minor: a.turnover, amount_minor: 0 },
        ...componentLines(CLUB_POLICY, metrics),
        { label: `Revenue share${st.capped ? ' (capped by the profit guardrail)' : ''}`, rate_bps: Math.round((st.rates[org.id] ?? 0) * 10000), base_minor: a.ggr, amount_minor: amount },
        ...(st.carryForwardMinor ? [{ label: 'Loss carried forward (no share this period)', amount_minor: -st.carryForwardMinor }] : []),
      ] });
    }
  } else if (org.kind === 'partner') {
    for (const a of await aggregate(db, `b.partner_id = $1 and ${inPeriod}`, [org.id, period])) {
      const metrics = { turnoverMinor: a.turnover };
      const st = computeStatement({ revenueMinor: a.ggr, turnoverMinor: a.turnover, parties: [{ party: org.id, policy: PARTNER_POLICY, metrics }],
        guardrail: { promotionsShare: DEFAULT_COST_MODEL.channels.partner.promotionsShareOfGGR, turnoverCostRate: turnoverCostRate(DEFAULT_COST_MODEL.channels.partner), netTarget: DEFAULT_COST_MODEL.netTargetMargin } });
      const amount = st.amounts.get(org.id) ?? 0;
      out.push({ party: org.name, period, currency: a.currency, total_minor: amount, lines: [
        { label: 'House GGR from your players', base_minor: a.ggr, amount_minor: 0 },
        ...componentLines(PARTNER_POLICY, metrics),
        { label: `Revenue share${st.capped ? ' (capped by the profit guardrail)' : ''}`, rate_bps: Math.round((st.rates[org.id] ?? 0) * 10000), base_minor: a.ggr, amount_minor: amount },
      ] });
    }
  } else {
    const rows = (await db.query<{ currency: string; house: string; stakes: number; at_risk: number; payouts: number; fees: number; bets: number }>(
      `select b.currency, b.house_kind as house, coalesce(sum(b.stake_minor), 0)::bigint as stakes, coalesce(sum(coalesce(b.at_risk_minor, b.stake_minor)), 0)::bigint as at_risk,
              coalesce(sum(coalesce(b.payout_minor, 0)), 0)::bigint as payouts, coalesce(sum(b.fee_minor), 0)::bigint as fees, count(*)::int as bets
         from bets b where b.house_owner = $1 and b.status in ('won','lost') and ${inPeriod} group by 1, 2 order by 1, 2`, [org.id, period])).rows;
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
  }
  return out;
}

/** PreFlop-wide statements: one per club and partner, plus PreFlop's own result per currency. */
export async function platformStatements(db: Db, periodIn?: string): Promise<StatementView[]> {
  const period = validPeriod(periodIn);
  const orgs = (await db.query<{ id: string; kind: string; name: string }>(`select id, kind, name from organizations where kind in ('club','partner','organizer') order by kind, name`)).rows;
  const out: StatementView[] = [];
  for (const o of orgs) out.push(...(await orgStatements(db, o, period)));
  for (const a of await aggregate(db, `to_char(b.placed_at, 'YYYY-MM') = $1`, [period])) {
    const shares = out.filter((s) => s.currency === a.currency && !s.lines.some((l) => l.label === 'Rake kept')).reduce((x, s) => x + s.total_minor, 0);
    out.push({ party: 'PreFlop', period, currency: a.currency, total_minor: a.ggr - shares, lines: [
      { label: 'House GGR (PreFlop house)', base_minor: a.ggr, amount_minor: a.ggr },
      { label: 'Turnover', base_minor: a.turnover, amount_minor: 0 },
      { label: 'Revenue shares owed (clubs, partners)', amount_minor: -shares },
    ] });
  }
  return out;
}
