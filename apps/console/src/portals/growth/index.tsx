import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Leaderboard, LeaderboardInput, LeaderboardMetric, PlayMode, Promotion, PromotionInput, PromotionKind } from '@preflop/client';
import { Badge, Button, formatMoneyShort } from '@preflop/ui';
import { Plus, Trophy, Gift } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useCanWrite, usePortal } from '../../components/Shell.tsx';
import { DataTable } from '../../components/DataTable.tsx';
import { ChoiceHint } from '../../components/decisions.tsx';
import { Callout, ConfirmDialog, Field, Kpi, Modal, PageHeader, QueryView, Section, Select, TextArea, TextInput, useAction } from '../../components/ui.tsx';

/** Leaderboards and promotions for the PreFlop team, clubs and organizers (docs/16). */

export const MODE_CURRENCY: Record<string, string[]> = { play: ['PLAY'], 'virtual-chips': ['CHIP'], diamonds: ['DIAMOND'], 'real-fiat': ['EUR'], 'real-crypto': ['USDT', 'USDC'] };
export const MODE_NAME: Record<string, string> = { play: 'Free chips', 'virtual-chips': 'Chips', diamonds: 'Diamonds', 'real-fiat': 'Real money (EUR)', 'real-crypto': 'Real money (crypto)' };
const METRIC_NAME: Record<LeaderboardMetric, string> = { net: 'Net result', volume: 'Volume', roi: 'Return per chip', points: 'Points' };
export const amount = (minor: number, cur: string) => formatMoneyShort(minor, cur);
export const day = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function statusTone(s: string): 'accent' | 'muted' | 'warn' | 'info' | 'danger' {
  return s === 'active' || s === 'approved' ? 'accent' : s === 'scheduled' || s === 'pending_review' ? 'info' : s === 'rejected' || s === 'cancelled' ? 'danger' : 'muted';
}

export function useScope() {
  const p = usePortal();
  return { admin: p.kind === 'admin', orgId: p.orgId, kind: p.kind };
}

// ------------------------------------------------------------------ leaderboards

function BoardEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { admin, orgId, kind } = useScope();
  // Chips and diamonds are an organization's closed loop: those boards are created from its portal.
  const modes = admin ? ['play', 'real-fiat', 'real-crypto'] : ['diamonds', 'virtual-chips'];
  const [f, setF] = useState({ name: '', mode: modes[0]!, currency: MODE_CURRENCY[modes[0]!]![0]!, metric: 'net' as LeaderboardMetric, min_rounds: '',
    scope: admin ? 'global' : 'org', scope_ref: '', split: '50, 30, 20', starts: localInput(new Date()), ends: localInput(new Date(Date.now() + 7 * 86_400_000)),
    margin: '0', contribution: '0', fund: '' });
  useEffect(() => { if (open) setF((x) => ({ ...x, name: '' })); }, [open]);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const tables = useQuery({ queryKey: ['lobby'], queryFn: api.lobby, enabled: open && !admin });
  const rooms = useQuery({ queryKey: ['org', orgId, 'rooms'], queryFn: () => api.orgRooms(orgId!), enabled: open && !admin && !!orgId });
  const split = f.split.split(/[,\s]+/).filter(Boolean).map((x) => Math.round(Number(x) * 100));
  const splitOk = split.length > 0 && split.every((x) => x > 0) && split.reduce((a, b) => a + b, 0) === 10_000;
  const real = f.mode === 'real-fiat' || f.mode === 'real-crypto';
  const save = useAction(async () => {
    const body: LeaderboardInput = {
      name: f.name.trim(), mode: f.mode as PlayMode, currency: f.currency, metric: f.metric, prize_split_bps: split,
      scope: f.scope as Leaderboard['scope'], scope_ref: f.scope === 'global' ? null : f.scope === 'org' ? orgId : f.scope_ref,
      starts_at: new Date(f.starts).toISOString(), ends_at: new Date(f.ends).toISOString(),
      ...(f.min_rounds ? { min_rounds: Number(f.min_rounds) } : {}),
      ...(admin ? { margin_bps: Math.round(Number(f.margin || 0) * 100) } : {}),
      ...(real ? { contribution_bps: Math.round(Number(f.contribution || 0) * 100) } : {}),
      ...(f.fund ? { fund_minor: Number(f.fund) } : {}),
    };
    return admin ? api.adminCreateLeaderboard(body) : api.orgCreateLeaderboard(orgId!, body);
  }, { invalidate: [['leaderboards']], success: (lb) => `Leaderboard “${lb.name}” created.`, onSuccess: onClose });
  return (
    <Modal open={open} onClose={onClose} wide title="New leaderboard"
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" disabled={save.isPending || !splitOk || f.name.trim().length < 3} onClick={() => save.mutate(undefined)}>Create leaderboard</Button></>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name" className="md:col-span-2">{(p) => <TextInput {...p} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Weekly Free-Chip Championship" />}</Field>
        <Field label="Currency">{(p) => (
          <Select {...p} value={f.mode} onChange={(e) => set({ mode: e.target.value, currency: MODE_CURRENCY[e.target.value]![0]! })}>
            {modes.map((m) => <option key={m} value={m}>{MODE_NAME[m]}</option>)}
          </Select>)}</Field>
        {MODE_CURRENCY[f.mode]!.length > 1 ? (
          <Field label="Coin">{(p) => <Select {...p} value={f.currency} onChange={(e) => set({ currency: e.target.value })}>{MODE_CURRENCY[f.mode]!.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
        ) : <div />}
        <Field label="Ranking" hint={f.metric === 'volume' ? 'Volume rewards activity; players see a take-a-break note.' : f.metric === 'points' ? 'Each correct prediction scores its odds × 10.' : undefined}>{(p) => (
          <Select {...p} value={f.metric} onChange={(e) => set({ metric: e.target.value as LeaderboardMetric })}>
            {(Object.keys(METRIC_NAME) as LeaderboardMetric[]).map((m) => <option key={m} value={m}>{METRIC_NAME[m]}</option>)}
          </Select>)}</Field>
        <Field label="Minimum rounds to qualify" hint="Blank: 10 for net, 20 for return per chip, 1 otherwise.">{(p) => <TextInput {...p} inputMode="numeric" value={f.min_rounds} onChange={(e) => set({ min_rounds: e.target.value.replace(/\D/g, '') })} />}</Field>
        <Field label="Scope">{(p) => (
          <Select {...p} value={f.scope} onChange={(e) => set({ scope: e.target.value, scope_ref: '' })}>
            {admin && <option value="global">Every table</option>}
            <option value="org">{admin ? 'One organization' : 'All our tables and rooms'}</option>
            {(admin || kind === 'club') && <option value="table">One table</option>}
            <option value="room">One room</option>
          </Select>)}</Field>
        {f.scope === 'global' || (!admin && f.scope === 'org') ? <div /> : (
          <Field label={f.scope === 'table' ? 'Table' : f.scope === 'room' ? 'Room' : 'Organization id'}>{(p) => admin ? (
            <TextInput {...p} value={f.scope_ref} onChange={(e) => set({ scope_ref: e.target.value.trim() })} placeholder={f.scope === 'table' ? 'atlas-04' : f.scope === 'room' ? 'room_…' : 'atlas'} />
          ) : (
            <Select {...p} value={f.scope_ref} onChange={(e) => set({ scope_ref: e.target.value })}>
              <option value="">Choose…</option>
              {f.scope === 'table'
                ? tables.data?.tables.filter((t) => t.club_id === orgId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)
                : rooms.data?.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          )}</Field>
        )}
        <Field label="Starts">{(p) => <TextInput {...p} type="datetime-local" value={f.starts} onChange={(e) => set({ starts: e.target.value })} />}</Field>
        <Field label="Ends">{(p) => <TextInput {...p} type="datetime-local" value={f.ends} onChange={(e) => set({ ends: e.target.value })} />}</Field>
        <Field label="Prize split (% per rank)" error={splitOk ? null : 'Shares must add up to 100.'} hint="e.g. 50, 30, 20 pays the top three.">{(p) => <TextInput {...p} value={f.split} onChange={(e) => set({ split: e.target.value })} />}</Field>
        <Field label={admin ? 'Sponsor now (minor units)' : 'Fund from treasury now (minor units)'} hint="Optional. You can add more while the board runs.">{(p) => <TextInput {...p} inputMode="numeric" value={f.fund} onChange={(e) => set({ fund: e.target.value.replace(/\D/g, '') })} />}</Field>
        {admin && <Field label="Share of PreFlop margin (%)" hint="Accrued every few minutes from PreFlop’s result in scope. 0–50.">{(p) => <TextInput {...p} inputMode="decimal" value={f.margin} onChange={(e) => set({ margin: e.target.value })} />}</Field>}
        {real && <Field label="Player contribution (% of stakes)" hint="Real money only; taken from the house edge, not from the player. 0–5.">{(p) => <TextInput {...p} inputMode="decimal" value={f.contribution} onChange={(e) => set({ contribution: e.target.value })} />}</Field>}
      </div>
      {real && <div className="mt-4"><Callout tone="warn" title="Real money is switched off">Real-money leaderboards are refused until the mode is enabled in Settings.</Callout></div>}
      {f.mode === 'play' && <div className="mt-4"><Callout tone="accent" title="Free-chip boards pay free chips and badges only">Nothing with cash value is ever paid on a free-chip board.</Callout></div>}
    </Modal>
  );
}

function FundDialog({ lb, onClose }: { lb: Leaderboard | null; onClose: () => void }) {
  const { admin, orgId } = useScope();
  const [v, setV] = useState('');
  useEffect(() => setV(''), [lb]);
  const fund = useAction(() => (admin ? api.adminFundLeaderboard(lb!.id, Number(v)) : api.orgFundLeaderboard(orgId!, lb!.id, Number(v))),
    { invalidate: [['leaderboards']], success: 'Prize pool topped up.', onSuccess: onClose });
  return (
    <Modal open={!!lb} onClose={onClose} title={`Add to the pool · ${lb?.name ?? ''}`}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" disabled={!v || fund.isPending} onClick={() => fund.mutate(undefined)}>Add to pool</Button></>}>
      <Field label={`Amount (${lb?.currency ?? ''}, minor units)`} hint={admin ? 'Sponsored by PreFlop.' : 'Moved from your treasury and held until the board settles.'}>
        {(p) => <TextInput {...p} autoFocus inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} />}
      </Field>
    </Modal>
  );
}

export function Leaderboards() {
  const { admin, orgId } = useScope();
  const write = useCanWrite();
  const [creating, setCreating] = useState(false);
  const [funding, setFunding] = useState<Leaderboard | null>(null);
  const [cancelling, setCancelling] = useState<Leaderboard | null>(null);
  const q = useQuery({ queryKey: ['leaderboards', admin ? 'admin' : orgId], queryFn: () => (admin ? api.adminLeaderboards() : api.orgLeaderboards(orgId!)), refetchInterval: 15_000 });
  const settle = useAction((lb: Leaderboard) => api.adminSettleLeaderboard(lb.id), { invalidate: [['leaderboards']], success: 'Leaderboard settled and prizes paid.' });
  const cancel = useAction((lb: Leaderboard) => api.adminCancelLeaderboard(lb.id), { invalidate: [['leaderboards']], success: 'Leaderboard cancelled; the pool went back to its funders.', onSuccess: () => setCancelling(null) });
  return (
    <>
      <PageHeader eyebrow="Growth" title="Leaderboards"
        subtitle={admin ? 'Boards in every currency, their prize pools and payouts. Real-money boards stay closed until real money is on.' : 'Rank the players at your tables and rooms. Pools are funded from your treasury and paid out automatically.'}
        actions={write && <Button size="sm" onClick={() => setCreating(true)}><Plus size={15} aria-hidden />New leaderboard</Button>} />
      <QueryView q={q} what="leaderboards">
        {(d) => {
          const live = d.leaderboards.filter((l) => l.status === 'active');
          return (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi label="Live boards" value={live.length} tone={live.length ? 'accent' : undefined} />
                <Kpi label="Scheduled" value={d.leaderboards.filter((l) => l.status === 'scheduled').length} />
                <Kpi label="Settled" value={d.leaderboards.filter((l) => l.status === 'settled').length} />
                {admin
                  ? <Kpi label="Free-chip pools live" value={amount(live.filter((l) => l.currency === 'PLAY').reduce((a, l) => a + l.pool_minor, 0), 'PLAY')} />
                  : <Kpi label="Diamond pools live" value={amount(live.filter((l) => l.currency === 'DIAMOND').reduce((a, l) => a + l.pool_minor, 0), 'DIAMOND')} />}
              </div>
              <Section title="All boards">
                <DataTable rows={d.leaderboards} rowKey={(l) => l.id} initialSort={{ key: 'ends', dir: 'asc' }}
                  empty={<div className="py-8 text-center text-sm text-muted"><Trophy className="mx-auto mb-2 text-accent/70" aria-hidden />No leaderboards yet.</div>}
                  columns={[
                    { key: 'name', header: 'Board', sort: (l) => l.name, cell: (l) => <div><div className="font-semibold">{l.name}</div><div className="text-xs text-muted">{l.owner_name} · {l.scope === 'global' ? 'every table' : `${l.scope} ${l.scope_ref ?? ''}`}</div></div> },
                    { key: 'mode', header: 'Currency', sort: (l) => l.mode, cell: (l) => MODE_NAME[l.mode] ?? l.mode },
                    { key: 'metric', header: 'Ranking', cell: (l) => `${METRIC_NAME[l.metric]}${l.min_rounds > 1 ? ` · ${l.min_rounds}+ rounds` : ''}` },
                    { key: 'pool', header: 'Pool', align: 'right', sort: (l) => l.pool_minor, cell: (l) => <span className="tabular-nums">{amount(l.pool_minor, l.currency)}</span> },
                    { key: 'ends', header: 'Ends', sort: (l) => l.ends_at, cell: (l) => <span className="whitespace-nowrap text-sm">{day(l.ends_at)}</span> },
                    { key: 'status', header: 'Status', cell: (l) => <Badge tone={statusTone(l.status)}>{l.status}</Badge> },
                    { key: 'act', header: '', align: 'right', cell: (l) => write && (l.status === 'active' || l.status === 'scheduled') ? (
                      <div className="flex justify-end gap-2">
                        {(admin || l.mode !== 'play') && <Button size="sm" variant="secondary" onClick={() => setFunding(l)}>Add to pool</Button>}
                        {admin && new Date(l.ends_at) <= new Date() && <Button size="sm" onClick={() => settle.mutate(l)}>Settle</Button>}
                        {admin && <Button size="sm" variant="ghost" onClick={() => setCancelling(l)}>Cancel</Button>}
                      </div>
                    ) : null },
                  ]} />
              </Section>
            </div>
          );
        }}
      </QueryView>
      <BoardEditor open={creating} onClose={() => setCreating(false)} />
      <FundDialog lb={funding} onClose={() => setFunding(null)} />
      <ConfirmDialog open={!!cancelling} onClose={() => setCancelling(null)} title="Cancel this leaderboard?" confirmLabel="Cancel board" busy={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling)}>
        Nobody is paid. The whole pool of <strong>{cancelling ? amount(cancelling.pool_minor, cancelling.currency) : ''}</strong> returns to whoever funded it.
      </ConfirmDialog>
    </>
  );
}

// ------------------------------------------------------------------ promotions

const KIND_NAME: Record<PromotionKind, string> = { announcement: 'Announcement', leaderboard: 'Leaderboard card', 'free-chips': 'Free-chip claim', 'org-drop': 'Chips or diamonds drop' };

function PromoEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { admin, orgId } = useScope();
  const kinds: PromotionKind[] = admin ? ['announcement', 'leaderboard', 'free-chips'] : ['announcement', 'leaderboard', 'org-drop'];
  const [f, setF] = useState({ kind: kinds[0]!, title: '', body: '', link: '', leaderboard_id: '', mode: 'diamonds', amount: '', budget: '',
    starts: localInput(new Date()), ends: localInput(new Date(Date.now() + 7 * 86_400_000)) });
  useEffect(() => { if (open) setF((x) => ({ ...x, title: '', body: '' })); }, [open]);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const boards = useQuery({ queryKey: ['leaderboards', admin ? 'admin' : orgId], queryFn: () => (admin ? api.adminLeaderboards() : api.orgLeaderboards(orgId!)), enabled: open });
  const save = useAction(async () => {
    const body: PromotionInput = {
      kind: f.kind, title: f.title.trim(), body: f.body.trim(), starts_at: new Date(f.starts).toISOString(), ends_at: new Date(f.ends).toISOString(),
      ...(f.link ? { link: f.link.trim() } : {}),
      ...(f.kind === 'leaderboard' ? { leaderboard_id: f.leaderboard_id } : {}),
      ...(f.kind === 'free-chips' ? { amount_minor: Number(f.amount) } : {}),
      ...(f.kind === 'org-drop' ? { mode: f.mode as PlayMode, currency: f.mode === 'diamonds' ? 'DIAMOND' : 'CHIP', amount_minor: Number(f.amount), budget_minor: Number(f.budget) } : {}),
    };
    return admin ? api.adminCreatePromotion(body) : api.orgCreatePromotion(orgId!, body);
  }, { invalidate: [['promotions']], success: (p) => (p.status === 'pending_review' ? 'Sent to PreFlop for review.' : 'Promotion is live.'), onSuccess: onClose });
  const valid = f.title.trim().length >= 3 && (f.kind !== 'leaderboard' || !!f.leaderboard_id) && (f.kind !== 'free-chips' || !!f.amount) && (f.kind !== 'org-drop' || (!!f.amount && !!f.budget));
  return (
    <Modal open={open} onClose={onClose} wide title="New promotion"
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate(undefined)}>{admin ? 'Publish' : 'Submit for review'}</Button></>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Type">{(p) => <Select {...p} value={f.kind} onChange={(e) => set({ kind: e.target.value as PromotionKind })}>{kinds.map((k) => <option key={k} value={k}>{KIND_NAME[k]}</option>)}</Select>}</Field>
        <Field label="Title">{(p) => <TextInput {...p} value={f.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} placeholder="Weekend top-up" />}</Field>
        <Field label="Text players read" className="md:col-span-2">{(p) => <TextArea {...p} value={f.body} maxLength={600} onChange={(e) => set({ body: e.target.value })} />}</Field>
        {f.kind === 'announcement' && <Field label="Link (optional)" hint="A site path like /app/clubs/atlas, or an https link." className="md:col-span-2">{(p) => <TextInput {...p} value={f.link} onChange={(e) => set({ link: e.target.value })} />}</Field>}
        {f.kind === 'leaderboard' && (
          <Field label="Leaderboard" className="md:col-span-2">{(p) => (
            <Select {...p} value={f.leaderboard_id} onChange={(e) => set({ leaderboard_id: e.target.value })}>
              <option value="">Choose…</option>
              {boards.data?.leaderboards.filter((l) => l.status === 'active' || l.status === 'scheduled').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>)}</Field>
        )}
        {f.kind === 'free-chips' && <Field label="Free chips per player" hint="Claimed once per player. 1 to 100,000.">{(p) => <TextInput {...p} inputMode="numeric" value={f.amount} onChange={(e) => set({ amount: e.target.value.replace(/\D/g, '') })} />}</Field>}
        {f.kind === 'org-drop' && (
          <>
            <Field label="Currency">{(p) => <Select {...p} value={f.mode} onChange={(e) => set({ mode: e.target.value })}><option value="diamonds">Diamonds</option><option value="virtual-chips">Chips</option></Select>}</Field>
            <Field label="Per player">{(p) => <TextInput {...p} inputMode="numeric" value={f.amount} onChange={(e) => set({ amount: e.target.value.replace(/\D/g, '') })} />}</Field>
            <Field label="Total budget" hint="Your treasury must hold it now; claims stop at the budget." className="md:col-span-2">{(p) => <TextInput {...p} inputMode="numeric" value={f.budget} onChange={(e) => set({ budget: e.target.value.replace(/\D/g, '') })} />}</Field>
          </>
        )}
        <Field label="Starts">{(p) => <TextInput {...p} type="datetime-local" value={f.starts} onChange={(e) => set({ starts: e.target.value })} />}</Field>
        <Field label="Ends">{(p) => <TextInput {...p} type="datetime-local" value={f.ends} onChange={(e) => set({ ends: e.target.value })} />}</Field>
      </div>
      <div className="mt-4"><Callout tone="info" title="House rules">No pressure wording, no countdowns, no “last chance”. Free chips, chips and diamonds have no cash value; there are no real-money bonuses while real money is off.</Callout></div>
    </Modal>
  );
}

export function Promotions() {
  const { admin, orgId } = useScope();
  const write = useCanWrite();
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState<Promotion | null>(null);
  const q = useQuery({ queryKey: ['promotions', admin ? 'admin' : orgId], queryFn: () => (admin ? api.adminPromotions() : api.orgPromotions(orgId!)), refetchInterval: 15_000 });
  const decide = useAction((a: { id: string; decision: 'approve' | 'reject'; note?: string }) => api.adminDecidePromotion(a.id, a.decision, a.note),
    { invalidate: [['promotions']], success: (r) => (r.status === 'approved' ? 'Promotion approved and live.' : 'Promotion rejected.'), onSuccess: () => setRejecting(null) });
  const end = useAction((id: string) => api.adminEndPromotion(id), { invalidate: [['promotions']], success: 'Promotion ended.' });
  return (
    <>
      <PageHeader eyebrow="Growth" title="Promotions"
        subtitle={admin ? 'PreFlop offers, and the review queue for promotions from clubs and organizers.' : 'Offers for your players. PreFlop reviews each promotion before players see it.'}
        actions={write && <Button size="sm" onClick={() => setCreating(true)}><Plus size={15} aria-hidden />New promotion</Button>} />
      <QueryView q={q} what="promotions">
        {(d) => {
          const pending = d.promotions.filter((p) => p.status === 'pending_review');
          return (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi label="Live" value={d.promotions.filter((p) => p.live).length} tone="accent" />
                <Kpi label="Waiting for review" value={pending.length} tone={pending.length ? 'warn' : undefined} />
                <Kpi label="Claims paid (free chips)" value={amount(d.promotions.filter((p) => p.kind === 'free-chips').reduce((a, p) => a + p.claimed_minor, 0), 'PLAY')} />
                <Kpi label="Rejected" value={d.promotions.filter((p) => p.status === 'rejected').length} />
              </div>
              {admin && pending.length > 0 && (
                <Section title="Review queue" subtitle="Approve to show it to players; a rejection needs a reason the organization will see.">
                  <ul className="divide-y divide-line">
                    {pending.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-start justify-between gap-4 py-4">
                        <div className="min-w-0 max-w-2xl">
                          <div className="text-xs text-muted">{p.owner_name} · {KIND_NAME[p.kind]} · {day(p.starts_at)} – {day(p.ends_at)}</div>
                          <div className="mt-1 font-semibold">{p.title}</div>
                          {p.body && <p className="mt-1 text-sm text-ink/80">{p.body}</p>}
                          {p.kind === 'org-drop' && <p className="mt-1 text-sm text-muted">{amount(p.amount_minor ?? 0, p.currency ?? '')} per player · budget {amount(p.budget_minor ?? 0, p.currency ?? '')}</p>}
                          <div className="mt-2 flex items-center gap-2 text-xs text-muted">Suggested: <ChoiceHint hint={p.hint} question="decision" /></div>
                        </div>
                        {write && <div className="flex gap-2"><Button size="sm" onClick={() => decide.mutate({ id: p.id, decision: 'approve' })}>Approve</Button><Button size="sm" variant="secondary" onClick={() => setRejecting(p)}>Reject</Button></div>}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              <Section title="All promotions">
                <DataTable rows={d.promotions} rowKey={(p) => p.id}
                  empty={<div className="py-8 text-center text-sm text-muted"><Gift className="mx-auto mb-2 text-accent/70" aria-hidden />No promotions yet.</div>}
                  columns={[
                    { key: 'title', header: 'Promotion', sort: (p) => p.title, cell: (p) => <div><div className="font-semibold">{p.title}</div><div className="text-xs text-muted">{p.owner_name ?? 'PreFlop'} · {KIND_NAME[p.kind]}</div></div> },
                    { key: 'amount', header: 'Value', cell: (p) => p.amount_minor ? `${amount(p.amount_minor, p.currency ?? 'PLAY')} each` : '—' },
                    { key: 'claimed', header: 'Claimed', align: 'right', sort: (p) => p.claimed_minor, cell: (p) => <span className="tabular-nums">{p.amount_minor ? amount(p.claimed_minor, p.currency ?? 'PLAY') : '—'}</span> },
                    { key: 'window', header: 'Runs', cell: (p) => <span className="whitespace-nowrap text-sm">{day(p.starts_at)} – {day(p.ends_at)}</span> },
                    { key: 'status', header: 'Status', cell: (p) => <div><Badge tone={statusTone(p.status)}>{p.status.replace('_', ' ')}</Badge>{p.review_note && <div className="mt-1 max-w-[220px] text-xs text-muted">{p.review_note}</div>}</div> },
                    { key: 'act', header: '', align: 'right', cell: (p) => admin && write && p.status === 'approved' ? <Button size="sm" variant="ghost" onClick={() => end.mutate(p.id)}>End now</Button> : null },
                  ]} />
              </Section>
            </div>
          );
        }}
      </QueryView>
      <PromoEditor open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog open={!!rejecting} onClose={() => setRejecting(null)} title={`Reject “${rejecting?.title ?? ''}”?`} confirmLabel="Reject" busy={decide.isPending}
        reason={{ label: 'Reason (shown to the organization)', placeholder: 'e.g. Wording suggests urgency; please remove “last chance”.', min: 5 }}
        onConfirm={(note) => rejecting && decide.mutate({ id: rejecting.id, decision: 'reject', note })} />
    </>
  );
}
