import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PlatformRole, User } from '@preflop/client';
import { Button } from '@preflop/ui';
import { Search } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { defined, fmtDate, nf } from '../../lib/format.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { StatusBadge } from '../../components/domain.tsx';
import { ConfirmDialog, PageHeader, QueryView, Section, Select, TextInput, useAction } from '../../components/ui.tsx';

type Change = { user: User; patch: Partial<Pick<User, 'status' | 'kyc_status' | 'platform_role'>>; label: string };

export function Users() {
  const { me } = useAuth();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { const t = setTimeout(() => setQuery(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const q = useQuery({ queryKey: ['admin', 'users', query], queryFn: () => api.adminUsers(defined({ q: query, limit: 200 })), placeholderData: keepPreviousData });
  const [change, setChange] = useState<Change | null>(null);
  const update = useAction((c: Change) => api.adminUpdateUser(c.user.id, c.patch), { invalidate: [['admin', 'users']], success: (_, c) => `${c.user.email}: ${c.label}.`, onSuccess: () => setChange(null) });
  const isAdmin = me?.platform_role === 'admin';

  return (
    <>
      <PageHeader eyebrow="People & orgs" title="Users" subtitle="Players and staff accounts. Status, KYC and PreFlop team roles are audited." />
      <Section>
        <div className="relative mb-4 max-w-md">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <TextInput aria-label="Search users" className="pl-9" placeholder="Search by email or name" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <QueryView q={q} what="users">
          {(d) => (
            <DataTable rows={d.users} rowKey={(u) => u.id} caption="Users" initialSort={{ key: 'created', dir: 'desc' }}
              empty={query ? `No users match “${query}”.` : 'No users yet.'}
              columns={[
                { key: 'user', header: 'User', sort: (u) => u.email, cell: (u) => <div><div className="font-medium">{u.display_name}</div><div className="text-xs text-muted">{u.email}</div></div> },
                { key: 'country', header: 'Country', sort: (u) => u.country, cell: (u) => u.country ?? '—' },
                { key: 'bets', header: 'Bets', align: 'right', sort: (u) => u.bets, cell: (u) => nf(u.bets) },
                { key: 'created', header: 'Joined', sort: (u) => u.created_at, cell: (u) => <span className="text-xs text-muted">{fmtDate(u.created_at)}</span> },
                {
                  key: 'kyc', header: 'KYC', sort: (u) => u.kyc_status, cell: (u) => (
                    <Select aria-label={`KYC status for ${u.email}`} className="!h-8 w-32 text-xs" value={u.kyc_status}
                      onChange={(e) => setChange({ user: u, patch: { kyc_status: e.target.value as User['kyc_status'] }, label: `KYC set to ${e.target.value}` })}>
                      {['none', 'pending', 'verified', 'rejected'].map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  ),
                },
                {
                  key: 'role', header: 'Team role', sort: (u) => u.platform_role ?? '', cell: (u) => (
                    <Select aria-label={`PreFlop team role for ${u.email}`} className="!h-8 w-28 text-xs" value={u.platform_role ?? ''} disabled={!isAdmin || u.id === me?.id}
                      onChange={(e) => setChange({ user: u, patch: { platform_role: (e.target.value || null) as PlatformRole | null }, label: e.target.value ? `team role set to ${e.target.value}` : 'team role removed' })}>
                      <option value="">—</option>
                      {['admin', 'ops', 'risk', 'support'].map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  ),
                },
                { key: 'status', header: 'Status', sort: (u) => u.status, cell: (u) => <StatusBadge status={u.status} /> },
                {
                  key: 'act', header: <span className="sr-only">Actions</span>, align: 'right', cell: (u) => u.id === me?.id ? <span className="text-xs text-faint">You</span> :
                    u.status === 'suspended'
                      ? <Button size="sm" variant="secondary" onClick={() => setChange({ user: u, patch: { status: 'active' }, label: 'reactivated' })}>Activate</Button>
                      : u.status === 'active' ? <Button size="sm" variant="ghost" className="!text-danger" onClick={() => setChange({ user: u, patch: { status: 'suspended' }, label: 'suspended' })}>Suspend</Button> : null,
                },
              ]} />
          )}
        </QueryView>
      </Section>
      <ConfirmDialog open={!!change} onClose={() => setChange(null)} busy={update.isPending}
        danger={change?.patch.status === 'suspended' || change?.patch.platform_role !== undefined}
        title={`Update ${change?.user.email ?? ''}?`} confirmLabel="Apply" onConfirm={() => change && update.mutate(change)}>
        <strong>{change?.user.display_name}</strong> will be {change?.label}.
        {change?.patch.status === 'suspended' && ' A suspended user cannot sign in or place bets; open bets still settle.'}
        {change?.patch.platform_role !== undefined && ' Team roles grant back-office access.'}
      </ConfirmDialog>
    </>
  );
}
