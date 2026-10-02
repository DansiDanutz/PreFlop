import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PlayMode } from '@preflop/client';
import { Button, formatMoney } from '@preflop/ui';
import { ArrowLeftRight, Coins, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { fmtDateTime, isNotAvailable, MODE_LABEL } from '../../lib/format.ts';
import { currencyForMode, isEmail, parseAmount } from '../../lib/rules.ts';
import { groupByParty } from '../../lib/statements.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { Money } from '../../components/domain.tsx';
import { Meter } from '../../components/charts.tsx';
import { useCanWrite, useOrgId, usePortal } from '../../components/Shell.tsx';
import { Callout, ConfirmDialog, Field, Mono, PageHeader, QueryView, Section, Select, TextInput, useAction } from '../../components/ui.tsx';
import { PeriodPicker, StatementCard, StatementTotals, thisPeriod, TierLadder } from '../../components/statements.tsx';

// ------------------------------------------------------------------ statements / revenue share

export function Statements({ variant }: { variant?: 'revenue' }) {
  const id = useOrgId();
  const portal = usePortal();
  const [period, setPeriod] = useState(thisPeriod());
  const q = useQuery({ queryKey: ['org', id, 'statements', period], queryFn: () => api.orgStatements(id, period), placeholderData: keepPreviousData });
  const policy = portal.kind === 'club' ? 'club' : portal.kind === 'partner' ? 'partner' : null;
  const metrics: Record<string, number> = {};
  for (const s of q.data?.statements ?? []) for (const l of s.lines) {
    if (l.metric === undefined) continue;
    if (/hand/i.test(l.label)) metrics['Content · hands dealt'] = l.metric;
    if (/player/i.test(l.label)) metrics['Distribution · active players'] = l.metric;
    if (/turnover/i.test(l.label)) metrics['Distribution · monthly turnover'] = l.metric;
  }
  return (
    <>
      <PageHeader eyebrow={portal.name} title={variant === 'revenue' ? 'Revenue share' : 'Statements'}
        subtitle="Your share is recomputed every period from what you contributed: metric → tier → rate → base → amount. Never edited by hand." />
      <div className="mb-4"><PeriodPicker value={period} onChange={setPeriod} /></div>
      <div className="space-y-4">
        <QueryView q={q} what="statements">
          {(d) => d.statements.length === 0
            ? <p className="rounded-[10px] border border-dashed border-line-strong p-8 text-center text-sm text-muted">No statement for {period} yet. Statements are produced from the ledger after the period closes.</p>
            : <><StatementTotals statements={d.statements} />{groupByParty(d.statements).flatMap((g) => g.statements.map((s, i) => <StatementCard key={`${g.party}-${i}`} s={s} />))}</>}
        </QueryView>
        {policy && <Section title="How the share is tiered" subtitle="The tier your statement reached is highlighted."><TierLadder policy={policy} metrics={metrics} /></Section>}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ transfers

function TransferForm({ modes, onDone }: { modes: PlayMode[]; onDone?: () => void }) {
  const id = useOrgId();
  const write = useCanWrite();
  const [f, setF] = useState({ email: '', mode: modes[0]!, amount: '' });
  const [touched, setTouched] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const cur = currencyForMode(f.mode);
  const minor = parseAmount(f.amount, cur);
  const errs = { email: !isEmail(f.email) ? 'Enter the player’s email.' : null, amount: minor === null ? 'Enter a positive whole amount.' : null };
  const send = useAction(() => api.orgTransfer(id, { email: f.email.trim(), mode: f.mode, amount_minor: minor! }), {
    invalidate: [['org', id, 'transfers'], ['org', id, 'treasury'], ['org', id, 'players']],
    success: (t) => `Sent ${formatMoney(t.amount_minor, t.currency)} to ${t.user_email}.`,
    onSuccess: () => { setF({ ...f, email: '', amount: '' }); setTouched(false); setConfirm(false); onDone?.(); },
  });
  const submit = () => { setTouched(true); if (!errs.email && !errs.amount) setConfirm(true); };
  return (
    <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Field label="Player email" error={touched ? errs.email : null}>{(p) => <TextInput {...p} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="player@example.com" disabled={!write} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Currency">{(p) => <Select {...p} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as PlayMode })} disabled={!write || modes.length === 1}>{modes.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</Select>}</Field>
        <Field label="Amount" error={touched ? errs.amount : null} hint={minor ? formatMoney(minor, cur) : undefined}>{(p) => <TextInput {...p} inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="500" disabled={!write} />}</Field>
      </div>
      <Button type="submit" disabled={!write || send.isPending}><ArrowLeftRight size={15} aria-hidden />Send to player</Button>
      {!write && <p className="text-xs text-faint">Viewers cannot send transfers.</p>}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger={false} busy={send.isPending} confirmLabel="Send" title="Send this transfer?" onConfirm={() => send.mutate(undefined)}>
        <strong>{minor ? formatMoney(minor, cur) : ''}</strong> goes to <strong>{f.email}</strong> and is recorded in the ledger. Transfers cannot be reversed from the console.
      </ConfirmDialog>
    </form>
  );
}

function TransferHistory({ mode }: { mode?: PlayMode }) {
  const id = useOrgId();
  const q = useQuery({ queryKey: ['org', id, 'transfers'], queryFn: () => api.orgTransfers(id) });
  return (
    <QueryView q={q} what="transfer history">
      {(d) => (
        <DataTable rows={mode ? d.transfers.filter((t) => t.mode === mode) : d.transfers} rowKey={(t) => t.id} dense caption="Transfers" initialSort={{ key: 'at', dir: 'desc' }} empty="No transfers yet."
          columns={[
            { key: 'to', header: 'Player', sort: (t) => t.user_email, cell: (t) => t.user_email },
            { key: 'mode', header: 'Currency', sort: (t) => t.mode, cell: (t) => <span className="text-xs text-muted">{MODE_LABEL[t.mode] ?? t.mode}</span> },
            { key: 'amt', header: 'Amount', align: 'right', sort: (t) => t.amount_minor, cell: (t) => <Money minor={t.amount_minor} currency={t.currency} /> },
            { key: 'at', header: 'Sent', sort: (t) => t.created_at, cell: (t) => <span className="text-xs text-muted">{fmtDateTime(t.created_at)}</span> },
          ]} />
      )}
    </QueryView>
  );
}

export function Transfers() {
  const portal = usePortal();
  return (
    <>
      <PageHeader eyebrow={portal.name} title="Transfers to players" subtitle="Send diamonds or chips to your players online. Every transfer is in the ledger (from, to, amount)." />
      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Section title="New transfer"><TransferForm modes={['diamonds', 'virtual-chips']} /></Section>
        <Section title="History"><TransferHistory /></Section>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ chips

/** Placeholder chip price from docs/08: 100 chips = €1. Shown as an estimate only; the payment is priced by the server. */
const CHIPS_PER_EUR = 100;

export function BuyChips() {
  const id = useOrgId();
  const write = useCanWrite();
  const [chips, setChips] = useState('');
  const [payWith, setPayWith] = useState<'EUR' | 'USDT' | 'USDC'>('EUR');
  const [touched, setTouched] = useState(false);
  const n = parseAmount(chips, 'CHIP');
  const err = n === null ? 'Enter a whole number of chips.' : n < 100 ? 'The minimum purchase is 100 chips.' : null;
  const buy = useAction(() => api.buyOrgChips(id, { chips: n!, pay_with: payWith }), {
    invalidate: [['org', id, 'treasury']],
    success: (p) => `Purchase ${p.status}: ${formatMoney(p.amount_minor, p.currency)} via ${p.method}.`,
    onSuccess: () => { setChips(''); setTouched(false); },
  });
  return (
    <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!err) buy.mutate(undefined); }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Chips" error={touched ? err : null} hint={n && !err ? `≈ €${(n / CHIPS_PER_EUR).toFixed(2)} at the placeholder price` : '100 chips = €1 (placeholder)'}>{(p) => <TextInput {...p} inputMode="numeric" value={chips} onChange={(e) => setChips(e.target.value)} placeholder="10000" disabled={!write} />}</Field>
        <Field label="Pay with">{(p) => <Select {...p} value={payWith} onChange={(e) => setPayWith(e.target.value as typeof payWith)} disabled={!write}><option value="EUR">EUR</option><option value="USDT">USDT</option><option value="USDC">USDC</option></Select>}</Field>
      </div>
      <Button type="submit" disabled={!write || buy.isPending}><Coins size={15} aria-hidden />Buy chips (sandbox)</Button>
      <p className="text-xs text-faint">Sandbox: no real payment is taken. Crypto purchases are credited after on-chain confirmation in production.</p>
    </form>
  );
}

export function Chips() {
  const portal = usePortal();
  const id = useOrgId();
  const t = useQuery({ queryKey: ['org', id, 'treasury'], queryFn: () => api.orgTreasury(id) });
  const chipAccts = t.data?.accounts.filter((a) => a.mode === 'virtual-chips') ?? [];
  return (
    <>
      <PageHeader eyebrow={portal.name} title="Chips" subtitle="Buy virtual chips from PreFlop and give them to your players — a welcome balance, a prize or a loyalty reward. Chips are never cashed out." />
      <div className="mb-4 flex flex-wrap gap-3">
        {t.isError && !isNotAvailable(t.error) ? null : chipAccts.map((a) => (
          <div key={a.purpose} className="rounded-[12px] border border-line bg-surface px-5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{a.purpose}</div>
            <div className="text-2xl font-semibold tabular-nums">{formatMoney(a.balance_minor, a.currency)}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Section title="Buy chips"><BuyChips /></Section>
          <Section title="Send chips to a player"><TransferForm modes={['virtual-chips']} /></Section>
        </div>
        <Section title="Chip transfers"><TransferHistory mode="virtual-chips" /></Section>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ treasury & collateral

export function Treasury() {
  const portal = usePortal();
  const id = useOrgId();
  const write = useCanWrite();
  const q = useQuery({ queryKey: ['org', id, 'treasury'], queryFn: () => api.orgTreasury(id), refetchInterval: 15_000 });
  const [f, setF] = useState<{ mode: PlayMode; amount: string }>({ mode: 'diamonds', amount: '' });
  const [touched, setTouched] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const cur = currencyForMode(f.mode);
  const minor = parseAmount(f.amount, cur);
  const fund = useAction(() => api.orgFundCollateral(id, { mode: f.mode, currency: cur, amount_minor: minor! }), {
    invalidate: [['org', id, 'treasury']], success: 'Collateral funded.', onSuccess: () => { setF({ ...f, amount: '' }); setTouched(false); setConfirm(false); },
  });
  return (
    <>
      <PageHeader eyebrow={portal.name} title="Treasury & collateral" subtitle="When you are the house, your collateral pays your winners. Each open round reserves its exact worst-case loss plus PreFlop's fee; a bet that would exceed your collateral is refused." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Section title="Accounts">
          <QueryView q={q} what="treasury balances">
            {(d) => (
              <DataTable rows={d.accounts} rowKey={(a) => `${a.purpose}:${a.mode}:${a.currency}`} caption="Treasury accounts" initialSort={{ key: 'purpose', dir: 'asc' }} empty="No accounts yet. Buy diamonds or chips, or fund collateral."
                columns={[
                  { key: 'purpose', header: 'Account', sort: (a) => a.purpose, cell: (a) => <div><div className="font-medium capitalize">{a.purpose}</div><Mono className="whitespace-nowrap text-faint">{a.mode} · {a.currency}</Mono></div> },
                  { key: 'bal', header: 'Balance', align: 'right', sort: (a) => a.balance_minor, cell: (a) => <Money minor={a.balance_minor} currency={a.currency} /> },
                  { key: 'res', header: 'Reserved', align: 'right', sort: (a) => a.reserved_minor ?? 0, cell: (a) => a.reserved_minor === undefined ? <span className="text-faint">—</span> : <Money minor={a.reserved_minor} currency={a.currency} /> },
                  { key: 'avail', header: 'Available', align: 'right', sort: (a) => a.balance_minor - (a.reserved_minor ?? 0), cell: (a) => <Money minor={a.balance_minor - (a.reserved_minor ?? 0)} currency={a.currency} className="font-semibold" /> },
                  { key: 'use', header: 'Reserved share', className: 'w-48', cell: (a) => a.reserved_minor === undefined ? null : <Meter value={a.reserved_minor} max={a.balance_minor} label={`${a.purpose} reserved`} /> },
                ]} />
            )}
          </QueryView>
        </Section>
        <Section title="Fund collateral">
          <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); setTouched(true); if (minor !== null) setConfirm(true); }}>
            <Field label="Mode">{(p) => <Select {...p} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as PlayMode })} disabled={!write}>{(['diamonds', 'virtual-chips'] as PlayMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</Select>}</Field>
            <Field label={`Amount (${cur})`} error={touched && minor === null ? 'Enter a positive whole amount.' : null} hint="Moved from your treasury balance into collateral.">{(p) => <TextInput {...p} inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} disabled={!write} />}</Field>
            <Button type="submit" disabled={!write || fund.isPending}><ShieldCheck size={15} aria-hidden />Fund collateral</Button>
            <Callout tone="info">PreFlop never pays an organizer's winners. Keep collateral above the reserved amount or new bets in your rooms are refused.</Callout>
          </form>
        </Section>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger={false} busy={fund.isPending} confirmLabel="Fund" title="Fund collateral?" onConfirm={() => fund.mutate(undefined)}>
        Move <strong>{minor ? formatMoney(minor, cur) : ''}</strong> into your {MODE_LABEL[f.mode]} collateral.
      </ConfirmDialog>
    </>
  );
}
