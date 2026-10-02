import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { formatMoney } from '@preflop/ui';
import { ArrowRight } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { compact } from '../../lib/chart.ts';
import { nf } from '../../lib/format.ts';
import { KIND_LABEL } from '../../lib/portals.ts';
import { BarChart, LineChart, SERIES } from '../../components/charts.tsx';
import { usePortal } from '../../components/Shell.tsx';
import { Kpi, PageHeader, QueryView, Section } from '../../components/ui.tsx';

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
            const cur = d.kpis.find((k) => k.currency)?.currency;
            const days = d.series.map((s) => new Date(`${String(s.day).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }));
            const fmt = (v: number) => (cur === 'EUR' ? `€${compact(v / 100)}` : compact(v));
            return (
              <div className="space-y-4">
                {d.kpis.length > 0 && (
                  <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${d.kpis.length % 5 === 0 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
                    {d.kpis.map((k) => <Kpi key={k.label} label={k.label} value={k.currency ? formatMoney(k.value, k.currency) : nf(k.value)} hint={k.hint} />)}
                  </div>
                )}
                {d.series.length > 0 ? (
                  <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
                    <Section title="Turnover and GGR" subtitle={`Daily, last ${d.series.length} days · ${cur ?? "minor units, all currencies"}`}>
                      <LineChart ariaLabel="Daily turnover and GGR" labels={days} format={fmt}
                        series={[{ name: 'Turnover', values: d.series.map((s) => s.turnover_minor) }, { name: 'GGR', values: d.series.map((s) => s.ggr_minor) }]} />
                    </Section>
                    <Section title="Bets per day">
                      <BarChart ariaLabel="Bets per day" color={SERIES[2]} data={d.series.slice(-14).map((s, i) => ({ label: days[d.series.length - Math.min(14, d.series.length) + i]!.split(' ')[0]!, value: s.bets }))} />
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
