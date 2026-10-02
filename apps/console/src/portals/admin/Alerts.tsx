import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Alert } from '@preflop/client';
import { Badge, Button } from '@preflop/ui';
import { CheckCheck } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { fmtDateTime, relTime } from '../../lib/format.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { ConfirmDialog, PageHeader, Pills, QueryView, Section, Toggle, useAction } from '../../components/ui.tsx';

const SEV = ['all', 'critical', 'warning', 'info'] as const;
const SEV_RANK = { critical: 0, warning: 1, info: 2 } as const;

export function Alerts() {
  const q = useQuery({ queryKey: ['admin', 'alerts'], queryFn: api.adminAlerts, refetchInterval: 10_000 });
  const [sev, setSev] = useState<(typeof SEV)[number]>('all');
  const [showResolved, setShowResolved] = useState(false);
  const [target, setTarget] = useState<Alert | null>(null);
  const resolve = useAction((id: number) => api.adminResolveAlert(id), { invalidate: [['admin', 'alerts'], ['admin', 'overview']], success: 'Alert resolved.', onSuccess: () => setTarget(null) });

  return (
    <>
      <PageHeader eyebrow="Integrity" title="Alerts" subtitle="Security, evidence, link and monitor alerts. Resolving records who closed it." />
      <Section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Pills label="Severity" options={SEV} value={sev} onChange={setSev} />
          <label className="flex items-center gap-2 text-sm text-muted"><Toggle checked={showResolved} onChange={setShowResolved} label="Show resolved alerts" />Show resolved</label>
        </div>
        <QueryView q={q} what="alerts">
          {(d) => {
            const rows = d.alerts.filter((a) => (sev === 'all' || a.severity === sev) && (showResolved || !a.resolved_at));
            return (
              <DataTable rows={rows} rowKey={(a) => String(a.id)} caption="Alerts" initialSort={{ key: 'created', dir: 'desc' }}
                empty={d.alerts.length ? 'No alerts match this filter.' : 'No alerts. All quiet.'}
                rowClassName={(a) => (a.resolved_at ? 'opacity-60' : undefined)}
                columns={[
                  { key: 'sev', header: 'Severity', sort: (a) => SEV_RANK[a.severity], cell: (a) => <Badge tone={a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warn' : 'info'} className="!px-2 !py-0.5 !text-[10px]">{a.severity}</Badge> },
                  { key: 'kind', header: 'Kind', sort: (a) => a.kind, cell: (a) => <span className="font-mono text-[13px]">{a.kind}</span> },
                  { key: 'where', header: 'Table / round', cell: (a) => <span className="font-mono text-xs text-muted">{a.round_id ?? a.table_id ?? '—'}</span> },
                  { key: 'details', header: 'Details', cell: (a) => <code className="line-clamp-2 max-w-md break-all font-mono text-[11.5px] text-muted" title={JSON.stringify(a.details)}>{JSON.stringify(a.details)}</code> },
                  { key: 'created', header: 'Raised', sort: (a) => a.created_at, cell: (a) => <span title={fmtDateTime(a.created_at)} className="text-xs">{relTime(a.created_at)}</span> },
                  { key: 'act', header: <span className="sr-only">Actions</span>, align: 'right', cell: (a) => a.resolved_at ? <span className="text-xs text-muted">Resolved {relTime(a.resolved_at)}</span> : <Button size="sm" variant="secondary" onClick={() => setTarget(a)}><CheckCheck size={14} aria-hidden />Resolve</Button> },
                ]} />
            );
          }}
        </QueryView>
      </Section>
      <ConfirmDialog open={!!target} onClose={() => setTarget(null)} danger={false} confirmLabel="Resolve" busy={resolve.isPending}
        title="Resolve this alert?" onConfirm={() => target && resolve.mutate(target.id)}>
        <strong>{target?.kind}</strong> ({target?.severity}) will be marked resolved by you. Only resolve once the cause is understood.
      </ConfirmDialog>
    </>
  );
}
