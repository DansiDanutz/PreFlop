import { formatMoney } from '@preflop/ui';

/** One currency's amount, as the per-currency money APIs return it. */
export interface CurrencyAmount { currency: string; mode?: string | null | undefined; amount_minor: number }

/**
 * A money field during the transition to per-currency APIs: newer servers send
 * `[{ currency, mode, amount_minor }]`; older ones a single number (or a bigint string) that adds
 * minor units across every currency and is therefore meaningless as money.
 */
export type MoneyField = number | string | readonly CurrencyAmount[] | null | undefined;

export interface PerCurrency {
  /** The old, cross-currency sum, when that is all the server sent (shown labelled as legacy, never as money). */
  legacy: number | null;
  /** Amounts per currency (and mode), each in its own minor units. Never summed across currencies. */
  amounts: CurrencyAmount[];
}

const isAmount = (x: unknown): x is CurrencyAmount =>
  !!x && typeof x === 'object' && typeof (x as CurrencyAmount).currency === 'string' && Number.isFinite(Number((x as CurrencyAmount).amount_minor));

/** Normalises old and new shapes. Same currency + mode rows are merged; different currencies never are. */
export function perCurrency(v: MoneyField): PerCurrency {
  if (Array.isArray(v)) {
    const merged = new Map<string, CurrencyAmount>();
    for (const a of v.filter(isAmount)) {
      const key = `${a.mode ?? ''}|${a.currency}`;
      const prev = merged.get(key);
      merged.set(key, { currency: a.currency, mode: a.mode ?? null, amount_minor: (prev?.amount_minor ?? 0) + Number(a.amount_minor) });
    }
    return { legacy: null, amounts: [...merged.values()].sort((a, b) => a.currency.localeCompare(b.currency) || String(a.mode ?? '').localeCompare(String(b.mode ?? ''))) };
  }
  if (v === null || v === undefined || v === '') return { legacy: null, amounts: [] };
  const n = Number(v);
  return { legacy: Number.isFinite(n) ? n : null, amounts: [] };
}

const MODE_SHORT: Record<string, string> = { play: 'free', 'virtual-chips': 'chips', diamonds: 'diamonds', 'real-fiat': 'real', 'real-crypto': 'crypto' };

/** "€12.50", "1,200 free chips", or "1.00 USDT (crypto)" when one currency appears in several modes. */
export function moneyLines(p: PerCurrency): string[] {
  const dupes = new Set(p.amounts.map((a) => a.currency).filter((c, i, all) => all.indexOf(c) !== i));
  return p.amounts.map((a) => (dupes.has(a.currency) && a.mode ? `${formatMoney(a.amount_minor, a.currency)} (${MODE_SHORT[a.mode] ?? a.mode})` : formatMoney(a.amount_minor, a.currency)));
}

/** Groups per-day rows (one per day and currency) into one series per currency, over every day seen. */
export function seriesByCurrency<R extends { day: string; currency: string }>(rows: readonly R[], pick: readonly (keyof R & string)[]) {
  const days = [...new Set(rows.map((r) => String(r.day).slice(0, 10)))].sort();
  const currencies = [...new Set(rows.map((r) => r.currency))].sort();
  return {
    days,
    currencies: currencies.map((currency) => {
      const byDay = new Map(rows.filter((r) => r.currency === currency).map((r) => [String(r.day).slice(0, 10), r]));
      return {
        currency,
        values: Object.fromEntries(pick.map((k) => [k, days.map((d) => { const r = byDay.get(d); return r ? Number(r[k]) : 0; })])) as Record<string, number[]>,
      };
    }),
  };
}
