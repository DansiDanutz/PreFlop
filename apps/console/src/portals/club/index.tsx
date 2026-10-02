import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ClubTable, PlayMode, StaffCredential } from '@preflop/client';
import { Button, Card, formatMoney } from '@preflop/ui';
import { KeyRound, Plus, Radio } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { fmtDate, MODE_LABEL, pad3, relTime } from '../../lib/format.ts';
import { currencyForMode, isPublicKeyPem } from '../../lib/rules.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { KindChip, MiniFlop, Problems, RoundStateBadge, StatusBadge, TableStatus } from '../../components/domain.tsx';
import { CertBadge, CertChecklist, LinkHealth } from '../../components/tables.tsx';
import { useCanWrite, useOrgId, usePortal } from '../../components/Shell.tsx';
import { Callout, ConfirmDialog, Field, Mono, Modal, PageHeader, QueryView, Section, Select, TextArea, TextInput, useAction } from '../../components/ui.tsx';

// ------------------------------------------------------------------ tables

function CreateTable({ open, onClose, physicalEnabled }: { open: boolean; onClose: () => void; physicalEnabled: boolean }) {
  const id = useOrgId();
  const [f, setF] = useState<{ name: string; kind: 'physical' | 'simulated'; mode: PlayMode; currency: string }>({ name: '', kind: 'simulated', mode: 'play', currency: 'PLAY' });
  const [touched, setTouched] = useState(false);
  const err = !f.name.trim() ? 'Name the table, e.g. “Table 05”.' : f.name.trim().length > 40 ? 'Keep it under 40 characters.' : null;
  const create = useAction(() => api.clubCreateTable(id, { name: f.name.trim(), kind: f.kind, mode: f.mode, currency: f.currency }), {
    invalidate: [['org', id, 'tables']], success: `Table “${f.name}” created. Complete its certification before it can deal.`,
    onSuccess: () => { onClose(); setF({ name: '', kind: 'simulated', mode: 'play', currency: 'PLAY' }); setTouched(false); },
  });
  const submit = () => { setTouched(true); if (!err) create.mutate(undefined); };
  return (
    <Modal open={open} onClose={onClose} title="Create table"
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" onClick={submit} disabled={create.isPending}>Create table</Button></>}>
      <form noValidate className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Name" error={touched ? err : null}>{(p) => <TextInput {...p} autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Table 05" />}</Field>
        <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}><option value="simulated">Simulated (random flops every ~20 s)</option><option value="physical">Physical (live dealer, Table Box, Trusted Shuffler)</option></Select>}</Field>
        {f.kind === 'physical' && !physicalEnabled && (
          <Callout tone="warn" title="Physical tables cannot open yet">Physical-table play is disabled until the PreFlop Trusted Shuffler is certified. You can create and certify the table now; it will not open rounds until PreFlop enables physical play.</Callout>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mode">{(p) => <Select {...p} value={f.mode} onChange={(e) => { const mode = e.target.value as PlayMode; setF({ ...f, mode, currency: currencyForMode(mode) }); }}>{(['play', 'virtual-chips', 'diamonds', 'real-fiat', 'real-crypto'] as PlayMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</Select>}</Field>
          <Field label="Currency">{(p) => <Select {...p} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} disabled={f.mode !== 'real-crypto'}>{(f.mode === 'real-crypto' ? ['USDT', 'USDC'] : [currencyForMode(f.mode)]).map((c) => <option key={c} value={c}>{c}</option>)}</Select>}</Field>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function ClubTableCard({ t }: { t: ClubTable }) {
  const id = useOrgId();
  const write = useCanWrite();
  const [busy, setBusy] = useState<string | null>(null);
  const [revokeKey, setRevokeKey] = useState<string | null>(null);
  const certify = useAction((x: { key: string; ok: boolean }) => api.clubCertify(id, t.id, { [x.key]: x.ok }), {
    invalidate: [['org', id, 'tables']], success: (_, x) => `${x.key} ${x.ok ? 'certified' : 'withdrawn'} on ${t.name}.`,
    onSuccess: () => { setBusy(null); setRevokeKey(null); },
  });
  const toggle = (key: string, ok: boolean) => { if (!ok) { setRevokeKey(key); return; } setBusy(key); certify.mutate({ key, ok }, { onSettled: () => setBusy(null) }); };
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <div className="flex items-center gap-2 font-serif text-2xl">{t.name}<KindChip kind={t.kind} /></div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted"><TableStatus t={t} /><span>{MODE_LABEL[t.mode]} · {t.currency}</span>{t.stream_live ? <span className="inline-flex items-center gap-1"><Radio size={13} className="text-live" aria-hidden />Stream live</span> : <span className="text-danger">Stream off air</span>}</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right text-xs text-muted">
            {t.current_round ? <div className="flex items-center justify-end gap-2">Hand #{pad3(t.current_round.hand_no)}<RoundStateBadge state={t.current_round.state} /></div> : 'No round'}
            <div className="mt-1">Round loss limit {formatMoney(t.max_round_loss_minor, t.currency)}</div>
          </div>
          <div className="felt rounded-[12px] p-2"><MiniFlop cards={t.last_flop?.cards} /></div>
        </div>
      </div>
      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between"><h3 className="font-serif text-lg">Certification</h3><CertBadge cert={t.certification} /></div>
          <CertChecklist cert={t.certification} {...(write ? { onToggle: toggle } : {})} busyKey={busy} />
        </div>
        <div className="space-y-5">
          <div><h3 className="mb-2 font-serif text-lg">Readiness</h3><Problems problems={t.problems} /></div>
          <div><h3 className="mb-2 font-serif text-lg">Link health</h3><LinkHealth link={t.link} at={t.link_at} /></div>
        </div>
      </div>
      <ConfirmDialog open={!!revokeKey} onClose={() => setRevokeKey(null)} busy={certify.isPending} title={`Withdraw “${revokeKey}”?`} confirmLabel="Withdraw"
        onConfirm={() => revokeKey && certify.mutate({ key: revokeKey, ok: false })}>
        <strong>{t.name}</strong> stops opening rounds until this item is certified again.
      </ConfirmDialog>
    </Card>
  );
}

export function Tables() {
  const portal = usePortal();
  const id = useOrgId();
  const write = useCanWrite();
  const q = useQuery({ queryKey: ['org', id, 'tables'], queryFn: () => api.clubTables(id), refetchInterval: 5000 });
  const modes = useQuery({ queryKey: ['modes'], queryFn: api.modes, staleTime: 60_000 });
  const [creating, setCreating] = useState(false);
  const physicalEnabled = modes.data?.physical_play_enabled ?? false;
  return (
    <>
      <PageHeader eyebrow={portal.name} title="Tables" subtitle="A table opens rounds only when all 9 certification items are valid, its heartbeat is healthy and the stream is live."
        actions={write && <Button size="sm" onClick={() => setCreating(true)}><Plus size={15} aria-hidden />Create table</Button>} />
      {!physicalEnabled && <div className="mb-4"><Callout tone="info" title="Physical-table play is disabled">Until the PreFlop Trusted Shuffler is certified, only simulated tables deal. Physical tables can be created and certified now.</Callout></div>}
      <QueryView q={q} what="your tables">
        {(d) => d.tables.length === 0
          ? <div className="rounded-[18px] border border-dashed border-line-strong p-10 text-center text-sm text-muted">No tables yet. Create one to start certification.</div>
          : <div className="space-y-4">{d.tables.map((t) => <ClubTableCard key={t.id} t={t} />)}</div>}
      </QueryView>
      <CreateTable open={creating} onClose={() => setCreating(false)} physicalEnabled={physicalEnabled} />
    </>
  );
}

// ------------------------------------------------------------------ staff & devices

const ROLE_LABEL: Record<StaffCredential['role'], string> = { dealer: 'Dealer', floor: 'Floor', floor_manager: 'Floor manager' };

function EnrollStaff({ open, onClose, tables }: { open: boolean; onClose: () => void; tables: { id: string; name: string }[] }) {
  const id = useOrgId();
  const [f, setF] = useState<{ table_id: string; person_id: string; role: StaffCredential['role']; pem: string }>({ table_id: '', person_id: '', role: 'dealer', pem: '' });
  const [touched, setTouched] = useState(false);
  const errs = {
    table_id: !f.table_id ? 'Pick the table this credential is scoped to.' : null,
    person_id: !/^[A-Za-z0-9._:-]{2,64}$/.test(f.person_id.trim()) ? 'Use the staff member’s ID (2–64 letters, digits, . _ : -).' : null,
    pem: !isPublicKeyPem(f.pem) ? 'Paste the full PUBLIC KEY block, from -----BEGIN PUBLIC KEY----- to -----END PUBLIC KEY-----.' : null,
  };
  const enroll = useAction(() => api.clubEnrollStaff(id, { table_id: f.table_id, person_id: f.person_id.trim(), role: f.role, public_key_pem: f.pem.trim() }), {
    invalidate: [['org', id, 'staff']], success: (c) => `${ROLE_LABEL[c.role]} ${c.person_id} enrolled. The tablet can now sign in.`,
    onSuccess: () => { onClose(); setF({ table_id: '', person_id: '', role: 'dealer', pem: '' }); setTouched(false); },
  });
  const submit = () => { setTouched(true); if (!Object.values(errs).some(Boolean)) enroll.mutate(undefined); };
  return (
    <Modal open={open} onClose={onClose} wide title="Enroll a staff credential"
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" onClick={submit} disabled={enroll.isPending}>Enroll credential</Button></>}>
      <form noValidate className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Callout tone="info" icon={<KeyRound size={16} />} title="How enrollment works">
          On the club tablet, open <strong>Enrollment</strong>. The tablet generates an Ed25519 key pair; the private key never leaves the device. Paste the <strong>public key</strong> it shows below. One credential per person, role and table; roles are separated (a dealer can never confirm the floor entry).
        </Callout>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Table" error={touched ? errs.table_id : null}>{(p) => <Select {...p} value={f.table_id} onChange={(e) => setF({ ...f, table_id: e.target.value })}><option value="">Choose…</option>{tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>
          <Field label="Person ID" error={touched ? errs.person_id : null}>{(p) => <TextInput {...p} value={f.person_id} onChange={(e) => setF({ ...f, person_id: e.target.value })} placeholder="dealer-ana" />}</Field>
          <Field label="Role">{(p) => <Select {...p} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as StaffCredential['role'] })}>{(Object.keys(ROLE_LABEL) as StaffCredential['role'][]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>}</Field>
        </div>
        <Field label="Public key (PEM)" error={touched ? errs.pem : null}>{(p) => <TextArea {...p} rows={5} spellCheck={false} value={f.pem} onChange={(e) => setF({ ...f, pem: e.target.value })} placeholder={'-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA…\n-----END PUBLIC KEY-----'} />}</Field>
        <p className="text-xs text-faint">Floor managers settle or void rounds in REVIEW on the tablet, and must not be the person who entered either flop for that round.</p>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function Staff() {
  const portal = usePortal();
  const id = useOrgId();
  const write = useCanWrite();
  const q = useQuery({ queryKey: ['org', id, 'staff'], queryFn: () => api.clubStaff(id) });
  const tables = useQuery({ queryKey: ['org', id, 'tables'], queryFn: () => api.clubTables(id) });
  const [enrolling, setEnrolling] = useState(false);
  const [revoke, setRevoke] = useState<StaffCredential | null>(null);
  const doRevoke = useAction((c: StaffCredential) => api.clubRevokeStaff(id, c.id), { invalidate: [['org', id, 'staff']], success: (_, c) => `Credential for ${c.person_id} revoked.`, onSuccess: () => setRevoke(null) });
  const tname = new Map(tables.data?.tables.map((t) => [t.id, t.name]) ?? []);
  return (
    <>
      <PageHeader eyebrow={portal.name} title="Staff & devices" subtitle="Signing credentials for dealers, floor staff and floor managers, and the Table Boxes that sign flop captures."
        actions={write && <Button size="sm" onClick={() => setEnrolling(true)}><Plus size={15} aria-hidden />Enroll staff</Button>} />
      <QueryView q={q} what="staff credentials">
        {(d) => (
          <div className="space-y-4">
            <Section title="Staff credentials">
              <DataTable rows={d.credentials} rowKey={(c) => c.id} caption="Staff credentials" initialSort={{ key: 'table', dir: 'asc' }} empty="No staff enrolled yet."
                rowClassName={(c) => (c.revoked ? 'opacity-55' : undefined)}
                columns={[
                  { key: 'person', header: 'Person', sort: (c) => c.person_id, cell: (c) => <Mono>{c.person_id}</Mono> },
                  { key: 'role', header: 'Role', sort: (c) => c.role, cell: (c) => ROLE_LABEL[c.role] },
                  { key: 'table', header: 'Table', sort: (c) => tname.get(c.table_id) ?? c.table_id, cell: (c) => tname.get(c.table_id) ?? <Mono>{c.table_id}</Mono> },
                  { key: 'created', header: 'Enrolled', sort: (c) => c.created_at, cell: (c) => <span className="text-xs text-muted">{fmtDate(c.created_at)}</span> },
                  { key: 'status', header: 'Status', sort: (c) => String(c.revoked), cell: (c) => <StatusBadge status={c.revoked ? 'revoked' : 'active'} /> },
                  { key: 'act', header: <span className="sr-only">Actions</span>, align: 'right', cell: (c) => !c.revoked && write ? <Button size="sm" variant="ghost" className="!text-danger" onClick={() => setRevoke(c)}>Revoke</Button> : null },
                ]} />
            </Section>
            <Section title="Table Boxes" subtitle="Each box signs captures with a TPM-held Ed25519 key; seq must increase by exactly 1.">
              <DataTable rows={d.devices} rowKey={(x) => x.id} caption="Devices" dense empty="No Table Box paired."
                columns={[
                  { key: 'id', header: 'Device', sort: (x) => x.id, cell: (x) => <Mono>{x.id}</Mono> },
                  { key: 'table', header: 'Table', sort: (x) => tname.get(x.table_id) ?? x.table_id, cell: (x) => tname.get(x.table_id) ?? <Mono>{x.table_id}</Mono> },
                  { key: 'seq', header: 'Last seq', align: 'right', sort: (x) => x.last_seq, cell: (x) => x.last_seq },
                  { key: 'created', header: 'Paired', sort: (x) => x.created_at, cell: (x) => <span className="text-xs text-muted">{relTime(x.created_at)}</span> },
                  { key: 'status', header: 'Status', cell: (x) => <StatusBadge status={x.revoked ? 'revoked' : 'active'} /> },
                ]} />
            </Section>
          </div>
        )}
      </QueryView>
      <EnrollStaff open={enrolling} onClose={() => setEnrolling(false)} tables={tables.data?.tables.map((t) => ({ id: t.id, name: t.name })) ?? []} />
      <ConfirmDialog open={!!revoke} onClose={() => setRevoke(null)} busy={doRevoke.isPending} title={`Revoke ${revoke?.person_id}?`} confirmLabel="Revoke credential"
        onConfirm={() => revoke && doRevoke.mutate(revoke)}>
        The {revoke ? ROLE_LABEL[revoke.role].toLowerCase() : ''} credential stops working immediately; any request it signs is rejected. To restore access, enroll a new key.
      </ConfirmDialog>
    </>
  );
}
