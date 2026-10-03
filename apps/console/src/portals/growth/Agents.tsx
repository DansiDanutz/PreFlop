import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AdminAgents, AgentStatement } from '@preflop/client';
import { Badge, Button, formatMoney } from '@preflop/ui';
import { Network } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useCanWrite, usePortal } from '../../components/Shell.tsx';
import { DataTable } from '../../components/DataTable.tsx';
import { Callout, ConfirmDialog, Field, Kpi, Modal, PageHeader, QueryView, Section, Select, TextInput, useAction } from '../../components/ui.tsx';

/** The PreFlop team's view of agents: applications, the two-level tree, rates and monthly statements (docs/16 §4). */

type AgentRow = AdminAgents['agents'][number];
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;
const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

function tone(s: string): 'accent' | 'info' | 'warn' | 'danger' | 'muted' {
  return s === 'active' || s === 'paid' ? 'accent' : s === 'applied' || s === 'approved' ? 'info' : s === 'suspended' ? 'warn' : s === 'rejected' ? 'danger' : 'muted';
}

function AgentEditor({ agent, all, caps, onClose }: { agent: AgentRow | null; all: AgentRow[]; caps: AdminAgents['caps']; onClose: () => void }) {
  const [f, setF] = useState({ l1: '25', l2: '5', parent: '' });
  useEffect(() => { if (agent) setF({ l1: String(agent.rate_l1_bps / 100), l2: String(agent.rate_l2_bps / 100), parent: agent.parent_agent_id ?? '' }); }, [agent]);
  const l1 = Math.round(Number(f.l1) * 100), l2 = Math.round(Number(f.l2) * 100);
  const bad = !(l1 >= 0 && l1 <= caps.rate_l1_bps && l2 >= 0 && l2 <= caps.rate_l2_bps);
  // Only active top-level agents can be parents; two levels, never more.
  const parents = all.filter((a) => a.status === 'active' && !a.parent_agent_id && a.user_id !== agent?.user_id);
  const save = useAction(() => api.adminUpdateAgent(agent!.user_id, {
    ...(agent!.status === 'applied' ? { status: 'active' as const } : {}), rate_l1_bps: l1, rate_l2_bps: l2, parent_agent_id: f.parent || null,
  }), { invalidate: [['agents']], success: agent?.status === 'applied' ? 'Agent approved and code activated.' : 'Agent updated.', onSuccess: onClose });
  return (
    <Modal open={!!agent} onClose={onClose} title={agent?.status === 'applied' ? `Approve ${agent.display_name}` : `Edit ${agent?.display_name ?? ''}`}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" disabled={bad || save.isPending} onClick={() => save.mutate(undefined)}>{agent?.status === 'applied' ? 'Approve' : 'Save'}</Button></>}>
      <div className="space-y-4">
        {agent?.note && <Callout tone="info" title="From the application">{agent.note}</Callout>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Level 1 rate (%)" hint={`On their own players’ net revenue. Max ${pct(caps.rate_l1_bps)}.`}>{(p) => <TextInput {...p} inputMode="decimal" value={f.l1} onChange={(e) => setF({ ...f, l1: e.target.value })} />}</Field>
          <Field label="Level 2 rate (%)" hint={`On their sub-agents’ players. Max ${pct(caps.rate_l2_bps)}.`}>{(p) => <TextInput {...p} inputMode="decimal" value={f.l2} onChange={(e) => setF({ ...f, l2: e.target.value })} />}</Field>
        </div>
        <Field label="Recruited by (parent agent)" hint="Optional. The parent earns the level-2 rate on this agent’s players. A sub-agent cannot have sub-agents of their own.">{(p) => (
          <Select {...p} value={f.parent} onChange={(e) => setF({ ...f, parent: e.target.value })}>
            <option value="">No parent (top-level agent)</option>
            {parents.map((a) => <option key={a.user_id} value={a.user_id}>{a.display_name} · {a.code}</option>)}
          </Select>)}</Field>
        {bad && <Callout tone="warn" title="Rates are out of range">Level 1 is 0–{pct(caps.rate_l1_bps)} and level 2 is 0–{pct(caps.rate_l2_bps)}.</Callout>}
      </div>
    </Modal>
  );
}

export function Agents() {
  const write = useCanWrite();
  const role = usePortal().role;
  const [editing, setEditing] = useState<AgentRow | null>(null);
  const [month, setMonth] = useState(lastMonth());
  const q = useQuery({ queryKey: ['agents'], queryFn: api.adminAgents });
  // Reject, suspend and pay act on someone else's livelihood or money: each asks first.
  const [confirm, setConfirm] = useState<{ kind: 'rejected' | 'suspended'; agent: AgentRow } | { kind: 'pay'; s: AgentStatement } | null>(null);
  const setStatus = useAction((a: { id: string; status: 'active' | 'suspended' | 'rejected' }) => api.adminUpdateAgent(a.id, { status: a.status }),
    { invalidate: [['agents']], success: (_r, a) => `Agent ${a.status === 'active' ? 're-activated' : a.status}.`, onSuccess: () => setConfirm(null) });
  const close = useAction(() => api.adminCloseAgentMonth(month), { invalidate: [['agents']], success: (r) => (r.created ? `${r.created} statements created for ${month}.` : `${month} was already closed; nothing new.`) });
  const approve = useAction((s: AgentStatement) => api.adminApproveStatement(s.id), { invalidate: [['agents']], success: 'Statement approved.' });
  const pay = useAction((s: AgentStatement) => api.adminPayStatement(s.id), { invalidate: [['agents']], success: 'Commission paid into the agent’s wallet.', onSuccess: () => setConfirm(null) });
  return (
    <>
      <PageHeader eyebrow="Growth" title="Agents" subtitle="A two-level affiliate on net gaming revenue. Commission is earned on real-money play only, never on free chips, chips or diamonds." />
      <QueryView q={q} what="agents">
        {(d) => {
          const applied = d.agents.filter((a) => a.status === 'applied');
          const active = d.agents.filter((a) => a.status === 'active');
          const unpaid = d.statements.filter((s) => s.status !== 'paid' && s.amount_minor > 0);
          return (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi label="Active agents" value={active.length} tone="accent" />
                <Kpi label="Applications" value={applied.length} tone={applied.length ? 'warn' : undefined} />
                <Kpi label="Players referred" value={d.agents.reduce((t, a) => t + a.players, 0)} />
                <Kpi label="Statements to pay" value={unpaid.length} />
              </div>
              <Callout tone="warn" title="Real money is off">Statements compute in the sandbox. Paying needs the real-money mode switched on, and only a super admin can pay.</Callout>

              {applied.length > 0 && (
                <Section title="Applications" subtitle="Set the rates and an optional parent, then approve. The agent’s code starts working at once.">
                  <ul className="divide-y divide-line">
                    {applied.map((a) => (
                      <li key={a.user_id} className="flex flex-wrap items-start justify-between gap-4 py-4">
                        <div className="min-w-0 max-w-2xl">
                          <div className="font-semibold">{a.display_name} <span className="text-sm font-normal text-muted">· {a.email}</span></div>
                          {a.note && <p className="mt-1 text-sm text-ink/80">{a.note}</p>}
                        </div>
                        {write && <div className="flex gap-2"><Button size="sm" onClick={() => setEditing(a)}>Review &amp; approve</Button><Button size="sm" variant="secondary" onClick={() => setConfirm({ kind: 'rejected', agent: a })}>Reject</Button></div>}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="Agent tree" subtitle="Top-level agents and the sub-agents they recruited. Two levels, never more.">
                <DataTable rows={d.agents.filter((a) => a.status !== 'applied')} rowKey={(a) => a.user_id}
                  empty={<div className="py-8 text-center text-sm text-muted"><Network className="mx-auto mb-2 text-accent/70" aria-hidden />No agents yet.</div>}
                  columns={[
                    { key: 'name', header: 'Agent', sort: (a) => a.display_name, cell: (a) => <div><div className="font-semibold">{a.parent_agent_id ? '↳ ' : ''}{a.display_name}</div><div className="font-mono text-xs text-muted">{a.code}</div></div> },
                    { key: 'parent', header: 'Recruited by', cell: (a) => a.parent_name ?? <span className="text-muted">—</span> },
                    { key: 'rates', header: 'Rates (L1 / L2)', cell: (a) => `${pct(a.rate_l1_bps)} / ${pct(a.rate_l2_bps)}` },
                    { key: 'players', header: 'Players', align: 'right', sort: (a) => a.players, cell: (a) => <span className="tabular-nums">{a.players}</span> },
                    { key: 'status', header: 'Status', cell: (a) => <Badge tone={tone(a.status)}>{a.status}</Badge> },
                    { key: 'act', header: '', align: 'right', cell: (a) => write ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>Edit</Button>
                        {a.status === 'active' && <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'suspended', agent: a })}>Suspend</Button>}
                        {a.status === 'suspended' && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: a.user_id, status: 'active' })}>Re-activate</Button>}
                      </div>
                    ) : null },
                  ]} />
              </Section>

              <Section title="Monthly statements" subtitle="Level 1 carries a losing month forward; level 2 does not. Closing a month twice changes nothing."
                actions={write && (
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor="close-month">Month</label>
                    <input id="close-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 rounded-[8px] border border-line-strong bg-surface-2 px-2 text-sm text-ink" />
                    <Button size="sm" disabled={close.isPending || !month} onClick={() => close.mutate(undefined)}>Close month</Button>
                  </div>
                )}>
                <DataTable rows={d.statements} rowKey={(s) => s.id} empty={<p className="py-6 text-center text-sm text-muted">No statements yet. Close a month to build them.</p>}
                  columns={[
                    { key: 'month', header: 'Month', sort: (s) => s.month, cell: (s) => s.month },
                    { key: 'agent', header: 'Agent', sort: (s) => s.display_name ?? '', cell: (s) => s.display_name ?? s.agent_id },
                    { key: 'level', header: 'Level', cell: (s) => `L${s.level} · ${pct(s.rate_bps)}` },
                    { key: 'ngr', header: 'Net revenue', align: 'right', cell: (s) => <span className="tabular-nums">{formatMoney(s.ngr_minor, s.currency)}</span> },
                    { key: 'carry', header: 'Carry', align: 'right', cell: (s) => <span className="tabular-nums text-muted">{s.level === 1 && (s.carry_in_minor || s.carry_out_minor) ? `${formatMoney(s.carry_in_minor, s.currency)} → ${formatMoney(s.carry_out_minor, s.currency)}` : '—'}</span> },
                    { key: 'amount', header: 'Commission', align: 'right', sort: (s) => s.amount_minor, cell: (s) => <span className="font-semibold tabular-nums">{formatMoney(s.amount_minor, s.currency)}</span> },
                    { key: 'status', header: 'Status', cell: (s) => <Badge tone={tone(s.status)}>{s.status}</Badge> },
                    { key: 'act', header: '', align: 'right', cell: (s) => !write ? null : s.status === 'draft' ? <Button size="sm" variant="secondary" onClick={() => approve.mutate(s)}>Approve</Button>
                      : s.status === 'approved' && role === 'admin' ? <Button size="sm" onClick={() => setConfirm({ kind: 'pay', s })}>Pay</Button> : null },
                  ]} />
              </Section>
            </div>
          );
        }}
      </QueryView>
      <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)} busy={setStatus.isPending || pay.isPending}
        danger={confirm?.kind !== 'pay'}
        title={confirm?.kind === 'pay' ? `Pay ${formatMoney(confirm.s.amount_minor, confirm.s.currency)} to ${confirm.s.display_name ?? confirm.s.agent_id}?`
          : confirm?.kind === 'rejected' ? `Reject ${confirm.agent.display_name}’s application?` : confirm ? `Suspend ${confirm.agent.display_name}?` : ''}
        confirmLabel={confirm?.kind === 'pay' ? 'Pay commission' : confirm?.kind === 'rejected' ? 'Reject application' : 'Suspend agent'}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === 'pay') pay.mutate(confirm.s);
          else setStatus.mutate({ id: confirm.agent.user_id, status: confirm.kind });
        }}>
        {confirm?.kind === 'pay' ? <>The {confirm.s.month} level-{confirm.s.level} commission of <strong>{formatMoney(confirm.s.amount_minor, confirm.s.currency)}</strong> is credited to the agent’s wallet. A payment cannot be undone from the console.</>
          : confirm?.kind === 'rejected' ? <>The application from <strong>{confirm.agent.email}</strong> is closed and their code is never activated. They would have to apply again.</>
          : confirm ? <>The agent and their code <strong className="font-mono">{confirm.agent.code}</strong> are suspended at once. You can re-activate them later.</> : null}
      </ConfirmDialog>
      <AgentEditor agent={editing} all={q.data?.agents ?? []} caps={q.data?.caps ?? { rate_l1_bps: 4000, rate_l2_bps: 1000 }} onClose={() => setEditing(null)} />
    </>
  );
}
