import { type Channel, type CostModel, DEFAULT_COST_MODEL } from './costModel.ts';
import {
  breakEvenMonthlyTurnover, paidAwayShare, requiredGrossMargin, totalFixedMonthlyCosts, turnoverCostRate,
} from './economics.ts';
import { FLOP_COUNT } from './flops.ts';
import { FAMILY_NAMES, MARKETS, type Market } from './markets.ts';
import { type Price, MARGIN_TIERS, MAX_FAIR_ODDS, price } from './pricing.ts';
import { statsFor } from './probability.ts';

export const FIXED_ODDS_CHANNELS: readonly Channel[] = ['direct', 'club', 'partner'];

export interface BookSelection {
  readonly id: string;
  readonly label: string;
  readonly wins: number;
  readonly probability: number;
  readonly fairOdds: number;
  readonly prices: Readonly<Record<string, Price>>;
}

export interface BookMarket {
  readonly id: string;
  readonly family: string;
  readonly name: string;
  readonly description: string;
  readonly catalogueRefs: readonly number[];
  readonly firstRelease: boolean;
  readonly exhaustive: boolean;
  readonly selections: readonly BookSelection[];
}

export interface OddsBook {
  readonly flopCount: number;
  readonly netTargetMargin: number;
  readonly channels: readonly {
    readonly channel: Channel;
    readonly label: string;
    readonly planModel: string;
    readonly houseRisk: boolean;
    readonly paidAwayShare: number;
    readonly turnoverCostRate: number;
    readonly requiredGrossMargin: number;
  }[];
  readonly markets: readonly BookMarket[];
}

function bookMarket(m: Market, model: CostModel): BookMarket {
  return {
    id: m.id, family: m.family, name: m.name, description: m.description,
    catalogueRefs: m.catalogueRefs, firstRelease: m.firstRelease, exhaustive: m.exhaustive,
    selections: m.selections.map((s) => {
      const st = statsFor(s);
      const prices: Record<string, Price> = {};
      for (const ch of FIXED_ODDS_CHANNELS) prices[ch] = price(st, ch, model);
      return { id: s.id, label: s.label, wins: st.wins, probability: st.probability, fairOdds: FLOP_COUNT / Math.max(1, st.wins), prices };
    }),
  };
}

export function buildBook(model: CostModel = DEFAULT_COST_MODEL): OddsBook {
  return {
    flopCount: FLOP_COUNT,
    netTargetMargin: model.netTargetMargin,
    channels: (Object.keys(model.channels) as Channel[]).map((channel) => {
      const ch = model.channels[channel];
      return {
        channel, label: ch.label, planModel: ch.planModel, houseRisk: ch.houseRisk,
        paidAwayShare: paidAwayShare(ch), turnoverCostRate: turnoverCostRate(ch),
        requiredGrossMargin: requiredGrossMargin(ch, model.netTargetMargin),
      };
    }),
    markets: MARKETS.map((m) => bookMarket(m, model)),
  };
}

// ---------- Markdown rendering (deterministic: no timestamps) ----------

const pct = (x: number, d = 2): string => `${(x * 100).toFixed(d)}%`;
const odds = (p: Price): string => (p.offered ? p.odds.toFixed(2) : '—');
const fair = (x: number): string => (x >= 100 ? x.toFixed(0) : x.toFixed(2));
const eur = (x: number): string => `€${Math.round(x).toLocaleString('en-US')}`;

export function renderBookMarkdown(book: OddsBook, model: CostModel = DEFAULT_COST_MODEL): string {
  const L: string[] = [];
  L.push('# PreFlop Odds Book');
  L.push('');
  L.push('> **Generated file — do not edit by hand.** Run `pnpm book` after changing markets or');
  L.push('> `packages/odds-engine/src/costModel.ts`. Cost figures are planning placeholders, not agreed terms.');
  L.push('');
  L.push(`Every probability is exact: each selection is evaluated on all **${book.flopCount.toLocaleString('en-US')}** equally likely flops (C(52,3)).`);
  L.push('Odds are decimal (stake included). See `docs/04-house-edge-and-risk.md` and `docs/07-unit-economics.md` for the method.');
  L.push('');
  L.push('## How a price is set');
  L.push('');
  L.push('```');
  L.push('margin m   = max( tier floor for p ,  (net target + c_t) / (1 − s − b) )');
  L.push('odds       = floorToTick( (1 − m) / p )          → player EV ≤ 1 − m, always');
  L.push('gross edge = 1 − p · odds                         (house GGR per unit staked)');
  L.push('net EV     = gross edge · (1 − s − b) − c_t       (what PreFlop keeps per unit staked)');
  L.push('```');
  L.push('');
  L.push(`s = revenue shares, b = promotions (fractions of GGR); c_t = variable costs per unit staked. Net EV target: **${pct(book.netTargetMargin)}** of turnover.`);
  L.push(`Selections with fair odds above ${MAX_FAIR_ODDS} are not offered.`);
  L.push('');
  L.push('### Margin tier floors');
  L.push('');
  L.push('| Probability band | Minimum gross margin |');
  L.push('|---|---|');
  for (const t of MARGIN_TIERS) L.push(`| ${t.name} | ${pct(t.marginBps / 10000, 0)} |`);
  L.push('');
  L.push('### Channels (distribution models)');
  L.push('');
  L.push('| Channel | Plan model | Bet type | Paid away (s + b) | Variable cost c_t | Required gross margin / fee |');
  L.push('|---|---|---|---|---|---|');
  for (const c of book.channels)
    L.push(`| ${c.label} (\`${c.channel}\`) | ${c.planModel} | ${c.houseRisk ? 'Fixed odds vs house' : 'Contest / pool fee'} | ${pct(c.paidAwayShare, 1)} | ${pct(c.turnoverCostRate)} | **${pct(c.requiredGrossMargin)}** |`);
  L.push('');
  L.push('For contest channels the last column is the **minimum fee rate on buy-ins** that keeps PreFlop at the net target.');
  L.push('');
  const fixed = totalFixedMonthlyCosts(model);
  const subs = model.clubSubscription.pricePerMonthEUR * model.clubSubscription.payingClubs;
  L.push('### Break-even (placeholders)');
  L.push('');
  L.push(`Fixed costs ${eur(fixed)}/month − subscriptions ${eur(subs)}/month (${model.clubSubscription.payingClubs} clubs × ${eur(model.clubSubscription.pricePerMonthEUR)})`);
  L.push(`→ break-even turnover at the ${pct(book.netTargetMargin)} net target: **${eur(breakEvenMonthlyTurnover(model))} staked per month**.`);
  L.push('');

  L.push('## Headline markets (first release)');
  L.push('');
  L.push('| Selection | Wins / 22,100 | Probability | Fair odds | Direct odds | Club (A) odds | Partner (B) odds | Direct net EV |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const m of book.markets.filter((x) => x.firstRelease))
    for (const s of m.selections)
      L.push(`| ${s.label} | ${s.wins.toLocaleString('en-US')} | ${pct(s.probability)} | ${fair(s.fairOdds)} | **${odds(s.prices.direct!)}** | ${odds(s.prices.club!)} | ${odds(s.prices.partner!)} | ${s.prices.direct!.offered ? pct(s.prices.direct!.netEdge) : '—'} |`);
  L.push('');

  L.push('## Full catalogue — direct channel');
  L.push('');
  L.push('Columns: gross margin applied, decimal odds, the house\'s gross edge at those odds, and PreFlop\'s net EV after costs. Club (A) and partner (B) odds are in `docs/odds-book.json`.');
  for (const fam of Object.keys(FAMILY_NAMES) as (keyof typeof FAMILY_NAMES)[]) {
    L.push('');
    L.push(`### ${FAMILY_NAMES[fam]}`);
    for (const m of book.markets.filter((x) => x.family === fam)) {
      L.push('');
      L.push(`#### ${m.name} — \`${m.id}\``);
      L.push('');
      L.push(`${m.description} _Catalogue items: ${m.catalogueRefs.join(', ')}._`);
      L.push('');
      L.push('| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |');
      L.push('|---|---|---|---|---|---|---|---|');
      for (const s of m.selections) {
        const p = s.prices.direct!;
        L.push(p.offered
          ? `| ${s.label} | ${s.wins} | ${pct(s.probability, 3)} | ${fair(s.fairOdds)} | ${pct(p.marginBps / 10000)} | **${odds(p)}** | ${pct(p.grossEdge)} | ${pct(p.netEdge)} |`
          : `| ${s.label} | ${s.wins} | ${pct(s.probability, 3)} | ${s.wins ? fair(s.fairOdds) : '—'} | — | not offered | — | ${p.reason} |`);
      }
      if (m.exhaustive) {
        const offered = m.selections.map((s) => s.prices.direct!).filter((p) => p.offered);
        if (offered.length === m.selections.length) {
          const overround = offered.reduce((a, p) => a + 1 / p.odds, 0);
          L.push('');
          L.push(`Book overround (Σ 1/odds): **${pct(overround)}**`);
        }
      }
    }
  }
  L.push('');
  return L.join('\n');
}

/** Compact JSON form for the API / back office (numbers rounded for stable diffs). */
export function bookJson(book: OddsBook): string {
  const r = (x: number): number | null => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null);
  const compact = {
    flopCount: book.flopCount,
    netTargetMargin: book.netTargetMargin,
    channels: book.channels,
    markets: book.markets.map((m) => ({
      ...m,
      selections: m.selections.map((s) => ({
        id: s.id, label: s.label, wins: s.wins, probability: r(s.probability), fairOdds: r(s.fairOdds),
        prices: Object.fromEntries(Object.entries(s.prices).map(([ch, p]) => [ch, p.offered
          ? { odds: p.odds, marginBps: p.marginBps, grossEdge: r(p.grossEdge), netEdge: r(p.netEdge) }
          : { offered: false, reason: p.reason }])),
      })),
    })),
  };
  return `${JSON.stringify(compact, (_k, v: unknown) => (typeof v === 'number' ? r(v) : v), 2)}\n`;
}
