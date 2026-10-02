import type { Statement } from '@preflop/client';
import { Card, cx, formatMoney } from '@preflop/ui';
import { AlertTriangle } from 'lucide-react';
import { nf, pctFromBps } from '../lib/format.ts';
import { isPeriod, linesSum, periodOf, POLICIES, reconciles, recentPeriods, statementTotals, tierIndex } from '../lib/statements.ts';
import { Field, Select } from './ui.tsx';

export const thisPeriod = () => periodOf(new Date());

export function PeriodPicker({ value, onChange }: { value: string; onChange: (p: string) => void }) {
  const options = recentPeriods(thisPeriod(), 18);
  return (
    <Field label="Billing period" className="w-44">
      {(p) => (
        <Select {...p} value={value} onChange={(e) => { if (isPeriod(e.target.value)) onChange(e.target.value); }}>
          {options.map((o) => <option key={o} value={o}>{new Date(`${o}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</option>)}
        </Select>
      )}
    </Field>
  );
}

export function StatementTotals({ statements }: { statements: Statement[] }) {
  const totals = statementTotals(statements);
  if (!totals.length) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {totals.map((t) => (
        <Card key={t.currency} className="px-5 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Total · {t.currency}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(t.total_minor, t.currency)}</div>
          <div className="text-xs text-muted">{t.statements} statement{t.statements === 1 ? '' : 's'}</div>
        </Card>
      ))}
    </div>
  );
}

/** One party's statement: metric → tier → rate → base → amount per line. */
export function StatementCard({ s }: { s: Statement }) {
  const ok = reconciles(s);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3.5">
        <div>
          <div className="font-serif text-xl capitalize">{s.party}</div>
          <div className="text-xs text-muted">{s.period} · {s.currency}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wider text-faint">Total</div>
          <div className="text-xl font-semibold tabular-nums">{formatMoney(s.total_minor, s.currency)}</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-faint">
              <th className="px-5 py-2 font-semibold">Line</th>
              <th className="px-3 py-2 text-right font-semibold">Metric</th>
              <th className="px-3 py-2 font-semibold">Tier</th>
              <th className="px-3 py-2 text-right font-semibold">Rate</th>
              <th className="px-3 py-2 text-right font-semibold">Base</th>
              <th className="px-5 py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {s.lines.map((l, i) => (
              <tr key={i} className="border-t border-line/60 tabular-nums">
                <td className="px-5 py-2.5">{l.label}</td>
                <td className="px-3 py-2.5 text-right">{l.metric === undefined ? '—' : nf(l.metric)}</td>
                <td className="px-3 py-2.5">{l.tier ?? '—'}</td>
                <td className="px-3 py-2.5 text-right">{pctFromBps(l.rate_bps)}</td>
                <td className="px-3 py-2.5 text-right">{l.base_minor === undefined ? '—' : formatMoney(l.base_minor, s.currency)}</td>
                <td className={cx('px-5 py-2.5 text-right font-semibold', l.amount_minor < 0 && 'text-danger')}>{formatMoney(l.amount_minor, s.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!ok && (
        <div className="flex items-center gap-2 border-t border-warn/40 bg-warn/10 px-5 py-2 text-xs text-warn">
          <AlertTriangle size={14} aria-hidden />Lines add up to {formatMoney(linesSum(s), s.currency)}, not the stated total. Flag this statement to finance.
        </div>
      )}
    </Card>
  );
}

/** The placeholder tier ladders from docs/09 §3 with the reached tier highlighted when a metric is known. */
export function TierLadder({ policy, metrics = {} }: { policy: keyof typeof POLICIES; metrics?: Record<string, number> }) {
  const p = POLICIES[policy];
  return (
    <div className="space-y-5">
      {p.ladders.map((l) => {
        const value = metrics[l.metric];
        const at = value === undefined ? -1 : tierIndex(l, value);
        return (
          <div key={l.metric}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">{l.metric}</span>
              <span className="text-xs text-muted">{l.mode === 'progressive' ? 'Progressive — each band at its own rate' : 'Whole volume — highest tier reached applies to all'}</span>
            </div>
            <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${l.tiers.length}, minmax(0, 1fr))` }}>
              {l.tiers.map((t, i) => (
                <li key={i} className={cx('rounded-[12px] border px-3 py-2.5', i === at ? 'border-accent bg-accent-soft shadow-[var(--shadow-glow)]' : 'border-line bg-surface-2')}>
                  <div className={cx('text-lg font-semibold tabular-nums', i === at ? 'text-accent' : 'text-ink')}>{pctFromBps(t.rate_bps)}</div>
                  <div className="text-[11px] text-muted">{i === 0 ? 'from 0' : `from ${l.unit === 'EUR' ? '€' : ''}${t.from >= 1e6 ? `${t.from / 1e6}M` : nf(t.from)}`}</div>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
      <p className="text-xs text-faint">Share = clamp(Σ components, floor {pctFromBps(p.floor_bps)}, cap {pctFromBps(p.cap_bps)}) of {p.base}. No shares in a losing month; the loss carries forward. Shares above PreFlop's guardrail are scaled down and the statement is flagged “capped”. Placeholder policy from docs/09 — the statement above is authoritative.</p>
    </div>
  );
}
