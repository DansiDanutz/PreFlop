import type { Statement } from '@preflop/client';

export interface CurrencyTotal { currency: string; total_minor: number; statements: number }

/** Sum of statement totals, one row per currency (never adds EUR to USDT). */
export function statementTotals(statements: readonly Statement[]): CurrencyTotal[] {
  const by = new Map<string, CurrencyTotal>();
  for (const s of statements) {
    const t = by.get(s.currency) ?? { currency: s.currency, total_minor: 0, statements: 0 };
    t.total_minor += s.total_minor;
    t.statements += 1;
    by.set(s.currency, t);
  }
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Sum of a statement's line amounts. */
export const linesSum = (s: Statement) => s.lines.reduce((a, l) => a + l.amount_minor, 0);

/** True when the lines add up to the stated total (a statement that does not reconcile is flagged in the UI). */
export const reconciles = (s: Statement) => linesSum(s) === s.total_minor;

/** Statements grouped by party, keeping server order inside each party. */
export function groupByParty(statements: readonly Statement[]): { party: string; statements: Statement[] }[] {
  const out: { party: string; statements: Statement[] }[] = [];
  for (const s of statements) {
    const g = out.find((x) => x.party === s.party);
    if (g) g.statements.push(s);
    else out.push({ party: s.party, statements: [s] });
  }
  return out;
}

// ------------------------------------------------------------- billing periods (YYYY-MM)

export const isPeriod = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

export const periodOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export function shiftPeriod(p: string, months: number): string {
  const [y, m] = p.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + months;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** The last `n` periods ending with `latest`, newest first. */
export const recentPeriods = (latest: string, n: number) => Array.from({ length: n }, (_, i) => shiftPeriod(latest, -i));

// ------------------------------------------------------------- dynamic share ladders (docs/09 §3, placeholder policy)

export interface Tier { from: number; rate_bps: number }
export interface Ladder { metric: string; unit: 'count' | 'EUR'; mode: 'progressive' | 'whole-volume'; tiers: Tier[] }

/** Placeholder policies from docs/09 §3, shown as reference next to the server's statement. */
export const POLICIES: Record<'club' | 'partner' | 'pool', { label: string; floor_bps: number; cap_bps: number; base: string; ladders: Ladder[] }> = {
  club: {
    label: 'Club (its own players)', floor_bps: 500, cap_bps: 3500, base: 'GGR',
    ladders: [
      { metric: 'Content · hands dealt', unit: 'count', mode: 'progressive', tiers: [{ from: 0, rate_bps: 500 }, { from: 10_000, rate_bps: 800 }, { from: 30_000, rate_bps: 1000 }, { from: 60_000, rate_bps: 1200 }] },
      { metric: 'Distribution · active players', unit: 'count', mode: 'whole-volume', tiers: [{ from: 0, rate_bps: 0 }, { from: 25, rate_bps: 1000 }, { from: 100, rate_bps: 1500 }, { from: 500, rate_bps: 2000 }, { from: 2000, rate_bps: 2500 }] },
    ],
  },
  partner: {
    label: 'Betting company', floor_bps: 2000, cap_bps: 4000, base: 'GGR',
    ladders: [{ metric: 'Distribution · monthly turnover', unit: 'EUR', mode: 'progressive', tiers: [{ from: 0, rate_bps: 2000 }, { from: 1_000_000, rate_bps: 2500 }, { from: 5_000_000, rate_bps: 3000 }, { from: 20_000_000, rate_bps: 3500 }] }],
  },
  pool: {
    label: 'Pool / contest creator', floor_bps: 3000, cap_bps: 4500, base: 'rake',
    ladders: [{ metric: 'Pools created per month', unit: 'count', mode: 'whole-volume', tiers: [{ from: 0, rate_bps: 3000 }, { from: 50, rate_bps: 3500 }, { from: 500, rate_bps: 4000 }, { from: 5000, rate_bps: 4500 }] }],
  },
};

/** Index of the tier a metric value has reached. */
export function tierIndex(ladder: Ladder, value: number): number {
  let idx = 0;
  ladder.tiers.forEach((t, i) => { if (value >= t.from) idx = i; });
  return idx;
}
