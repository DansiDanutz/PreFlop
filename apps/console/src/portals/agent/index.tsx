import { useQuery } from '@tanstack/react-query';
import { Badge, formatMoney } from '@preflop/ui';
import { api } from '../../lib/api.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { Callout, CopyButton, Kpi, PageHeader, QueryView, Section } from '../../components/ui.tsx';

/** The agent's own dashboard: invitation link, players, sub-agents and monthly statements. */

const WEB = (import.meta.env.VITE_WEB_URL as string | undefined) ?? 'http://localhost:5173';
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

export function AgentOverview() {
  const q = useQuery({ queryKey: ['me', 'agent'], queryFn: api.myAgent });
  return (
    <QueryView q={q} what="your agent account">
      {(d) => {
        if (!d.agent) return <Callout tone="info" title="No agent account">Apply from your profile in the PreFlop app.</Callout>;
        const a = d.agent;
        const link = `${WEB}/register?ref=${a.code}`;
        const statements = d.statements ?? [];
        const due = new Map<string, number>();
        for (const s of statements) if (s.status !== 'paid' && s.amount_minor > 0) due.set(s.currency, (due.get(s.currency) ?? 0) + s.amount_minor);
        return (
          <>
            <PageHeader eyebrow="Agent" title={`Code ${a.code}`} subtitle={`Level 1: ${pct(a.rate_l1_bps)} of your players’ net revenue. Level 2: ${pct(a.rate_l2_bps)} from agents you recruit.`} />
            <div className="space-y-6">
              <Section title="Your invitation link" subtitle="Players who register with it are yours for good. You cannot refer yourself.">
                <div className="flex flex-wrap items-center gap-3">
                  <code className="min-w-0 flex-1 truncate rounded-[8px] border border-line-strong bg-surface-2 px-3 py-2.5 font-mono text-sm">{link}</code>
                  <CopyButton text={link} label="Copy link" size="md" />
                </div>
              </Section>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi label="Players" value={d.players ?? 0} tone="accent" />
                <Kpi label="Sub-agents" value={d.sub_agents?.length ?? 0} />
                <Kpi label="Statements" value={statements.length} />
                <Kpi label="Waiting to be paid" value={due.size ? [...due].map(([c, v]) => formatMoney(v, c)).join(' · ') : '—'} />
              </div>
              <Callout tone="info" title="Commission is on real-money play only">Free chips, chips and diamonds never earn commission. Real money is switched off for now: statements are worked out in the sandbox, but nothing is paid until it is switched on.</Callout>
              <Section title="Sub-agents" subtitle="Agents you recruited. You earn the level-2 rate on their players; they cannot recruit further.">
                <DataTable rows={d.sub_agents ?? []} rowKey={(s) => s.user_id} empty={<p className="py-6 text-center text-sm text-muted">No sub-agents yet.</p>}
                  columns={[
                    { key: 'name', header: 'Agent', cell: (s) => <div><div className="font-semibold">{s.display_name}</div><div className="font-mono text-xs text-muted">{s.code}</div></div> },
                    { key: 'players', header: 'Players', align: 'right', cell: (s) => s.players },
                    { key: 'status', header: 'Status', cell: (s) => <Badge tone={s.status === 'active' ? 'accent' : 'muted'}>{s.status}</Badge> },
                  ]} />
              </Section>
              <Section title="Monthly statements">
                <DataTable rows={statements} rowKey={(s) => s.id} empty={<p className="py-6 text-center text-sm text-muted">No statements yet. PreFlop closes each month.</p>}
                  columns={[
                    { key: 'month', header: 'Month', cell: (s) => s.month },
                    { key: 'level', header: 'Level', cell: (s) => `L${s.level} · ${pct(s.rate_bps)}` },
                    { key: 'ngr', header: 'Net revenue', align: 'right', cell: (s) => <span className="tabular-nums">{formatMoney(s.ngr_minor, s.currency)}</span> },
                    { key: 'carry', header: 'Carried forward', align: 'right', cell: (s) => <span className="tabular-nums text-muted">{s.level === 1 && s.carry_out_minor ? formatMoney(s.carry_out_minor, s.currency) : '—'}</span> },
                    { key: 'amount', header: 'Commission', align: 'right', cell: (s) => <span className="font-semibold tabular-nums">{formatMoney(s.amount_minor, s.currency)}</span> },
                    { key: 'status', header: 'Status', cell: (s) => <Badge tone={s.status === 'paid' ? 'accent' : s.status === 'approved' ? 'info' : 'muted'}>{s.status}</Badge> },
                  ]} />
              </Section>
            </div>
          </>
        );
      }}
    </QueryView>
  );
}
