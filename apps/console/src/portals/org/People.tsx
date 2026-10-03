import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OrgRole } from '@preflop/client';
import { Button } from '@preflop/ui';
import { Download, UserMinus, UserPlus } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { downloadText, minorToDecimal, toCsv } from '../../lib/csv.ts';
import { nf } from '../../lib/format.ts';
import { isEmail } from '../../lib/rules.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { Money, StatusBadge } from '../../components/domain.tsx';
import { useCanWrite, useOrgId, usePortal } from '../../components/Shell.tsx';
import { ConfirmDialog, Field, Modal, PageHeader, QueryView, Section, Select, TextInput, useAction } from '../../components/ui.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { memberActions } from '../../lib/members.ts';

const ROLE_HINT: Record<OrgRole, string> = { owner: 'Everything, including members', admin: 'Manage tables, rooms and money', viewer: 'Read-only' };

type MemberRow = Awaited<ReturnType<typeof api.orgMembers>>['members'][number];
type Pending = { kind: 'role'; m: MemberRow; role: OrgRole } | { kind: 'remove'; m: MemberRow } | null;

export function Members() {
  const id = useOrgId();
  const portal = usePortal();
  const write = useCanWrite();
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['org', id, 'members'], queryFn: () => api.orgMembers(id) });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ email: string; role: OrgRole }>({ email: '', role: 'viewer' });
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const err = !isEmail(f.email) ? 'Enter the person’s email address.' : null;
  const add = useAction(() => api.orgAddMember(id, { email: f.email.trim(), role: f.role }), {
    invalidate: [['org', id, 'members']], success: `${f.email} added as ${f.role}.`,
    onSuccess: () => { setOpen(false); setF({ email: '', role: 'viewer' }); setTouched(false); },
  });
  const change = useAction((p: NonNullable<Pending>) => (p.kind === 'role' ? api.orgSetMemberRole(id, p.m.user_id, p.role) : api.orgRemoveMember(id, p.m.user_id)), {
    invalidate: [['org', id, 'members'], ['me']],
    success: (_r, p) => (p.kind === 'role' ? `${p.m.display_name} is now ${p.role}.` : `${p.m.display_name} was removed.`),
    onSuccess: () => setPending(null),
  });
  const submit = () => { setTouched(true); if (!err) add.mutate(undefined); };
  const self = (m: MemberRow) => m.user_id === me?.id;
  return (
    <>
      <PageHeader eyebrow={portal.name} title="Members" subtitle="People who can open this portal. They sign in with their own PreFlop account."
        actions={write && <Button size="sm" onClick={() => setOpen(true)}><UserPlus size={15} aria-hidden />Add member</Button>} />
      <Section>
        <QueryView q={q} what="members">
          {(d) => {
            const owners = d.members.filter((m) => m.role === 'owner').length;
            return (
              <DataTable rows={d.members} rowKey={(m) => m.user_id} caption="Members" initialSort={{ key: 'name', dir: 'asc' }} empty="No members yet."
                columns={[
                  { key: 'name', header: 'Name', sort: (m) => m.display_name, cell: (m) => <div><div className="font-medium">{m.display_name}{self(m) && <span className="ml-1.5 text-xs text-muted">(you)</span>}</div><div className="text-xs text-muted">{m.email}</div></div> },
                  { key: 'role', header: 'Role', sort: (m) => m.role, cell: (m) => <div><StatusBadge status={m.role} /><div className="mt-1 text-xs text-faint">{ROLE_HINT[m.role]}</div></div> },
                  ...(write ? [{
                    key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right' as const,
                    cell: (m: MemberRow) => {
                      const a = memberActions(m, { role: portal.role, write }, owners);
                      if (!a.canChange && !a.canRemove) return a.note ? <span className="text-xs text-faint">{a.note}</span> : null;
                      return (
                        <div className="flex items-center justify-end gap-2">
                          <label className="sr-only" htmlFor={`role-${m.user_id}`}>Role of {m.display_name}</label>
                          <select id={`role-${m.user_id}`} value={m.role} disabled={!a.canChange || change.isPending}
                            onChange={(e) => setPending({ kind: 'role', m, role: e.target.value as OrgRole })}
                            className="h-8 rounded-[8px] border border-line-strong bg-surface-2 px-2 text-sm text-ink">
                            {a.roles.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <Button size="sm" variant="secondary" disabled={!a.canRemove || change.isPending} onClick={() => setPending({ kind: 'remove', m })}
                            aria-label={`Remove ${m.display_name}`}><UserMinus size={14} aria-hidden />Remove</Button>
                        </div>
                      );
                    },
                  }] : []),
                ]} />
            );
          }}
        </QueryView>
      </Section>
      <Modal open={open} onClose={() => setOpen(false)} title="Add member"
        footer={<><Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button size="sm" onClick={submit} disabled={add.isPending}>Add member</Button></>}>
        <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Field label="Email" error={touched ? err : null} hint="They need a PreFlop account with this email.">{(p) => <TextInput {...p} type="email" autoFocus value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label="Role" hint={ROLE_HINT[f.role]}>{(p) => <Select {...p} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as OrgRole })}>{(['viewer', 'admin', 'owner'] as const).map((r) => <option key={r} value={r}>{r}</option>)}</Select>}</Field>
          <button type="submit" hidden />
        </form>
      </Modal>
      <ConfirmDialog open={pending !== null} onClose={() => setPending(null)} busy={change.isPending} danger={pending?.kind === 'remove' || (pending?.kind === 'role' && self(pending.m))}
        title={pending?.kind === 'remove' ? `Remove ${pending.m.display_name}?` : pending ? `Make ${pending.m.display_name} ${pending.role}?` : ''}
        confirmLabel={pending?.kind === 'remove' ? 'Remove member' : 'Change role'}
        onConfirm={() => pending && change.mutate(pending)}>
        {pending?.kind === 'remove'
          ? <>{self(pending.m) ? 'You will lose access to this portal at once.' : <><strong>{pending.m.email}</strong> loses access to this portal at once.</>} The change is recorded in the audit log.</>
          : pending ? <><strong>{pending.m.display_name}</strong> goes from {pending.m.role} to <strong>{pending.role}</strong>: {ROLE_HINT[pending.role].toLowerCase()}.{self(pending.m) ? ' This is your own role.' : ''} The change is recorded in the audit log.</> : null}
      </ConfirmDialog>
    </>
  );
}

type PlayerApiRow = Awaited<ReturnType<typeof api.orgPlayers>>['players'][number];
/** One player in one currency: what the table and the CSV show. */
export interface PlayerRow { user_id: string; email: string | null; display_name: string; mode: string | null; currency: string; balance_minor: number; bets: number }

/**
 * Normalises GET /org/:id/players to one row per player and currency. Older servers send one row
 * per player and currency already; newer ones may nest `balances: [{ currency, mode, amount_minor }]`.
 * Balances are never added across currencies.
 */
export function playerRows(players: readonly PlayerApiRow[]): PlayerRow[] {
  return players.flatMap((p) => {
    const x = p as PlayerApiRow & { mode?: string | null; balances?: { currency: string; mode?: string | null; amount_minor: number }[] };
    const base = { user_id: p.user_id, email: p.email, display_name: p.display_name, bets: Number(p.bets) || 0 };
    if (Array.isArray(x.balances) && x.balances.length) {
      return x.balances.map((b) => ({ ...base, mode: b.mode ?? null, currency: b.currency, balance_minor: Number(b.amount_minor) }));
    }
    return [{ ...base, mode: x.mode ?? null, currency: p.currency, balance_minor: Number(p.balance_minor) }];
  });
}

/** CSV export: one line per player and currency, amounts as decimals of that currency (never a cross-currency sum). */
export function playersCsv(rows: readonly PlayerRow[]): string {
  return toCsv(rows, [
    { header: 'email', value: (p) => p.email }, { header: 'name', value: (p) => p.display_name },
    { header: 'mode', value: (p) => p.mode }, { header: 'currency', value: (p) => p.currency },
    { header: 'balance', value: (p) => minorToDecimal(p.balance_minor, p.currency) }, { header: 'bets', value: (p) => p.bets },
  ]);
}

export function Players() {
  const id = useOrgId();
  const portal = usePortal();
  const q = useQuery({ queryKey: ['org', id, 'players'], queryFn: () => api.orgPlayers(id) });
  const rows = useMemo(() => playerRows(q.data?.players ?? []), [q.data]);
  const exportCsv = () => q.data && downloadText(`${portal.name.replace(/\W+/g, '-').toLowerCase()}-players.csv`, playersCsv(rows));
  return (
    <>
      <PageHeader eyebrow={portal.name} title="Players" subtitle="Players who joined your rooms or received your chips or diamonds."
        actions={<Button size="sm" variant="secondary" onClick={exportCsv} disabled={!q.data?.players.length}><Download size={14} aria-hidden />Export CSV</Button>} />
      <Section>
        <QueryView q={q} what="players">
          {(d) => (
            <DataTable rows={d.players.length ? rows : []} rowKey={(p) => `${p.user_id}:${p.mode ?? ''}:${p.currency}`} caption="Players" initialSort={{ key: 'bets', dir: 'desc' }} empty="No players yet. Transfer chips or share a room invite to bring them in."
              columns={[
                { key: 'name', header: 'Player', sort: (p) => p.display_name, cell: (p) => <div><div className="font-medium">{p.display_name}</div><div className="text-xs text-muted">{p.email}</div></div> },
                { key: 'bets', header: 'Bets', align: 'right', sort: (p) => p.bets, cell: (p) => nf(p.bets) },
                { key: 'bal', header: 'Balance', align: 'right', sort: (p) => p.balance_minor, cell: (p) => <Money minor={p.balance_minor} currency={p.currency} /> },
              ]} />
          )}
        </QueryView>
      </Section>
    </>
  );
}
