import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CURRENCY_DIGITS, currencyLabel, formatMoney } from '@preflop/ui';
import { ArrowRight } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { compact } from '../../lib/chart.ts';
import { nf } from '../../lib/format.ts';
import { KIND_LABEL } from '../../lib/portals.ts';
import { BarChart, LineChart, SERIES } from '../../components/charts.tsx';
import { usePortal } from '../../components/Shell.tsx';
import { Kpi, PageHeader, QueryView, Section } from '../../components/ui.tsx';
import { MoneyByCurrency } from '../../components/money.tsx';
import { type MoneyField, seriesByCurrency } from '../../lib/money.ts';

const QUICK: Record<string, { to: string; label: string; hint: string }[]> = {
  club: [
    { to: 'tables', label: 'Tables & certification', hint: 'Readiness, link health, the 9-item checklist' },
    { to: 'staff', label: 'Enroll staff credentials', hint: 'Dealer, floor and floor-manager keys per table' },
    { to: 'revenue', label: 'Revenue share', hint: 'Your tier, rate and amount this period' },
  ],
  partner: [
    { to: 'keys', label: 'API keys', hint: 'OAuth client credentials for the Partner API' },
    { to: 'webhooks', label: 'Webhooks', hint: 'bet.settled, round.voided and more' },
    { to: 'docs', label: 'Integration docs', hint: 'Quickstart in curl and TypeScript' },
  ],
  organizer: [
    { to: 'rooms', label: 'Rooms', hint: 'Rules, margin, rake and invite codes' },
    { to: 'diamonds', label: 'Diamonds', hint: 'Buy packs and watch dilution' },
    { to: 'treasury', label: 'Collateral', hint: 'Fund the house for every open round' },
  ],
};

/** Chart ticks in major units of one currency: "€1.2k", "1.5k ◆", "12k". */
export function chartFormat(currency: string) {
  const d = CURRENCY_DIGITS[currency] ?? 2;
  return (v: number) => {
    const n = compact(v / 10 ** d);
    return currency === 'EUR' ? `€${n}` : currency === 'DIAMOND' ? `${n} ◆` : n;
  };
}

/** A KPI value: a count, an amount in the KPI's currency, or (newer APIs) per-currency amounts. */
function kpiValue(k: { value: unknown; currency?: string | undefined }) {
  if (Array.isArray(k.value)) return <MoneyByCurrency value={k.value as MoneyField} />;
  const n = Number(k.value);
  return k.currency ? formatMoney(n, k.currency) : nf(n);
}

export function OrgOverviewPage() {
  const portal = usePortal();
  const id = portal.orgId!;
  const q = useQuery({ queryKey: ['org', id, 'overview'], queryFn: () => api.orgOverview(id), refetchInterval: 30_000 });
  return (
    <>
      <PageHeader eyebrow={KIND_LABEL[portal.kind]} title={portal.name} subtitle="Key numbers and the last 30 days." />
      <div className="space-y-6">
        <QueryView q={q} what="the organization overview">
          {(d) => {
            // One row per day and currency: chart each currency on its own axis, never summed.
            const g = seriesByCurrency(d.series, ['turnover_minor', 'ggr_minor', 'bets']);
            const label = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
            const days = g.days.map(label);
            const betsPerDay = g.days.map((_, i) => g.currencies.reduce((a, c) => a + (c.values.bets![i] ?? 0), 0));
            return (
              <div className="space-y-4">
                {d.kpis.length > 0 && (
                  <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${d.kpis.length % 5 === 0 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
                    {d.kpis.map((k, i) => <Kpi key={`${k.label}:${k.currency ?? ''}:${i}`} label={k.currency ? `${k.label} · ${currencyLabel(k.currency)}` : k.label} value={kpiValue(k)} hint={k.hint} />)}
                  </div>
                )}
                {g.days.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                    <div className="space-y-4">
                      {g.currencies.map((c) => (
                        <Section key={c.currency} title={`Turnover and GGR · ${currencyLabel(c.currency)}`} subtitle={`Daily, last ${g.days.length} days · ${c.currency}`}>
                          <LineChart ariaLabel={`Daily turnover and GGR in ${c.currency}`} labels={days} format={chartFormat(c.currency)}
                            series={[{ name: 'Turnover', values: c.values.turnover_minor! }, { name: 'GGR', values: c.values.ggr_minor! }]} />
                        </Section>
                      ))}
                    </div>
                    <Section title="Bets per day">
                      <BarChart ariaLabel="Bets per day" color={SERIES[2]} data={betsPerDay.slice(-14).map((v, i) => ({ label: days[days.length - Math.min(14, days.length) + i]!.split(' ')[0]!, value: v }))} />
                    </Section>
                  </div>
                ) : <p className="text-sm text-muted">No activity in the last 30 days.</p>}
              </div>
            );
          }}
        </QueryView>
        {QUICK[portal.kind] && (
          <div className="grid gap-3 md:grid-cols-3">
            {QUICK[portal.kind]!.map((x) => (
              <Link key={x.to} to={`${portal.key}/${x.to}`} className="group rounded-[12px] border border-line bg-surface p-5 transition-colors hover:border-accent/60">
                <div className="flex items-center justify-between font-serif text-lg">{x.label}<ArrowRight size={16} className="text-faint group-hover:text-accent" aria-hidden /></div>
                <div className="mt-1 text-sm text-muted">{x.hint}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
