import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OrgRole } from '@preflop/client';
import { Button } from '@preflop/ui';
import { Download, UserPlus } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { downloadText, minorToDecimal, toCsv } from '../../lib/csv.ts';
import { nf } from '../../lib/format.ts';
import { isEmail } from '../../lib/rules.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { Money, StatusBadge } from '../../components/domain.tsx';
import { useCanWrite, useOrgId, usePortal } from '../../components/Shell.tsx';
import { Field, Modal, PageHeader, QueryView, Section, Select, TextInput, useAction } from '../../components/ui.tsx';

const ROLE_HINT: Record<OrgRole, string> = { owner: 'Everything, including members', admin: 'Manage tables, rooms and money', viewer: 'Read-only' };

export function Members() {
  const id = useOrgId();
  const portal = usePortal();
  const write = useCanWrite();
  const q = useQuery({ queryKey: ['org', id, 'members'], queryFn: () => api.orgMembers(id) });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ email: string; role: OrgRole }>({ email: '', role: 'viewer' });
  const [touched, setTouched] = useState(false);
  const err = !isEmail(f.email) ? 'Enter the person’s email address.' : null;
  const add = useAction(() => api.orgAddMember(id, { email: f.email.trim(), role: f.role }), {
    invalidate: [['org', id, 'members']], success: `${f.email} added as ${f.role}.`,
    onSuccess: () => { setOpen(false); setF({ email: '', role: 'viewer' }); setTouched(false); },
  });
  const submit = () => { setTouched(true); if (!err) add.mutate(undefined); };
  return (
    <>
      <PageHeader eyebrow={portal.name} title="Members" subtitle="People who can open this portal. They sign in with their own PreFlop account."
        actions={write && <Button size="sm" onClick={() => setOpen(true)}><UserPlus size={15} aria-hidden />Add member</Button>} />
      <Section>
        <QueryView q={q} what="members">
          {(d) => (
            <DataTable rows={d.members} rowKey={(m) => m.user_id} caption="Members" initialSort={{ key: 'name', dir: 'asc' }} empty="No members yet."
              columns={[
                { key: 'name', header: 'Name', sort: (m) => m.display_name, cell: (m) => <div><div className="font-medium">{m.display_name}</div><div className="text-xs text-muted">{m.email}</div></div> },
                { key: 'role', header: 'Role', sort: (m) => m.role, cell: (m) => <div><StatusBadge status={m.role} /><div className="mt-1 text-xs text-faint">{ROLE_HINT[m.role]}</div></div> },
              ]} />
          )}
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
    </>
  );
}

export function Players() {
  const id = useOrgId();
  const portal = usePortal();
  const q = useQuery({ queryKey: ['org', id, 'players'], queryFn: () => api.orgPlayers(id) });
  const exportCsv = () => q.data && downloadText(`${portal.name.replace(/\W+/g, '-').toLowerCase()}-players.csv`, toCsv(q.data.players, [
    { header: 'email', value: (p) => p.email }, { header: 'name', value: (p) => p.display_name }, { header: 'currency', value: (p) => p.currency },
    { header: 'balance', value: (p) => minorToDecimal(p.balance_minor, p.currency) }, { header: 'bets', value: (p) => p.bets },
  ]));
  return (
    <>
      <PageHeader eyebrow={portal.name} title="Players" subtitle="Players who joined your rooms or received your chips or diamonds."
        actions={<Button size="sm" variant="secondary" onClick={exportCsv} disabled={!q.data?.players.length}><Download size={14} aria-hidden />Export CSV</Button>} />
      <Section>
        <QueryView q={q} what="players">
          {(d) => (
            <DataTable rows={d.players} rowKey={(p) => `${p.user_id}:${p.currency}`} caption="Players" initialSort={{ key: 'bets', dir: 'desc' }} empty="No players yet. Transfer chips or share a room invite to bring them in."
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
