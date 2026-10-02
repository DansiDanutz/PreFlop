import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Application, OrgKind } from '@preflop/client';
import { Button } from '@preflop/ui';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { fmtDate, nf } from '../../lib/format.ts';
import { isEmail } from '../../lib/rules.ts';
import { KIND_LABEL } from '../../lib/portals.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { StatusBadge } from '../../components/domain.tsx';
import { ConfirmDialog, Field, Modal, PageHeader, Pills, QueryView, Section, Select, TextInput, useAction } from '../../components/ui.tsx';

type OrgRow = Awaited<ReturnType<typeof api.adminOrgs>>['orgs'][number];

function CreateOrg({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ kind: 'club' as OrgKind, name: '', owner_email: '', city: '', country: '' });
  const [touched, setTouched] = useState(false);
  const errs = {
    name: !f.name.trim() ? 'Enter the organization name.' : null,
    owner_email: !isEmail(f.owner_email) ? 'Enter the owner’s email address.' : null,
    country: f.country && !/^[A-Za-z]{2}$/.test(f.country) ? 'Use a 2-letter ISO country code.' : null,
  };
  const create = useAction(() => api.adminCreateOrg({
    kind: f.kind, name: f.name.trim(), owner_email: f.owner_email.trim(),
    settings: { ...(f.city ? { city: f.city.trim() } : {}), ...(f.country ? { country: f.country.toUpperCase() } : {}) },
  }), { invalidate: [['admin', 'orgs']], success: `Organization created. ${f.owner_email} is its owner.`, onSuccess: () => { onClose(); setF({ kind: 'club', name: '', owner_email: '', city: '', country: '' }); setTouched(false); } });
  const submit = () => { setTouched(true); if (!Object.values(errs).some(Boolean)) create.mutate(undefined); };
  return (
    <Modal open={open} onClose={onClose} title="Create organization"
      footer={<><Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" onClick={submit} disabled={create.isPending}>Create</Button></>}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as OrgKind })}>{(['club', 'partner', 'organizer'] as const).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>}</Field>
        <Field label="Name" error={touched ? errs.name : null}>{(p) => <TextInput {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Atlas Poker Club" />}</Field>
        <Field label="Owner email" hint="The account becomes the org owner; it must already exist or will be invited." error={touched ? errs.owner_email : null}>{(p) => <TextInput {...p} type="email" value={f.owner_email} onChange={(e) => setF({ ...f, owner_email: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City (optional)">{(p) => <TextInput {...p} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />}</Field>
          <Field label="Country (optional)" error={touched ? errs.country : null}>{(p) => <TextInput {...p} maxLength={2} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} placeholder="RO" />}</Field>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function Orgs() {
  const [tab, setTab] = useState<'organizations' | 'applications'>('organizations');
  const orgs = useQuery({ queryKey: ['admin', 'orgs'], queryFn: api.adminOrgs });
  const apps = useQuery({ queryKey: ['admin', 'applications'], queryFn: api.adminApplications });
  const [creating, setCreating] = useState(false);
  const [statusTarget, setStatusTarget] = useState<OrgRow | null>(null);
  const [decision, setDecision] = useState<{ a: Application; d: 'approved' | 'rejected' } | null>(null);
  const setStatus = useAction((o: OrgRow) => api.adminSetOrgStatus(o.id, o.status === 'suspended' ? 'active' : 'suspended'), { invalidate: [['admin', 'orgs']], success: 'Organization updated.', onSuccess: () => setStatusTarget(null) });
  const decide = useAction((x: { a: Application; d: 'approved' | 'rejected' }) => api.adminDecideApplication(x.a.id, x.d), { invalidate: [['admin', 'applications'], ['admin', 'orgs']], success: (_, x) => `Application ${x.d}.`, onSuccess: () => setDecision(null) });
  const pending = apps.data?.applications.filter((a) => a.status === 'new').length ?? 0;

  return (
    <>
      <PageHeader eyebrow="People & orgs" title="Organizations" subtitle="Clubs, betting partners and organizers, and the applications to become one."
        actions={<Button size="sm" onClick={() => setCreating(true)}><Plus size={15} aria-hidden />Create organization</Button>} />
      <div className="mb-4"><Pills label="View" options={['organizations', 'applications'] as const} value={tab} onChange={setTab} render={(v) => (v === 'applications' ? `Applications${pending ? ` (${pending})` : ''}` : 'Organizations')} /></div>
      {tab === 'organizations' ? (
        <Section>
          <QueryView q={orgs} what="organizations">
            {(d) => (
              <DataTable rows={d.orgs} rowKey={(o) => o.id} caption="Organizations" initialSort={{ key: 'name', dir: 'asc' }} empty="No organizations yet."
                columns={[
                  { key: 'name', header: 'Name', sort: (o) => o.name, cell: (o) => <div><div className="font-medium">{o.name}</div><div className="font-mono text-[11px] text-faint">{o.id}</div></div> },
                  { key: 'kind', header: 'Kind', sort: (o) => o.kind, cell: (o) => KIND_LABEL[o.kind] },
                  { key: 'members', header: 'Members', align: 'right', sort: (o) => o.members, cell: (o) => nf(o.members) },
                  { key: 'where', header: 'Location', cell: (o) => [o.settings.city, o.settings.country].filter(Boolean).join(', ') || '—' },
                  { key: 'created', header: 'Created', sort: (o) => o.created_at, cell: (o) => <span className="text-xs text-muted">{fmtDate(o.created_at)}</span> },
                  { key: 'status', header: 'Status', sort: (o) => o.status, cell: (o) => <StatusBadge status={o.status} /> },
                  { key: 'act', header: <span className="sr-only">Actions</span>, align: 'right', cell: (o) => <Button size="sm" variant={o.status === 'suspended' ? 'secondary' : 'ghost'} className={o.status === 'suspended' ? '' : '!text-danger'} onClick={() => setStatusTarget(o)}>{o.status === 'suspended' ? 'Reactivate' : 'Suspend'}</Button> },
                ]} />
            )}
          </QueryView>
        </Section>
      ) : (
        <Section>
          <QueryView q={apps} what="applications">
            {(d) => (
              <DataTable rows={d.applications} rowKey={(a) => a.id} caption="Applications" initialSort={{ key: 'created', dir: 'desc' }} empty="No applications."
                columns={[
                  { key: 'name', header: 'Applicant', sort: (a) => a.name, cell: (a) => <div><div className="font-medium">{a.name}</div><div className="text-xs text-muted">{a.email}</div></div> },
                  { key: 'kind', header: 'Kind', sort: (a) => a.kind, cell: (a) => KIND_LABEL[a.kind] },
                  { key: 'details', header: 'Details', cell: (a) => <code className="line-clamp-2 max-w-sm break-all font-mono text-[11.5px] text-muted">{JSON.stringify(a.details)}</code> },
                  { key: 'created', header: 'Received', sort: (a) => a.created_at, cell: (a) => <span className="text-xs text-muted">{fmtDate(a.created_at)}</span> },
                  { key: 'status', header: 'Status', sort: (a) => a.status, cell: (a) => <StatusBadge status={a.status} /> },
                  {
                    key: 'act', header: <span className="sr-only">Actions</span>, align: 'right', cell: (a) => a.status === 'new' ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => setDecision({ a, d: 'approved' })}>Approve</Button>
                        <Button size="sm" variant="ghost" className="!text-danger" onClick={() => setDecision({ a, d: 'rejected' })}>Reject</Button>
                      </div>
                    ) : null,
                  },
                ]} />
            )}
          </QueryView>
        </Section>
      )}
      <CreateOrg open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog open={!!statusTarget} onClose={() => setStatusTarget(null)} busy={setStatus.isPending} danger={statusTarget?.status !== 'suspended'}
        title={statusTarget?.status === 'suspended' ? `Reactivate ${statusTarget?.name}?` : `Suspend ${statusTarget?.name}?`} confirmLabel={statusTarget?.status === 'suspended' ? 'Reactivate' : 'Suspend'}
        onConfirm={() => statusTarget && setStatus.mutate(statusTarget)}>
        {statusTarget?.status === 'suspended' ? 'Members regain access to the portal.' : 'Members lose access to the portal, its rooms close to new bets and its tables pause. Open bets still settle.'}
      </ConfirmDialog>
      <ConfirmDialog open={!!decision} onClose={() => setDecision(null)} busy={decide.isPending} danger={decision?.d === 'rejected'}
        title={`${decision?.d === 'approved' ? 'Approve' : 'Reject'} ${decision?.a.name}?`} confirmLabel={decision?.d === 'approved' ? 'Approve' : 'Reject'}
        onConfirm={() => decision && decide.mutate(decision)}>
        {decision?.d === 'approved' ? <>A {decision && KIND_LABEL[decision.a.kind].toLowerCase()} organization is created with <strong>{decision?.a.email}</strong> as owner.</> : 'The applicant is notified that the application was not accepted.'}
      </ConfirmDialog>
    </>
  );
}
