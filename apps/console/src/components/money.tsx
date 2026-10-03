import { nf } from '../lib/format.ts';
import { type MoneyField, moneyLines, perCurrency } from '../lib/money.ts';

/**
 * A money KPI value per currency, one line each, never summed across currencies. A legacy
 * cross-currency number (older API) is shown as a plain count labelled "legacy · all currencies".
 */
export function MoneyByCurrency({ value, empty = '—' }: { value: MoneyField; empty?: string }) {
  const p = perCurrency(value);
  if (p.amounts.length) {
    const lines = moneyLines(p);
    return (
      <span className="flex flex-col gap-1">
        {lines.map((l) => <span key={l} className={lines.length > 1 ? 'text-[22px] leading-tight' : undefined}>{l}</span>)}
      </span>
    );
  }
  if (p.legacy !== null) {
    return (
      <span className="flex flex-col gap-1">
        <span>{nf(p.legacy)}</span>
        <span className="font-sans text-xs text-warn">Legacy · minor units, all currencies</span>
      </span>
    );
  }
  return <span className="text-faint">{empty}</span>;
}
