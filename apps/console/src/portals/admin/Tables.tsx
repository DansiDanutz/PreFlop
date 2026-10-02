import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ClubTable, TableSummary } from '@preflop/client';
import { Button, formatMoney } from '@preflop/ui';
import { Pause, Play } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { isNotAvailable, pad3 } from '../../lib/format.ts';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { Callout, ConfirmDialog, ErrorBox, Loading, Modal, PageHeader, Section, useAction } from '../../components/ui.tsx';
import { FlopText, KindChip, Problems, RoundStateBadge, TableStatus } from '../../components/domain.tsx';
import { CertBadge, CertChecklist, LinkHealth } from '../../components/tables.tsx';

function baseColumns<T extends TableSummary>(): Column<T>[] {
  return [
    { key: 'name', header: 'Table', sort: (t) => t.name, cell: (t) => <div className="min-w-[150px]"><div className="flex items-center gap-2 whitespace-nowrap font-medium">{t.name}<KindChip kind={t.kind} /></div><div className="whitespace-nowrap text-xs text-muted">{t.club_name}{t.city ? ` · ${t.city}` : ''}</div></div> },
    { key: 'status', header: 'Status', sort: (t) => `${t.status}${t.ready}`, className: 'whitespace-nowrap', cell: (t) => <TableStatus t={t} /> },
    { key: 'problems', header: 'Readiness', sort: (t) => t.problems.length, className: 'min-w-[150px] max-w-[200px]', cell: (t) => <Problems problems={t.problems} /> },
    { key: 'round', header: 'Current round', sort: (t) => t.current_round?.hand_no, className: 'whitespace-nowrap', cell: (t) => t.current_round ? <span className="inline-flex items-center gap-2">#{pad3(t.current_round.hand_no)} <RoundStateBadge state={t.current_round.state} /></span> : <span className="text-faint">—</span> },
    { key: 'flop', header: 'Last flop', className: 'whitespace-nowrap', cell: (t) => <FlopText cards={t.last_flop?.cards} /> },
  ];
}

export function Tables() {
  const q = useQuery({ queryKey: ['admin', 'tables'], queryFn: api.adminTables, refetchInterval: 5000 });
  const unavailable = q.isError && isNotAvailable(q.error);
  const lobby = useQuery({ queryKey: ['lobby'], queryFn: api.lobby, enabled: unavailable, refetchInterval: 5000 });
  const [target, setTarget] = useState<{ t: ClubTable; to: 'active' | 'paused' } | null>(null);
  const [detail, setDetail] = useState<ClubTable | null>(null);
  const setStatus = useAction((a: { id: string; status: 'active' | 'paused'; reason: string }) => api.adminSetTableStatus(a.id, a.status, a.reason), {
    invalidate: [['admin', 'tables'], ['admin', 'overview']],
    success: (_, a) => `Table ${a.status === 'paused' ? 'paused' : 'resumed'}.`,
    onSuccess: () => setTarget(null),
  });

  const cols: Column<ClubTable>[] = [
    ...baseColumns<ClubTable>(),
    { key: 'cert', header: 'Certification', className: 'whitespace-nowrap', sort: (t) => Object.values(t.certification ?? {}).filter((c) => c.ok).length, cell: (t) => <CertBadge cert={t.certification} /> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', className: 'w-px', cell: (t) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {t.status === 'paused'
            ? <Button size="sm" variant="secondary" onClick={() => setTarget({ t, to: 'active' })}><Play size={14} aria-hidden />Resume</Button>
            : <Button size="sm" variant="secondary" onClick={() => setTarget({ t, to: 'paused' })} disabled={t.status === 'retired'}><Pause size={14} aria-hidden />Pause</Button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader eyebrow="PreFlop team" title="Live tables" subtitle="Status, readiness and certification for every table. Pausing stops new rounds from opening; the round in progress may finish." />
      {q.isPending ? <Loading rows={6} /> : unavailable ? (
        <div className="space-y-4">
          <Callout tone="warn" title="Table management is not available yet">
            <code className="font-mono">GET /v1/admin/tables</code> is not deployed. Below is the public lobby, read-only: no certification, link health or pause controls until the endpoint ships.
          </Callout>
          <Section title="Lobby tables (read-only)">
            {lobby.isPending ? <Loading rows={4} /> : lobby.isError ? <ErrorBox error={lobby.error} /> : (
              <DataTable rows={lobby.data.tables} columns={baseColumns<TableSummary>()} rowKey={(t) => t.id} caption="Lobby tables" />
            )}
          </Section>
        </div>
      ) : q.isError ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : (
        <Section>
          <DataTable rows={q.data.tables} columns={cols} rowKey={(t) => t.id} onRowClick={setDetail} caption="All tables" initialSort={{ key: 'name', dir: 'asc' }} />
        </Section>
      )}

      <ConfirmDialog open={!!target} onClose={() => setTarget(null)} busy={setStatus.isPending}
        title={target?.to === 'paused' ? `Pause ${target?.t.name}?` : `Resume ${target?.t.name}?`}
        confirmLabel={target?.to === 'paused' ? 'Pause table' : 'Resume table'} danger={target?.to === 'paused'}
        reason={{ label: 'Reason (audited)', placeholder: target?.to === 'paused' ? 'e.g. outcome monitor threshold, camera bumped' : 'e.g. technician inspected Table Box' }}
        onConfirm={(reason) => target && setStatus.mutate({ id: target.t.id, status: target.to, reason })}>
        {target?.to === 'paused'
          ? <>No new round will open on <strong>{target.t.name}</strong>. A round already in progress may finish; one that can't be verified is voided and refunded.</>
          : <>Rounds reopen once the table is ready (all certification items valid, healthy heartbeat, stream live).</>}
      </ConfirmDialog>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ''} wide>
        {detail && (
          <div className="grid gap-6 md:grid-cols-2">
            <div><h3 className="mb-2 font-serif text-lg">Certification</h3><CertChecklist cert={detail.certification} /></div>
            <div className="space-y-6">
              <div><h3 className="mb-2 font-serif text-lg">Link health</h3><LinkHealth link={detail.link} at={detail.link_at} /></div>
              <div><h3 className="mb-2 font-serif text-lg">Readiness</h3><Problems problems={detail.problems} /></div>
              <div><h3 className="mb-2 font-serif text-lg">Risk</h3><p className="text-sm text-muted">Per-round loss limit <span className="tabular-nums text-ink">{formatMoney(detail.max_round_loss_minor, detail.currency)}</span>. Bets that would push an open round's exact worst case past it are refused.</p></div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
