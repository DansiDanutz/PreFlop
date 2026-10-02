import { useState } from 'react';
import { defined } from '../../lib/format.ts';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.ts';
import { PageHeader, QueryView, Section } from '../../components/ui.tsx';
import { RoundFilters, RoundsTable } from '../../components/rounds.tsx';

export function Rounds() {
  const nav = useNavigate();
  const [f, setF] = useState({ tableId: '', state: '', limit: 100 });
  const q = useQuery({
    queryKey: ['admin', 'rounds', f],
    queryFn: () => api.adminRounds(defined({ table_id: f.tableId, state: f.state, limit: f.limit })),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader eyebrow="Integrity" title="Rounds explorer" subtitle="Every round on every table. Rounds in REVIEW open their evidence." />
      <Section>
        <RoundFilters tableId={f.tableId} state={f.state} limit={f.limit} onChange={setF} />
        <QueryView q={q} what="rounds">
          {(d) => <RoundsTable rows={d.rounds} onRowClick={(r) => { if (r.state === 'REVIEW' || r.state === 'EVIDENCE_REJECTED') nav(`/admin/review/${encodeURIComponent(r.id)}`); }} />}
        </QueryView>
      </Section>
    </>
  );
}
