import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ApiError, type PlayMode, type Tournament, type TournamentDetail, type TournamentStatus } from '@preflop/client';
import { Badge, Button, cx } from '@preflop/ui';
import { ArrowLeft, Ban, Clock, Plus, Swords } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { pctFromBps } from '../../lib/format.ts';
import {
  ADMIN_MODES, DURATION_PRESETS, ORG_MODES, PAYOUT_PRESETS, STATUS_TONE, formatCountdown, formatMinutes, isCancellable, isLive, isRealMode,
  paidLabel, parseSplit, payoutRows, previewLine, rankLabels, validateTournamentForm, type TournamentForm,
} from '../../lib/tournaments.ts';
import { useCanWrite, usePortal } from '../../components/Shell.tsx';
import { DataTable } from '../../components/DataTable.tsx';
import { Callout, ConfirmDialog, ErrorBox, Field, KeyVal, Kpi, Modal, PageHeader, QueryView, Section, Select, TextArea, TextInput, useAction } from '../../components/ui.tsx';
import { amount, day, localInput, MODE_CURRENCY, MODE_NAME, useScope } from './index.tsx';

/** Tournaments for the PreFlop team, clubs and organizers (docs/17). */

const MINOR_HINT: Record<string, string> = {
  PLAY: 'Whole free chips', CHIP: 'Whole chips', DIAMOND: 'Whole diamonds', EUR: 'Cents: 100 = €1.00', USDT: 'Micro-units: 1,000,000 = 1 USDT', USDC: 'Micro-units: 1,000,000 = 1 USDC',
};
const unitWord = (cur: string) => (cur === 'PLAY' ? ' free chips' : cur === 'CHIP' ? ' chips' : '');
const money = (minor: number, cur: string) => `${amount(minor, cur)}${unitWord(cur)}`;
const digits = (s: string) => s.replace(/\D/g, '');
const errorType = (e: unknown) => (e instanceof ApiError ? String(e.problem.type).split('/').pop() ?? '' : '');

function endsLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

function useBase() {
  return usePortal().key;
}

function StatusBadge({ s }: { s: TournamentStatus }) {
  return <Badge tone={STATUS_TONE[s]}>{s}</Badge>;
}

/** Text players see when a tournament is cancelled; shared by the list and the detail page. */
function CancelText({ t }: { t: Tournament }) {
  return (
    <>
      Every buy-in is refunded in full{t.entries ? <> to the <strong>{t.entries}</strong> {t.entries === 1 ? 'entrant' : 'entrants'}</> : ''}
      {t.added_minor ? <>, and the <strong>{money(t.added_minor, t.currency)}</strong> added to the pool goes back to whoever put it in</> : ''}.
      No fee is kept. Players see the reason.
    </>
  );
}

function useCancel(onDone: () => void) {
  const { admin, orgId } = useScope();
  return useAction((a: { t: Tournament; reason: string }) => (admin ? api.adminCancelTournament(a.t.id, a.reason) : api.orgCancelTournament(orgId!, a.t.id, a.reason)),
    { invalidate: [['tournaments']], success: 'Tournament cancelled; every buy-in was refunded.', onSuccess: onDone });
}

// ------------------------------------------------------------------ create

function emptyForm(mode: PlayMode): TournamentForm {
  const start = new Date(Date.now() + 60 * 60_000);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  return {
    name: '', description: '', mode, currency: MODE_CURRENCY[mode]![0]!, buy_in: mode === 'play' ? '1000' : '0', fee_pct: '10', added: '',
    starting_stack: '10000', bets_allowed: '20', min_stake: '', max_stake: '', starts: localInput(start), duration_minutes: '60',
    late_reg_minutes: '0', min_entries: '2', max_entries: '', split: '50, 30, 20',
  };
}

function Chips({ label, options, active, onPick }: { label: string; options: { label: string; value: string }[]; active: string; onPick: (v: string) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === active} onClick={() => onPick(o.value)}
          className={cx('h-7 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold transition-colors',
            o.value === active ? 'border-accent/60 bg-accent-soft text-accent' : 'border-line-strong text-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TournamentEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { admin, orgId } = useScope();
  const nav = useNavigate();
  const base = useBase();
  const modes = admin ? ADMIN_MODES : ORG_MODES;
  const [f, setF] = useState<TournamentForm>(() => emptyForm(modes[0]!));
  const [tried, setTried] = useState(false);
  useEffect(() => { if (open) { setF(emptyForm(modes[0]!)); setTried(false); } }, [open]);
  const set = (p: Partial<TournamentForm>) => setF((x) => ({ ...x, ...p }));
  const { errors, input } = validateTournamentForm(f, { admin });
  const shown = tried ? errors : {};
  const real = isRealMode(f.mode);
  const save = useAction(async () => (admin ? api.adminCreateTournament(input!) : api.orgCreateTournament(orgId!, input!)), {
    invalidate: [['tournaments']], success: (t) => `Tournament “${t.name}” scheduled.`,
    onSuccess: (t) => { onClose(); nav(`${base}/tournaments/${t.id}`); },
  });
  const submit = () => { setTried(true); if (input) save.mutate(undefined); };

  // Live preview from whatever parses so far.
  const n = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
  const startMs = f.starts ? new Date(f.starts).getTime() : Number.NaN;
  const dur = n(f.duration_minutes), stack = n(f.starting_stack), bets = n(f.bets_allowed);
  const places = parseSplit(f.split)?.length ?? 1;
  const added = n(f.added || '0') ?? 0;
  const preview = stack && bets && dur && Number.isFinite(startMs)
    ? previewLine({ starting_stack: stack, bets_allowed: bets, buy_in_minor: n(f.buy_in || '0') ?? 0, added_minor: added, addedLabel: money(added, f.currency), places, endsLabel: endsLabel(startMs + dur * 60_000) })
    : null;
  const buyIn = n(f.buy_in || '0');
  const fieldErr = (k: keyof TournamentForm) => shown[k] ?? null;

  return (
    <Modal open={open} onClose={onClose} wide title="New tournament"
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" disabled={save.isPending || (tried && !input)} onClick={submit}>Schedule tournament</Button></>}>
      <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Name" className="md:col-span-2" error={fieldErr('name')}>{(p) => <TextInput {...p} value={f.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="Friday Flop Sprint" />}</Field>
        <Field label="Description (optional)" className="md:col-span-2">{(p) => <TextArea {...p} rows={2} className="min-h-18! font-sans" value={f.description} maxLength={600} onChange={(e) => set({ description: e.target.value })} placeholder="What players should know before they register." />}</Field>

        <Field label="Currency" error={fieldErr('mode')} hint={admin ? 'Chips and diamonds tournaments belong to a club or organizer and are created from its portal.' : 'Your closed loop: prizes are paid in your chips or diamonds.'}>{(p) => (
          <Select {...p} value={f.mode} onChange={(e) => { const m = e.target.value as PlayMode; set({ mode: m, currency: MODE_CURRENCY[m]![0]! }); }}>
            {modes.map((m) => <option key={m} value={m}>{MODE_NAME[m]}</option>)}
          </Select>)}</Field>
        {MODE_CURRENCY[f.mode]!.length > 1 ? (
          <Field label="Coin">{(p) => <Select {...p} value={f.currency} onChange={(e) => set({ currency: e.target.value })}>{MODE_CURRENCY[f.mode]!.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
        ) : <div className="hidden md:block" />}

        <Field label={`Buy-in (${f.currency}, minor units)`} error={fieldErr('buy_in')}
          hint={`${MINOR_HINT[f.currency] ?? 'Minor units'} · ${buyIn === 0 ? '0 makes a freeroll.' : buyIn !== null ? `${money(buyIn, f.currency)} per entry.` : ''}`}>
          {(p) => <TextInput {...p} inputMode="numeric" value={f.buy_in} onChange={(e) => set({ buy_in: digits(e.target.value) })} />}</Field>
        <Field label="Fee (% of buy-ins)" error={fieldErr('fee_pct')} hint={buyIn === 0 ? 'Never charged on a freeroll.' : `0–20%. Kept by ${admin ? 'PreFlop' : 'your treasury'} at completion; never on a cancelled tournament.`}>
          {(p) => <TextInput {...p} inputMode="decimal" value={f.fee_pct} disabled={buyIn === 0} onChange={(e) => set({ fee_pct: e.target.value })} />}</Field>
        <Field label={`Added to the prize pool (${f.currency}, minor units)`} error={fieldErr('added')} className="md:col-span-2"
          hint={admin ? 'Optional. Sponsored by PreFlop, taken at creation and returned if the tournament is cancelled.' : 'Optional. Moved from your treasury at creation and returned if the tournament is cancelled.'}>
          {(p) => <TextInput {...p} inputMode="numeric" value={f.added} onChange={(e) => set({ added: digits(e.target.value) })} placeholder="0" />}</Field>

        <Field label="Starting stack (points)" error={fieldErr('starting_stack')} hint="Tournament points; no cash value.">
          {(p) => <TextInput {...p} inputMode="numeric" value={f.starting_stack} onChange={(e) => set({ starting_stack: digits(e.target.value) })} />}</Field>
        <Field label="Bets per player" error={fieldErr('bets_allowed')} hint="1–500. Every bet counts, won or lost.">
          {(p) => <TextInput {...p} inputMode="numeric" value={f.bets_allowed} onChange={(e) => set({ bets_allowed: digits(e.target.value) })} />}</Field>
        <Field label="Minimum stake (points)" error={fieldErr('min_stake')} hint="Blank: 1. Below this stack a player is out.">
          {(p) => <TextInput {...p} inputMode="numeric" value={f.min_stake} onChange={(e) => set({ min_stake: digits(e.target.value) })} placeholder="1" />}</Field>
        <Field label="Maximum stake (points)" error={fieldErr('max_stake')} hint="Blank: up to the whole stack.">
          {(p) => <TextInput {...p} inputMode="numeric" value={f.max_stake} onChange={(e) => set({ max_stake: digits(e.target.value) })} placeholder="No limit" />}</Field>

        <Field label="Starts" error={fieldErr('starts')} hint="Your local time.">
          {(p) => <TextInput {...p} type="datetime-local" value={f.starts} onChange={(e) => set({ starts: e.target.value })} />}</Field>
        <div className="flex flex-col gap-2">
          <Field label="Duration (minutes)" error={fieldErr('duration_minutes')} hint={n(f.duration_minutes) ? `${formatMinutes(n(f.duration_minutes)!)} · 5 minutes to 7 days.` : '5 minutes to 7 days.'}>
            {(p) => <TextInput {...p} inputMode="numeric" value={f.duration_minutes} onChange={(e) => set({ duration_minutes: digits(e.target.value) })} />}</Field>
          <Chips label="Duration presets" active={f.duration_minutes} onPick={(v) => set({ duration_minutes: v })}
            options={DURATION_PRESETS.map((d) => ({ label: d.label, value: String(d.minutes) }))} />
        </div>
        <Field label="Late registration (minutes)" error={fieldErr('late_reg_minutes')} hint="Registration stays open this long after the start. A late entrant gets the full stack and every bet.">
          {(p) => <TextInput {...p} inputMode="numeric" value={f.late_reg_minutes} onChange={(e) => set({ late_reg_minutes: digits(e.target.value) })} />}</Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Min entries" error={fieldErr('min_entries')} hint="Fewer at the start: cancelled and refunded.">
            {(p) => <TextInput {...p} inputMode="numeric" value={f.min_entries} onChange={(e) => set({ min_entries: digits(e.target.value) })} placeholder="2" />}</Field>
          <Field label="Max entries" error={fieldErr('max_entries')} hint="Blank: no cap.">
            {(p) => <TextInput {...p} inputMode="numeric" value={f.max_entries} onChange={(e) => set({ max_entries: digits(e.target.value) })} placeholder="No cap" />}</Field>
        </div>

        <div className="flex flex-col gap-2 md:col-span-2">
          <Field label="Payout split (% per final position)" error={shown.split ?? errors.split ?? null} hint="e.g. 50, 30, 20 pays the top three. Must add up to 100.">
            {(p) => <TextInput {...p} value={f.split} onChange={(e) => set({ split: e.target.value })} />}</Field>
          <Chips label="Payout presets" active={f.split} onPick={(v) => set({ split: v })} options={PAYOUT_PRESETS.map((x) => ({ label: x.label, value: x.split }))} />
        </div>
        <button type="submit" hidden />
      </form>

      {preview && <p className="mt-5 rounded-[10px] border border-line bg-surface-2 px-4 py-3 text-sm text-ink" aria-live="polite"><span className="font-semibold text-accent">Preview · </span>{preview}</p>}
      {real && <div className="mt-4"><Callout tone="warn" title="Real money is switched off">Real-money tournaments are refused (mode_disabled) until the mode is enabled in Settings.</Callout></div>}
      {f.mode === 'play' && <div className="mt-4"><Callout tone="accent" title="Free-chip tournaments pay free chips and badges only">Nothing with cash value is ever paid on a free-chip tournament.</Callout></div>}
      {save.isError && (
        <div className="mt-4">
          {errorType(save.error) === 'mode_disabled'
            ? <Callout tone="danger" title="Real money is off">The API refused this tournament because {MODE_NAME[f.mode] ?? f.mode} is switched off. Turn the mode on in Settings first.</Callout>
            : <ErrorBox error={save.error} />}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ list

function poolsByCurrency(ts: Tournament[]): string {
  const m = new Map<string, number>();
  for (const t of ts) m.set(t.currency, (m.get(t.currency) ?? 0) + t.prize_pool_minor);
  return m.size ? [...m].map(([c, v]) => money(v, c)).join(' · ') : '—';
}

export function Tournaments() {
  const { admin, orgId, kind } = useScope();
  const write = useCanWrite();
  const base = useBase();
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<Tournament | null>(null);
  const q = useQuery({ queryKey: ['tournaments', admin ? 'admin' : orgId], queryFn: () => (admin ? api.adminTournaments() : api.orgTournaments(orgId!)), refetchInterval: 15_000 });
  const cancel = useCancel(() => setCancelling(null));
  return (
    <>
      <PageHeader eyebrow={kind === 'club' ? 'Play' : 'Growth'} title="Tournaments"
        subtitle={admin
          ? 'Timed contests on the live flops: same buy-in, same stack, same number of bets. Real-money tournaments stay closed until real money is on.'
          : 'Run chips or diamonds tournaments for your players. Fees go to your treasury; prizes are paid automatically at the end.'}
        actions={write && <Button size="sm" onClick={() => setCreating(true)}><Plus size={15} aria-hidden />New tournament</Button>} />
      <QueryView q={q} what="tournaments">
        {(d) => {
          const running = d.tournaments.filter((t) => isLive(t.status));
          const today = new Date().toDateString();
          const entriesToday = d.tournaments.filter((t) => new Date(t.starts_at).toDateString() === today && t.status !== 'cancelled').reduce((a, t) => a + t.entries, 0);
          const entriesAll = d.tournaments.filter((t) => t.status !== 'cancelled').reduce((a, t) => a + t.entries, 0);
          return (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi label="Running now" value={running.length} tone={running.length ? 'accent' : undefined}
                  hint={running.some((t) => t.status === 'settling') ? `${running.filter((t) => t.status === 'settling').length} settling` : undefined} />
                <Kpi label="Upcoming" value={d.tournaments.filter((t) => t.status === 'scheduled').length} />
                <Kpi label="Entries today" value={entriesToday.toLocaleString('en-US')} hint={`${entriesAll.toLocaleString('en-US')} in total`} />
                <Kpi label="Prize pools live" value={<span className="text-[22px] md:text-[26px]">{poolsByCurrency(running)}</span>} />
              </div>
              <Section title="All tournaments">
                <DataTable rows={d.tournaments} rowKey={(t) => t.id} initialSort={{ key: 'start', dir: 'desc' }}
                  empty={<div className="py-8 text-center text-sm text-muted"><Swords className="mx-auto mb-2 text-accent/70" aria-hidden />No tournaments yet.{write ? ' Schedule one to give players a timed contest on the live flops.' : ''}</div>}
                  columns={[
                    { key: 'name', header: 'Tournament', sort: (t) => t.name, cell: (t) => (
                      <div className="min-w-[160px]"><Link to={`${base}/tournaments/${t.id}`} className="font-semibold hover:text-accent">{t.name}</Link><div className="text-xs text-muted">{t.owner_name}</div></div>) },
                    { key: 'mode', header: 'Currency', sort: (t) => t.mode, cell: (t) => <span className="whitespace-nowrap">{MODE_NAME[t.mode] ?? t.mode}{t.mode === 'real-crypto' ? ` · ${t.currency}` : ''}</span> },
                    { key: 'buyin', header: 'Buy-in', align: 'right', sort: (t) => t.buy_in_minor, cell: (t) => <span className="whitespace-nowrap tabular-nums">{t.buy_in_minor ? amount(t.buy_in_minor, t.currency) : 'Freeroll'}</span> },
                    { key: 'entries', header: 'Entries', align: 'right', sort: (t) => t.entries, cell: (t) => <span className="tabular-nums">{t.entries}{t.max_entries ? <span className="text-muted"> / {t.max_entries}</span> : ''}</span> },
                    { key: 'pool', header: 'Prize pool', align: 'right', sort: (t) => t.prize_pool_minor, cell: (t) => <span className="whitespace-nowrap tabular-nums">{amount(t.prize_pool_minor, t.currency)}</span> },
                    { key: 'start', header: 'Starts', sort: (t) => t.starts_at, cell: (t) => <div className="whitespace-nowrap text-sm">{day(t.starts_at)}<div className="text-xs text-muted">runs {formatMinutes(t.duration_minutes)}</div></div> },
                    { key: 'status', header: 'Status', sort: (t) => t.status, cell: (t) => <StatusBadge s={t.status} /> },
                    { key: 'act', header: '', align: 'right', cell: (t) => (
                      <div className="relative flex justify-end gap-2">
                        <Link to={`${base}/tournaments/${t.id}`} className="inline-flex h-8 items-center rounded-full border border-line-strong px-3 text-[13px] font-semibold text-ink hover:border-accent/60">View<span className="sr-only"> {t.name}</span></Link>
                        {write && isCancellable(t.status) && <Button size="sm" variant="ghost" onClick={() => setCancelling(t)}>Cancel<span className="sr-only"> {t.name}</span></Button>}
                      </div>) },
                  ]} />
              </Section>
            </div>
          );
        }}
      </QueryView>
      <TournamentEditor open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog open={!!cancelling} onClose={() => setCancelling(null)} title={`Cancel “${cancelling?.name ?? ''}”?`} confirmLabel="Cancel tournament" busy={cancel.isPending}
        reason={{ label: 'Reason (shown to players)', placeholder: 'e.g. Table maintenance during the tournament window.', min: 5 }}
        onConfirm={(reason) => cancelling && cancel.mutate({ t: cancelling, reason })}>
        {cancelling && <CancelText t={cancelling} />}
      </ConfirmDialog>
    </>
  );
}

// ------------------------------------------------------------------ detail

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function Countdown({ d, fetchedAt }: { d: TournamentDetail; fetchedAt: number }) {
  const t = d.tournament;
  // Server clock = device clock + offset, measured when the detail was fetched.
  const offset = useMemo(() => Date.parse(d.server_time) - fetchedAt, [d.server_time, fetchedAt]);
  const ticking = t.status === 'scheduled' || t.status === 'running';
  const now = useNow(ticking) + offset;
  const pending = d.standings.reduce((a, s) => a + s.pending_bets, 0);
  const [label, value, sub] =
    t.status === 'scheduled' ? ['Starts in', formatCountdown(Date.parse(t.starts_at) - now), `${day(t.starts_at)} · registration ${t.registration_open ? 'open' : 'closed'}`]
    : t.status === 'running' ? ['Ends in', formatCountdown(Date.parse(t.ends_at) - now), `${day(t.ends_at)} · ${Date.parse(t.late_reg_until) > now ? `late registration until ${day(t.late_reg_until)}` : 'registration closed'}`]
    : t.status === 'settling' ? ['Settling', `${pending} ${pending === 1 ? 'bet' : 'bets'}`, 'The clock has ended; waiting for placed bets to settle with their flop.']
    : t.status === 'completed' ? ['Completed', day(t.ends_at), 'Prizes paid; fee kept.']
    : ['Cancelled', '—', t.cancel_reason ?? 'Every buy-in refunded.'];
  return (
    <div className={cx('flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[12px] border px-5 py-4', isLive(t.status) ? 'border-accent/50 bg-accent-soft' : t.status === 'cancelled' ? 'border-danger/50 bg-danger/10' : 'border-line bg-surface')}
      role="timer" aria-live="off">
      <Clock size={20} className={t.status === 'cancelled' ? 'text-danger' : 'text-accent'} aria-hidden />
      <div className="text-[13px] text-ink/80">{label}</div>
      <div className="font-serif text-[30px] leading-none tabular-nums">{value}</div>
      <div className="min-w-0 basis-full text-xs text-muted sm:basis-auto">{sub}</div>
    </div>
  );
}

export function TournamentDetailPage() {
  const { id = '' } = useParams();
  const { admin, orgId } = useScope();
  const write = useCanWrite();
  const base = useBase();
  const [cancelling, setCancelling] = useState(false);
  const q = useQuery({
    queryKey: ['tournaments', admin ? 'admin' : orgId, 'detail', id],
    // Org members read their own tournaments' standings through the public endpoint.
    queryFn: () => (admin ? api.adminTournament(id) : api.tournament(id)),
    refetchInterval: (query) => {
      const s = query.state.data?.tournament.status;
      return s === 'running' || s === 'settling' ? 5000 : s === 'scheduled' ? 15_000 : false;
    },
  });
  const cancel = useCancel(() => setCancelling(false));
  return (
    <>
      <Link to={`${base}/tournaments`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={14} aria-hidden />Tournaments</Link>
      <QueryView q={q} what="this tournament">
        {(d) => {
          const t = d.tournament;
          const mine = admin || t.owner_org === orgId;
          const buyIns = t.buy_in_minor * t.entries;
          const fee = Math.floor((buyIns * t.fee_bps) / 10_000);
          const rows = payoutRows(t.prize_pool_minor, t.payout_bps, t.entries || undefined);
          const labels = rankLabels(d.standings);
          const standings = d.standings.map((s, i) => ({ ...s, idx: i, label: labels[i]! }));
          return (
            <>
              <PageHeader eyebrow={<>Tournament · {t.owner_name}</>} title={<>{t.name} <span className="align-middle"><StatusBadge s={t.status} /></span></>}
                subtitle={t.description || `${MODE_NAME[t.mode] ?? t.mode} · ${t.buy_in_minor ? `${money(t.buy_in_minor, t.currency)} buy-in` : 'freeroll'} · ${formatMinutes(t.duration_minutes)}`}
                actions={write && mine && isCancellable(t.status) && <Button size="sm" variant="danger" onClick={() => setCancelling(true)}><Ban size={14} aria-hidden />Cancel tournament</Button>} />
              <div className="space-y-6">
                <Countdown d={d} fetchedAt={q.dataUpdatedAt} />
                {t.status === 'cancelled' && t.cancel_reason && <Callout tone="danger" title="Cancelled">{t.cancel_reason}. Every buy-in was refunded and the added amount returned.</Callout>}
                {isRealMode(t.mode) && t.status === 'scheduled' && <Callout tone="warn" title="Real money is off">Registration and bets are refused until the real-money mode is switched on.</Callout>}

                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                  <Kpi label="Entries" value={<>{t.entries}{t.max_entries ? <span className="text-[20px] text-muted"> / {t.max_entries}</span> : ''}</>} hint={`Needs ${t.min_entries} to start`} />
                  <Kpi label="Prize pool" value={amount(t.prize_pool_minor, t.currency)} tone="accent" hint={MODE_NAME[t.mode]} />
                  <Kpi label="Fee" value={amount(fee, t.currency)} hint={`${pctFromBps(t.fee_bps)} of ${amount(buyIns, t.currency)} buy-ins`} />
                  <Kpi label="Added" value={amount(t.added_minor, t.currency)} hint={admin ? 'Sponsored' : 'From the treasury'} />
                  <Kpi label="Pool per paid place" value={rows.length ? amount(Math.floor(t.prize_pool_minor / rows.length), t.currency) : '—'} hint={`${rows.length} ${rows.length === 1 ? 'place' : 'places'} · ${paidLabel(rows.length)}`} />
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <Section title="Payouts" subtitle={t.status === 'completed' ? 'Final.' : t.entries && t.entries < t.payout_bps.length ? 'Fewer entrants than paid places: the shares are scaled up to 100%.' : 'Projected from the current prize pool.'}>
                    <DataTable rows={rows} rowKey={(r) => String(r.position)} dense
                      empty="No paid places."
                      columns={[
                        { key: 'pos', header: 'Position', cell: (r) => <span className="font-semibold tabular-nums">{r.position}</span> },
                        { key: 'pct', header: 'Share', align: 'right', cell: (r) => <span className="tabular-nums">{pctFromBps(r.bps)}</span> },
                        { key: 'amt', header: 'Prize', align: 'right', cell: (r) => <span className="tabular-nums">{money(r.amount_minor, t.currency)}</span> },
                      ]} />
                  </Section>
                  <Section title="Rules">
                    <KeyVal items={[
                      ['Buy-in', t.buy_in_minor ? money(t.buy_in_minor, t.currency) : 'Freeroll'],
                      ['Each player gets', `${t.starting_stack.toLocaleString('en-US')} points · ${t.bets_allowed} ${t.bets_allowed === 1 ? 'bet' : 'bets'}`],
                      ['Stake per bet', `${t.min_stake.toLocaleString('en-US')} – ${t.max_stake ? t.max_stake.toLocaleString('en-US') : 'whole stack'} points`],
                      ['Runs', `${day(t.starts_at)} – ${day(t.ends_at)}`],
                      ['Registration closes', day(t.late_reg_until)],
                      ['Entries', `min ${t.min_entries} · ${t.max_entries ? `max ${t.max_entries}` : 'no cap'}`],
                      ['Ranking', 'Biggest stack; on the same stack, fewer bets used. Same stack and bets: a tie.'],
                    ]} />
                  </Section>
                </div>

                <Section title="Standings" subtitle={isLive(t.status) ? 'Refreshes every 5 seconds. Prizes are projected from current positions.' : t.status === 'completed' ? 'Final positions and prizes paid.' : 'Registered players.'}>
                  <DataTable rows={standings} rowKey={(s) => String(s.idx)} caption="Tournament standings"
                    empty={<div className="py-6 text-center"><Swords className="mx-auto mb-2 text-accent/70" aria-hidden />No entries yet.</div>}
                    columns={[
                      { key: 'rank', header: 'Rank', sort: (s) => s.rank, cell: (s) => <span className="font-semibold tabular-nums">{s.label}</span> },
                      { key: 'player', header: 'Player', sort: (s) => s.display_name, cell: (s) => <span className="whitespace-nowrap">{s.display_name}</span> },
                      { key: 'stack', header: 'Stack', align: 'right', sort: (s) => s.stack, cell: (s) => <span className="tabular-nums">{s.stack.toLocaleString('en-US')}</span> },
                      { key: 'used', header: 'Bets used', align: 'right', sort: (s) => s.bets_used, cell: (s) => <span className="tabular-nums">{s.bets_used}</span> },
                      { key: 'left', header: 'Bets left', align: 'right', sort: (s) => s.bets_left, cell: (s) => <span className="tabular-nums">{s.bets_left}</span> },
                      { key: 'pending', header: 'Pending', align: 'right', sort: (s) => s.pending_bets, cell: (s) => <span className={cx('tabular-nums', s.pending_bets ? 'text-info' : 'text-muted')}>{s.pending_bets}</span> },
                      { key: 'status', header: 'Status', cell: (s) => <Badge tone={s.status === 'playing' ? 'accent' : s.status === 'busted' ? 'danger' : 'muted'}>{s.status}</Badge> },
                      { key: 'prize', header: 'Prize', align: 'right', sort: (s) => s.prize_minor, cell: (s) => <span className="whitespace-nowrap tabular-nums">{s.prize_minor ? money(s.prize_minor, t.currency) : '—'}</span> },
                    ]} />
                </Section>
              </div>
              <ConfirmDialog open={cancelling} onClose={() => setCancelling(false)} title={`Cancel “${t.name}”?`} confirmLabel="Cancel tournament" busy={cancel.isPending}
                reason={{ label: 'Reason (shown to players)', placeholder: 'e.g. Table maintenance during the tournament window.', min: 5 }}
                onConfirm={(reason) => cancel.mutate({ t, reason })}>
                <CancelText t={t} />
              </ConfirmDialog>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
