import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Badge } from '@preflop/ui';
import { api } from '../../lib/api.ts';
import { fmtDateTime, nf } from '../../lib/format.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { Callout, Kpi, PageHeader, QueryView, Section } from '../../components/ui.tsx';

/**
 * The adviser's record (docs/20 §Measuring the adviser): how often the decision model's suggestion
 * matched what the team actually did, per kind of decision, and the latest cases where it did not.
 * Advice only: nothing here changes a decision; the record says whether the hints are worth reading.
 */

const KIND: Record<string, { label: string; to: string }> = {
  alert: { label: 'Alert triage', to: '/admin/alerts' },
  review: { label: 'Rounds in review', to: '/admin/review' },
  application: { label: 'Organization applications', to: '/admin/orgs' },
  promotion: { label: 'Promotion review', to: '/admin/promotions' },
  agent: { label: 'Agent applications', to: '/admin/agents' },
};
const kindLabel = (k: string) => KIND[k]?.label ?? k;
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

export function Adviser() {
  const q = useQuery({ queryKey: ['admin', 'decisions'], queryFn: api.adminDecisions, refetchInterval: 30_000 });
  return (
    <>
      <PageHeader eyebrow="Integrity" title="Adviser" subtitle="How often the decision model's suggestion matched the team's own decision. Advice only: the record tells you whether the hints are worth reading, nothing is decided by it." />
      <QueryView q={q} what="the adviser's record">
        {(d) => {
          const total = d.kinds.reduce((a, k) => ({ hints: a.hints + k.hints, decided: a.decided + k.decided, agreed: a.agreed + k.agreed, failed: a.failed + k.failed }), { hints: 0, decided: 0, agreed: 0, failed: 0 });
          const rate = total.decided ? total.agreed / total.decided : null;
          return (
            <div className="space-y-4">
              {total.hints === 0 && <Callout tone="info" title="No hints yet">The adviser has not answered anything so far. It is off without a key (docs/20), or nothing has needed a decision since it was switched on.</Callout>}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Hints stored" value={nf(total.hints)} hint={total.failed ? `${nf(total.failed)} asked but unanswered` : 'Every question answered'} />
                <Kpi label="Decided by the team" value={nf(total.decided)} hint="Hints whose case the team has closed" />
                <Kpi label="Agreement" value={rate === null ? '—' : `${Math.round(rate * 100)}%`} tone={rate !== null && rate < 0.6 ? 'warn' : undefined}
                  hint={rate === null ? 'Nothing decided yet' : rate < 0.6 ? 'Below 60%: review the questions in docs/20' : 'Suggestion matched the decision'} />
                <Kpi label="Disagreements" value={nf(total.decided - total.agreed)} tone={total.decided - total.agreed ? 'warn' : undefined} hint="Listed below, latest first" />
              </div>
              <Section title="By kind of decision" subtitle="Agreement is the share of decided cases where the team did what the adviser suggested. “Edit wording” counts as agreeing with a rejection.">
                <DataTable rows={d.kinds} rowKey={(k) => k.kind} caption="Adviser agreement by kind" empty={<p className="py-6 text-center text-sm text-muted">No hints yet.</p>}
                  columns={[
                    { key: 'kind', header: 'Decision', cell: (k) => <Link to={KIND[k.kind]?.to ?? '/admin'} className="font-medium hover:underline">{kindLabel(k.kind)}</Link> },
                    { key: 'hints', header: 'Hints', align: 'right', sort: (k) => k.hints, cell: (k) => <span className="tabular-nums">{nf(k.hints)}</span> },
                    { key: 'decided', header: 'Decided', align: 'right', sort: (k) => k.decided, cell: (k) => <span className="tabular-nums">{nf(k.decided)}</span> },
                    { key: 'agreed', header: 'Agreed', align: 'right', sort: (k) => k.agreed, cell: (k) => <span className="tabular-nums">{nf(k.agreed)}</span> },
                    { key: 'rate', header: 'Agreement', align: 'right', sort: (k) => (k.decided ? k.agreed / k.decided : -1), cell: (k) => <Badge tone={!k.decided ? 'muted' : k.agreed / k.decided >= 0.8 ? 'live' : k.agreed / k.decided >= 0.6 ? 'info' : 'warn'}>{pct(k.agreed, k.decided)}</Badge> },
                    { key: 'failed', header: 'Unanswered', align: 'right', sort: (k) => k.failed, cell: (k) => <span className="tabular-nums text-muted">{nf(k.failed)}</span> },
                  ]} />
              </Section>
              <Section title="Latest disagreements" subtitle="Where the team decided otherwise. These are the cases to read when tightening a question’s instructions.">
                <DataTable rows={d.disagreements} rowKey={(r) => `${r.kind}:${r.ref}`} caption="Latest disagreements" empty={<p className="py-6 text-center text-sm text-muted">None so far.</p>}
                  columns={[
                    { key: 'when', header: 'Decided', sort: (r) => r.outcome_at, cell: (r) => <span className="text-xs text-muted">{fmtDateTime(r.outcome_at)}</span> },
                    { key: 'kind', header: 'Decision', cell: (r) => kindLabel(r.kind) },
                    { key: 'ref', header: 'Case', cell: (r) => <span className="font-mono text-xs">{r.ref}</span> },
                    { key: 'suggested', header: 'Suggested', cell: (r) => <Badge tone="info">{(r.suggested ?? '?').replace('_', ' ')}{r.confidence !== null ? ` · ${Math.round(r.confidence * 100)}%` : ''}</Badge> },
                    { key: 'outcome', header: 'Team did', cell: (r) => <Badge tone="accent">{r.outcome}</Badge> },
                    { key: 'model', header: 'Model', cell: (r) => <span className="text-xs text-muted">{r.model ?? '—'}</span> },
                  ]} />
              </Section>
            </div>
          );
        }}
      </QueryView>
    </>
  );
}
