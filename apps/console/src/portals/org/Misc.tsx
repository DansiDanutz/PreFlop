import { useEffect, useState } from 'react';
import { defined } from '../../lib/format.ts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button } from '@preflop/ui';
import { api } from '../../lib/api.ts';
import { isEmail } from '../../lib/rules.ts';
import { RoundFilters, RoundsTable } from '../../components/rounds.tsx';
import { useCanWrite, useOrgId, usePortal } from '../../components/Shell.tsx';
import { Field, PageHeader, QueryView, Section, TextInput, useAction } from '../../components/ui.tsx';

export function HandLog() {
  const id = useOrgId();
  const portal = usePortal();
  const [f, setF] = useState({ tableId: '', state: '', limit: 100 });
  const tables = useQuery({ queryKey: ['org', id, 'tables'], queryFn: () => api.clubTables(id), staleTime: 30_000 });
  const q = useQuery({
    queryKey: ['org', id, 'rounds', f],
    queryFn: () => api.orgRounds(id, defined({ table_id: f.tableId, state: f.state, limit: f.limit })),
    placeholderData: keepPreviousData, refetchInterval: 15_000,
  });
  const names = new Map(tables.data?.tables.map((t) => [t.id, t.name]) ?? []);
  return (
    <>
      <PageHeader eyebrow={portal.name} title="Hand log" subtitle="Every hand your tables dealt, its flop and the money on it. Voided hands show why; every bet on them was refunded." />
      <Section>
        <RoundFilters tableId={f.tableId} state={f.state} limit={f.limit} onChange={setF} tables={tables.data?.tables.map((t) => ({ id: t.id, name: t.name })) ?? []} />
        <QueryView q={q} what="the hand log">
          {(d) => <RoundsTable rows={d.rounds.map((r) => ({ ...r, table_name: names.get(r.table_id) ?? r.table_id }))} />}
        </QueryView>
      </Section>
    </>
  );
}

type Form = { name: string; city: string; country: string; contact_name: string; contact_email: string; contact_phone: string };

export function OrgSettings() {
  const id = useOrgId();
  const portal = usePortal();
  const write = useCanWrite();
  const q = useQuery({ queryKey: ['org', id, 'overview'], queryFn: () => api.orgOverview(id) });
  const [f, setF] = useState<Form | null>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (q.data && !f) {
      const s = q.data.org.settings as Record<string, unknown>;
      const str = (k: string) => (typeof s[k] === 'string' ? (s[k] as string) : '');
      const contact = (typeof s.contact === 'object' && s.contact ? s.contact : {}) as Record<string, unknown>;
      const cs = (k: string) => (typeof contact[k] === 'string' ? (contact[k] as string) : '');
      setF({ name: q.data.org.name, city: str('city'), country: str('country'), contact_name: cs('name'), contact_email: cs('email'), contact_phone: cs('phone') });
    }
  }, [q.data, f]);
  const errs = f ? {
    name: !f.name.trim() ? 'The name cannot be empty.' : null,
    country: f.country && !/^[A-Za-z]{2}$/.test(f.country) ? 'Use a 2-letter ISO code, e.g. RO.' : null,
    contact_email: f.contact_email && !isEmail(f.contact_email) ? 'Enter a valid email.' : null,
    contact_phone: f.contact_phone && !/^\+?[0-9 ()-]{6,20}$/.test(f.contact_phone) ? 'Enter a valid phone number.' : null,
  } : {};
  const save = useAction(() => api.orgUpdate(id, {
    name: f!.name.trim(),
    settings: { ...q.data!.org.settings, city: f!.city.trim(), country: f!.country.trim().toUpperCase(), contact: { name: f!.contact_name.trim(), email: f!.contact_email.trim(), phone: f!.contact_phone.trim() } },
  }), { invalidate: [['org', id, 'overview'], ['me']], success: 'Settings saved.' });
  const set = (p: Partial<Form>) => setF((x) => (x ? { ...x, ...p } : x));
  return (
    <>
      <PageHeader eyebrow={portal.name} title="Settings" subtitle="How your club appears to players and who PreFlop contacts." />
      <QueryView q={q} what="organization settings">
        {() => f && (
          <Section className="max-w-2xl">
            <form noValidate className="grid gap-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!Object.values(errs).some(Boolean)) save.mutate(undefined); }}>
              <Field label="Club name" error={touched ? errs.name : null}>{(p) => <TextInput {...p} value={f.name} onChange={(e) => set({ name: e.target.value })} disabled={!write} />}</Field>
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <Field label="City">{(p) => <TextInput {...p} value={f.city} onChange={(e) => set({ city: e.target.value })} disabled={!write} />}</Field>
                <Field label="Country" error={touched ? errs.country : null}>{(p) => <TextInput {...p} maxLength={2} value={f.country} onChange={(e) => set({ country: e.target.value })} disabled={!write} />}</Field>
              </div>
              <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Operations contact</div>
              <Field label="Name">{(p) => <TextInput {...p} value={f.contact_name} onChange={(e) => set({ contact_name: e.target.value })} disabled={!write} />}</Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Email" error={touched ? errs.contact_email : null}>{(p) => <TextInput {...p} type="email" value={f.contact_email} onChange={(e) => set({ contact_email: e.target.value })} disabled={!write} />}</Field>
                <Field label="Phone" error={touched ? errs.contact_phone : null}>{(p) => <TextInput {...p} type="tel" value={f.contact_phone} onChange={(e) => set({ contact_phone: e.target.value })} disabled={!write} />}</Field>
              </div>
              <div><Button type="submit" disabled={!write || save.isPending}>Save settings</Button></div>
            </form>
          </Section>
        )}
      </QueryView>
    </>
  );
}
