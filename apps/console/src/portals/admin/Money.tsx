import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button } from '@preflop/ui';
import { Download, ShieldCheck, ShieldX } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { defined, fmtDateTime, nf } from '../../lib/format.ts';
import { downloadText, minorToDecimal, toCsv } from '../../lib/csv.ts';
import { groupByParty } from '../../lib/statements.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { Money, StatusBadge } from '../../components/domain.tsx';
import { Callout, Field, Mono, PageHeader, QueryView, Section, Select, TextInput } from '../../components/ui.tsx';
import { PeriodPicker, StatementCard, StatementTotals, thisPeriod } from '../../components/statements.tsx';

function useDebounced(v: string, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v.trim()), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function Ledger() {
  const [account, setAccount] = useState('');
  const [kind, setKind] = useState('');
  const a = useDebounced(account);
  const k = useDebounced(kind);
  const q = useQuery({ queryKey: ['admin', 'ledger', a, k], queryFn: () => api.adminLedger(defined({ account: a, kind: k, limit: 200 })), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader eyebrow="Money" title="Ledger" subtitle="Double-entry accounts (owner:purpose:mode:currency) and their postings. The ledger is the only record of balances." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Account" className="w-80">{(p) => <TextInput {...p} placeholder="e.g. preflop:bankroll:play:PLAY" value={account} onChange={(e) => setAccount(e.target.value)} />}</Field>
        <Field label="Entry kind" className="w-56">{(p) => <TextInput {...p} placeholder="e.g. bet.stake" value={kind} onChange={(e) => setKind(e.target.value)} />}</Field>
        {(account || kind) && <Button variant="ghost" size="sm" onClick={() => { setAccount(''); setKind(''); }}>Clear filters</Button>}
      </div>
      <QueryView q={q} what="the ledger">
        {(d) => (
          <div className="grid gap-4">
            <Section title="Accounts" subtitle={`${d.accounts.length} accounts. Click one to filter its entries.`}>
              <div className="max-h-[360px] overflow-y-auto">
              <DataTable rows={d.accounts} rowKey={(r) => r.account_id} dense caption="Accounts" initialSort={{ key: 'acct', dir: 'asc' }} onRowClick={(r) => setAccount(r.account_id)}
                empty="No accounts match."
                columns={[
                  { key: 'acct', header: 'Account', sort: (r) => r.account_id, cell: (r) => <Mono>{r.account_id}</Mono> },
                  { key: 'cur', header: 'Currency', sort: (r) => r.currency, cell: (r) => <span className="text-xs text-muted">{r.currency}</span> },
                  { key: 'bal', header: 'Balance', align: 'right', sort: (r) => r.balance_minor, cell: (r) => <Money minor={r.balance_minor} currency={r.currency} /> },
                ]} />
              </div>
            </Section>
            <Section title="Entries" subtitle={`Latest ${d.entries.length} postings`}>
              <DataTable rows={d.entries} rowKey={(r) => `${r.tx_id}:${r.account_id}:${r.amount_minor}`} dense caption="Ledger entries" initialSort={{ key: 'at', dir: 'desc' }}
                empty="No entries match."
                columns={[
                  { key: 'tx', header: 'Tx', sort: (r) => r.tx_id, cell: (r) => <Mono>{r.tx_id}</Mono> },
                  { key: 'kind', header: 'Kind', sort: (r) => r.kind, cell: (r) => <Mono>{r.kind}</Mono> },
                  { key: 'ref', header: 'Ref', cell: (r) => <Mono className="text-muted">{r.ref}</Mono> },
                  { key: 'acct', header: 'Account', sort: (r) => r.account_id, cell: (r) => <Mono className="text-muted">{r.account_id}</Mono> },
                  { key: 'amt', header: 'Amount', align: 'right', sort: (r) => r.amount_minor, cell: (r) => <Money minor={r.amount_minor} currency={r.currency} /> },
                  { key: 'at', header: 'At', sort: (r) => r.created_at, cell: (r) => <span className="whitespace-nowrap text-xs text-muted">{fmtDateTime(r.created_at)}</span> },
                ]} />
            </Section>
          </div>
        )}
      </QueryView>
    </>
  );
}

export function Audit() {
  const q = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api.adminAudit({ limit: 200 }), refetchInterval: 15_000 });
  return (
    <>
      <PageHeader eyebrow="Platform" title="Audit" subtitle="A hash-chained, append-only log of every privileged action and state change." />
      <QueryView q={q} what="the audit log">
        {(d) => (
          <div className="space-y-4">
            {d.chain.ok
              ? <Callout tone="accent" icon={<ShieldCheck size={16} />} title="Chain verified">All {nf(d.chain.count)} events hash-link to their predecessor. Nothing has been edited or removed.</Callout>
              : <Callout tone="danger" icon={<ShieldX size={16} />} title="Chain broken">Verification failed at sequence <strong>{d.chain.brokenAt ?? '?'}</strong> of {nf(d.chain.count)}. Treat this as a security incident.</Callout>}
            <Section title="Latest events">
              <DataTable rows={d.events} rowKey={(e) => String(e.seq)} dense caption="Audit events" initialSort={{ key: 'seq', dir: 'desc' }} empty="No audit events."
                rowClassName={(e) => (d.chain.brokenAt !== null && e.seq >= d.chain.brokenAt ? 'bg-danger/5' : undefined)}
                columns={[
                  { key: 'seq', header: 'Seq', sort: (e) => e.seq, cell: (e) => <Mono>{e.seq}</Mono> },
                  { key: 'at', header: 'At', sort: (e) => e.at, cell: (e) => <span className="whitespace-nowrap text-xs text-muted">{fmtDateTime(e.at)}</span> },
                  { key: 'event', header: 'Event', cell: (e) => <code className="line-clamp-2 break-all font-mono text-[12px]">{e.event}</code> },
                  { key: 'hash', header: 'Hash', cell: (e) => <Mono className="text-faint" >{e.hash.slice(0, 16)}…</Mono> },
                ]} />
            </Section>
          </div>
        )}
      </QueryView>
    </>
  );
}

export function Statements() {
  const [period, setPeriod] = useState(thisPeriod());
  const q = useQuery({ queryKey: ['admin', 'statements', period], queryFn: () => api.adminStatements(period), placeholderData: keepPreviousData });
  const exportCsv = () => {
    const rows = (q.data?.statements ?? []).flatMap((s) => s.lines.map((l) => ({ s, l })));
    downloadText(`preflop-statements-${period}.csv`, toCsv(rows, [
      { header: 'period', value: (r) => r.s.period }, { header: 'party', value: (r) => r.s.party }, { header: 'currency', value: (r) => r.s.currency },
      { header: 'line', value: (r) => r.l.label }, { header: 'metric', value: (r) => r.l.metric }, { header: 'tier', value: (r) => r.l.tier },
      { header: 'rate_bps', value: (r) => r.l.rate_bps }, { header: 'base', value: (r) => (r.l.base_minor === undefined ? '' : minorToDecimal(r.l.base_minor, r.s.currency)) },
      { header: 'amount', value: (r) => minorToDecimal(r.l.amount_minor, r.s.currency) },
    ]));
  };
  return (
    <>
      <PageHeader eyebrow="Money" title="Statements" subtitle="Dynamic revenue shares per party for the period: metric → tier → rate → base → amount (docs/09)."
        actions={<Button size="sm" variant="secondary" onClick={exportCsv} disabled={!q.data?.statements.length}><Download size={14} aria-hidden />Export CSV</Button>} />
      <div className="mb-4"><PeriodPicker value={period} onChange={setPeriod} /></div>
      <QueryView q={q} what="statements">
        {(d) => d.statements.length === 0 ? <p className="rounded-[10px] border border-dashed border-line-strong p-8 text-center text-sm text-muted">No statements for {period}.</p> : (
          <div className="space-y-4">
            <StatementTotals statements={d.statements} />
            {groupByParty(d.statements).map((g) => g.statements.map((s, i) => <StatementCard key={`${g.party}-${i}`} s={s} />))}
          </div>
        )}
      </QueryView>
    </>
  );
}

export function Payments() {
  const q = useQuery({ queryKey: ['admin', 'payments'], queryFn: api.adminPayments, refetchInterval: 15_000 });
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  return (
    <>
      <PageHeader eyebrow="Money" title="Payments" subtitle="Deposits, withdrawals and currency purchases (chips, diamonds). Sandbox: no real money moves." />
      <Section>
        <div className="mb-4 flex flex-wrap gap-3">
          <Field label="Kind" className="w-44">{(p) => <Select {...p} value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All kinds</option><option value="deposit">Deposits</option><option value="withdrawal">Withdrawals</option><option value="purchase">Purchases</option></Select>}</Field>
          <Field label="Status" className="w-44">{(p) => <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{['pending', 'completed', 'failed', 'rejected'].map((s) => <option key={s} value={s}>{s}</option>)}</Select>}</Field>
        </div>
        <QueryView q={q} what="payments">
          {(d) => (
            <DataTable rows={d.payments.filter((p) => (!kind || p.kind === kind) && (!status || p.status === status))} rowKey={(p) => p.id} caption="Payments" initialSort={{ key: 'at', dir: 'desc' }}
              empty="No payments match."
              columns={[
                { key: 'id', header: 'Payment', cell: (p) => <Mono>{p.id}</Mono> },
                { key: 'kind', header: 'Kind', sort: (p) => p.kind, cell: (p) => <span className="capitalize">{p.kind}</span> },
                { key: 'who', header: 'User / org', sort: (p) => p.user_email ?? p.org_id, cell: (p) => p.user_email ?? <Mono>{p.org_id ?? '—'}</Mono> },
                { key: 'method', header: 'Method', sort: (p) => p.method, cell: (p) => p.method },
                { key: 'amt', header: 'Amount', align: 'right', sort: (p) => p.amount_minor, cell: (p) => <Money minor={p.amount_minor} currency={p.currency} /> },
                { key: 'status', header: 'Status', sort: (p) => p.status, cell: (p) => <StatusBadge status={p.status} /> },
                { key: 'at', header: 'Created', sort: (p) => p.created_at, cell: (p) => <span className="text-xs text-muted">{fmtDateTime(p.created_at)}</span> },
              ]} />
          )}
        </QueryView>
      </Section>
    </>
  );
}
