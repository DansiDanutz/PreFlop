import type { Round, RoundState } from '@preflop/client';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { fmtDateTime, pad3 } from '../lib/format.ts';
import { DataTable, type Column } from './DataTable.tsx';
import { FlopText, Money, RoundStateBadge } from './domain.tsx';
import { Field, Select } from './ui.tsx';

export type RoundRow = Round & { bets: number; staked_minor: number; paid_minor: number; table_name?: string };

export const ROUND_STATES: RoundState[] = ['OPEN', 'LOCKED', 'DEALT', 'REVIEW', 'EVIDENCE_REJECTED', 'SETTLED', 'VOID'];

export function RoundsTable({ rows, showTable = true, onRowClick }: { rows: RoundRow[]; showTable?: boolean; onRowClick?: (r: RoundRow) => void }) {
  const cols: Column<RoundRow>[] = [
    ...(showTable ? [{ key: 'table', header: 'Table', sort: (r: RoundRow) => r.table_name ?? r.table_id, cell: (r: RoundRow) => <span className="font-medium">{r.table_name ?? r.table_id}</span> }] : []),
    { key: 'hand', header: 'Hand', sort: (r) => r.hand_no, cell: (r) => `#${pad3(r.hand_no)}` },
    { key: 'state', header: 'State', sort: (r) => r.state, cell: (r) => <RoundStateBadge state={r.state} /> },
    { key: 'flop', header: 'Flop', cell: (r) => <FlopText cards={r.flop} /> },
    { key: 'bets', header: 'Bets', align: 'right', sort: (r) => r.bets, cell: (r) => r.bets },
    { key: 'staked', header: 'Staked', align: 'right', sort: (r) => r.staked_minor, cell: (r) => <Money minor={r.staked_minor} currency={r.currency} /> },
    { key: 'paid', header: 'Paid', align: 'right', sort: (r) => r.paid_minor, cell: (r) => <Money minor={r.paid_minor} currency={r.currency} /> },
    { key: 'opened', header: 'Opened', sort: (r) => r.opened_at, cell: (r) => <span className="text-xs text-muted">{fmtDateTime(r.opened_at)}</span> },
    { key: 'void', header: 'Void reason', sort: (r) => r.void_reason, cell: (r) => r.void_reason ? <span className="text-xs text-warn">{r.void_reason}</span> : <span className="text-faint">—</span> },
  ];
  return <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} dense onRowClick={onRowClick} caption="Rounds" initialSort={{ key: 'opened', dir: 'desc' }}
    empty="No rounds match these filters." />;
}

export function RoundFilters({ tableId, state, limit, onChange, tables }: {
  tableId: string; state: string; limit: number; onChange: (f: { tableId: string; state: string; limit: number }) => void; tables?: { id: string; name: string }[];
}) {
  const lobby = useQuery({ queryKey: ['lobby'], queryFn: api.lobby, enabled: !tables, staleTime: 60_000 });
  const opts = tables ?? lobby.data?.tables.map((t) => ({ id: t.id, name: `${t.name} · ${t.club_name}` })) ?? [];
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Field label="Table" className="w-64">
        {(p) => <Select {...p} value={tableId} onChange={(e) => onChange({ tableId: e.target.value, state, limit })}>
          <option value="">All tables</option>
          {opts.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>}
      </Field>
      <Field label="State" className="w-52">
        {(p) => <Select {...p} value={state} onChange={(e) => onChange({ tableId, state: e.target.value, limit })}>
          <option value="">Any state</option>
          {ROUND_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>}
      </Field>
      <Field label="Show" className="w-32">
        {(p) => <Select {...p} value={limit} onChange={(e) => onChange({ tableId, state, limit: Number(e.target.value) })}>
          {[50, 100, 250, 500].map((n) => <option key={n} value={n}>{n} rows</option>)}
        </Select>}
      </Field>
    </div>
  );
}
