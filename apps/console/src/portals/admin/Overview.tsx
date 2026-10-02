import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Radio } from 'lucide-react';
import { Card, Felt, cx, feltLabel, feltTheme } from '@preflop/ui';
import type { TableSummary } from '@preflop/client';
import { api } from '../../lib/api.ts';
import { nf, pad3 } from '../../lib/format.ts';
import { Kpi, PageHeader, QueryView } from '../../components/ui.tsx';
import { KindChip, Problems, RoundStateBadge, TableStatus } from '../../components/domain.tsx';

export function TableWallCard({ t }: { t: TableSummary }) {
  const r = t.current_round;
  return (
    <Card className={cx('flex flex-col overflow-hidden', (!t.ready || t.status !== 'active') && 'border-warn/40')}>
      <Felt cards={t.last_flop?.cards} size="sm" unavailable={t.status !== 'active' || !t.stream_live} theme={feltTheme(t.club_id)} label={feltLabel(t.name)}
        badge={t.kind === 'simulated'} className="h-[150px] border-b border-white/5"
        action={t.kind === 'simulated' ? undefined : <KindChip kind={t.kind} />} />
      <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-serif text-[20px] leading-tight tracking-[-0.03em]">{t.name}</div>
          <div className="mt-1 flex items-center gap-1 truncate text-xs text-muted"><MapPin size={11} aria-hidden />{t.club_name}{t.city ? ` · ${t.city}` : ''}</div>
        </div>
        <span className="text-right text-[11px] leading-tight text-ink/70">Last flop<br /><span className="font-semibold text-ink">{t.last_flop ? `#${pad3(t.last_flop.hand_no)}` : '—'}</span></span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <TableStatus t={t} />
        {t.stream_live ? <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Radio size={12} className="text-live" aria-hidden />Live</span> : <span className="text-[11px] text-danger">Stream off</span>}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
        {r ? <span>Hand #{pad3(r.hand_no)} · <span className="font-mono">{r.step}</span></span> : <span>No round</span>}
        {r && <RoundStateBadge state={r.state} />}
      </div>
      {t.problems.length > 0 && <Problems problems={t.problems} />}
      </div>
    </Card>
  );
}

export function Overview() {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: api.adminOverview, refetchInterval: 5000 });
  return (
    <>
      <PageHeader eyebrow="PreFlop team" title="Overview" subtitle="Platform health over the last 24 hours and every table, live. Refreshes every 5 seconds."
        actions={q.dataUpdatedAt ? <span className="inline-flex items-center gap-2 text-xs text-muted"><span className="h-2 w-2 rounded-full bg-accent pf-pulse" />Updated {new Date(q.dataUpdatedAt).toLocaleTimeString('en-GB')}</span> : null} />
      <QueryView q={q} what="the admin overview">
        {(d) => {
          const live = d.tables.filter((t) => t.status === 'active' && t.ready).length;
          return (
            <div className="space-y-8">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Kpi label="Users" value={nf(d.users.n)} />
                <Kpi label="Bets · 24h" value={nf(d.bets_24h.n)} />
                <Kpi label="Stake · 24h" value={nf(Number(d.bets_24h.staked))} hint="Minor units, all modes combined" />
                <Kpi label="Settled · 24h" value={nf(d.rounds_24h.settled)} tone="accent" />
                <Kpi label="Voided · 24h" value={nf(d.rounds_24h.voided)} tone={d.rounds_24h.voided ? 'warn' : undefined} />
                <Kpi label="Open alerts" value={<Link to="/admin/alerts" className="hover:underline">{nf(d.open_alerts.n)}</Link>} tone={d.open_alerts.n ? 'danger' : undefined} />
              </div>
              <section aria-labelledby="wall">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 id="wall" className="text-[20px] font-bold">Table wall</h2>
                  <span className="text-sm text-muted">{live} of {d.tables.length} dealing · <Link to="/admin/tables" className="text-accent hover:underline">Manage tables</Link></span>
                </div>
                {d.tables.length === 0 ? <p className="text-sm text-muted">No tables registered.</p> : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {d.tables.map((t) => <TableWallCard key={t.id} t={t} />)}
                  </div>
                )}
              </section>
            </div>
          );
        }}
      </QueryView>
    </>
  );
}
