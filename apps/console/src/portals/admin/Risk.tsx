import { useQuery } from '@tanstack/react-query';
import { cx, formatMoney } from '@preflop/ui';
import { api } from '../../lib/api.ts';
import { nf } from '../../lib/format.ts';
import { Meter } from '../../components/charts.tsx';
import { DataTable } from '../../components/DataTable.tsx';
import { PageHeader, QueryView, Section } from '../../components/ui.tsx';

/** CUSUM alarm threshold for the outcome monitor (docs/12 §1, sequential outcome-frequency monitoring). */
export const CUSUM_THRESHOLD = 14;

export function Risk() {
  const q = useQuery({ queryKey: ['admin', 'risk'], queryFn: api.adminRisk, refetchInterval: 5000 });
  return (
    <>
      <PageHeader eyebrow="Integrity" title="Risk" subtitle="Exposure on every open round against its loss limit, and the outcome monitor's CUSUM statistics per table. Refreshes every 5 seconds." />
      <QueryView q={q} what="risk exposure">
        {(d) => (
          <div className="space-y-4">
            <Section title="Open rounds — worst-case loss" subtitle="Exact worst case over all 22,100 flops. A bet that would push it past the limit is refused.">
              <DataTable rows={d.rounds} rowKey={(r) => r.round_id} caption="Open round exposure" initialSort={{ key: 'use', dir: 'desc' }}
                empty="No open rounds carry exposure right now."
                columns={[
                  { key: 'table', header: 'Table', sort: (r) => r.table_name, cell: (r) => <div><div className="font-medium">{r.table_name}</div><div className="font-mono text-[11px] text-faint">{r.round_id}</div></div> },
                  { key: 'bets', header: 'Bets', align: 'right', sort: (r) => r.bets, cell: (r) => nf(r.bets) },
                  { key: 'staked', header: 'Staked', align: 'right', sort: (r) => r.staked_minor, cell: (r) => formatMoney(r.staked_minor, r.currency) },
                  { key: 'worst', header: 'Worst case', align: 'right', sort: (r) => r.worst_case_loss_minor, cell: (r) => formatMoney(r.worst_case_loss_minor, r.currency) },
                  {
                    key: 'use', header: 'Of limit', className: 'w-[34%]', sort: (r) => (r.limit_minor ? r.worst_case_loss_minor / r.limit_minor : 0), cell: (r) => {
                      const f = r.limit_minor ? r.worst_case_loss_minor / r.limit_minor : 0;
                      return (
                        <div className="flex items-center gap-3">
                          <Meter value={r.worst_case_loss_minor} max={r.limit_minor} label={`${r.table_name} exposure`} />
                          <span className={cx('w-36 shrink-0 whitespace-nowrap text-right text-xs tabular-nums', f >= 1 ? 'text-danger' : f >= 0.75 ? 'text-warn' : 'text-muted')}>{Math.round(f * 100)}% of {formatMoney(r.limit_minor, r.currency)}</span>
                        </div>
                      );
                    },
                  },
                ]} />
            </Section>
            <Section title="Outcome monitor" subtitle={`Sequential CUSUM per selection; the table pauses automatically at ${CUSUM_THRESHOLD}. A rising statistic means a market is hitting more often than its true probability.`}>
              {d.monitor.length === 0 ? <p className="text-sm text-muted">No monitor data yet.</p> : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {d.monitor.map((m) => {
                    const threshold = (m as { threshold?: number }).threshold ?? CUSUM_THRESHOLD;
                    const worst = Math.max(0, ...m.top.map((t) => t.statistic));
                    return (
                      <div key={m.table_id} className={cx('rounded-[14px] border p-4', worst >= threshold ? 'border-danger/60 bg-danger/5' : worst >= threshold * 0.7 ? 'border-warn/50' : 'border-line')}>
                        <div className="mb-3 flex items-baseline justify-between"><span className="font-serif text-lg">{m.table_name}</span><span className="text-xs text-muted">{nf(m.hands)} hands</span></div>
                        {m.top.length === 0 ? <p className="text-xs text-muted">No statistics.</p> : (
                          <ul className="space-y-2.5">
                            {m.top.map((t) => (
                              <li key={t.selection_id}>
                                <div className="mb-1 flex justify-between gap-2 text-xs"><span className="truncate font-mono text-muted">{t.selection_id}</span><span className={cx('tabular-nums', t.statistic >= threshold ? 'text-danger' : 'text-ink')}>{t.statistic.toFixed(2)} / {threshold}</span></div>
                                <Meter value={t.statistic} max={threshold} label={`${t.selection_id} CUSUM`} warnAt={0.7} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </div>
        )}
      </QueryView>
    </>
  );
}
