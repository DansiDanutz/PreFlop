import type { MyStats, PlayMode } from '@preflop/client';
import { currencyLabel, formatMoney } from '@preflop/ui';

/** One currency's totals from GET /v1/me/stats `by_currency` (newer APIs). */
export interface CurrencyStats { mode: PlayMode; currency: string; bets: number; won: number; lost: number; staked_minor: number; returned_minor: number }

/** GET /v1/me/stats: the headline totals are free chips only; `by_currency` (when present) splits every currency. */
export type StatsResponse = MyStats & { by_currency?: CurrencyStats[] | undefined };

export interface StatsBlock { key: string; title: string; cells: { label: string; value: string; accent: boolean }[] }

const MODE_NAME: Partial<Record<PlayMode, string>> = { 'real-fiat': 'Real money', 'real-crypto': 'Real money (crypto)' };

function block(key: string, title: string, s: Omit<CurrencyStats, 'mode'>): StatsBlock {
  const net = Number(s.returned_minor) - Number(s.staked_minor);
  const settled = s.won + s.lost;
  return {
    key, title,
    cells: [
      { label: 'Predictions', value: String(s.bets), accent: false },
      { label: 'Correct predictions', value: String(s.won), accent: false },
      { label: 'Hit rate', value: settled ? `${Math.round((s.won / settled) * 100)}%` : '—', accent: false },
      { label: 'Net', value: `${net > 0 ? '+' : ''}${formatMoney(net, s.currency)}`, accent: net > 0 },
    ],
  };
}

/**
 * The Activity stats strip(s). Amounts are never added across currencies: with `by_currency` there
 * is one block per currency that has bets; without it the headline is labelled "Free chips",
 * because that is all the legacy totals count.
 */
export function statsBlocks(stats: StatsResponse | undefined): StatsBlock[] {
  if (!stats) return [];
  const per = (stats.by_currency ?? []).filter((c) => c.bets > 0);
  if (per.length) {
    return per.map((c) => {
      const base = currencyLabel(c.currency);
      const mode = MODE_NAME[c.mode];
      return block(`${c.mode}:${c.currency}`, mode ? `${base} · ${mode}` : base, c);
    });
  }
  return [block('play:PLAY', 'Free chips', { ...stats, currency: 'PLAY' })];
}
