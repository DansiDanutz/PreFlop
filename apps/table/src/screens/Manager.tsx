import { Badge, PlayingCard, Spinner, cx } from '@preflop/ui';
import { AlertOctagon, Ban, Camera, CircleSlash, Gavel, Pause, Play, RefreshCw, Scale, UserRound } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ActionStatus, BigButton, Choice, HoldButton } from '../components/controls.tsx';
import { FlopEntry } from '../components/FlopEntry.tsx';
import { StateBadge } from '../components/RoundBits.tsx';
import { ApiProblem, type TableApi } from '../lib/api.ts';
import { sameFlop } from '../lib/cards.ts';
import { type Live, type Runner, myEntry } from '../lib/hooks.ts';
import type { Evidence, Round } from '../lib/types.ts';
import { FloorScreen } from './Floor.tsx';

type Tab = 'hand' | 'review' | 'table';

const VOID_REASONS = ['misdeal', 'exposed card', 'no flop', 'shuffler fault', 'other'] as const;
type VoidReason = (typeof VOID_REASONS)[number];
const PAUSE_REASONS = ['dealer change', 'equipment check', 'security check', 'other'] as const;
type PauseReason = (typeof PAUSE_REASONS)[number];

function ReasonPicker<T extends string>({ options, value, onChange, other, setOther }: { options: readonly T[]; value: T | null; onChange: (v: T) => void; other: string; setOther: (s: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Choice options={options} value={value} onChange={onChange} cols={options.length > 4 ? 3 : 2} render={(o) => o[0]!.toUpperCase() + o.slice(1)} />
      {value === 'other' && (
        <input autoFocus value={other} onChange={(e) => setOther(e.target.value)} placeholder="Describe the reason" maxLength={180}
          className="h-14 rounded-[14px] border border-line-strong bg-surface-2 px-4 text-lg outline-none focus:border-accent" />
      )}
    </div>
  );
}
const reasonText = (v: string | null, other: string) => (v === 'other' ? other.trim() : v ?? '');

// ------------------------------------------------------------------ review

function useEvidence(api: TableApi, roundId: string) {
  const [ev, setEv] = useState<Evidence | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'unavailable' | 'error'>('loading');
  const [err, setErr] = useState<string>('');
  const load = async () => {
    setStatus('loading');
    try {
      setEv(await api.evidence(roundId));
      setStatus('ok');
    } catch (e) {
      const p = e instanceof ApiProblem ? e : null;
      if (p?.status === 404) setStatus('unavailable');
      else { setStatus('error'); setErr(p?.message ?? String(e)); }
    }
  };
  useEffect(() => { setEv(null); void load(); }, [roundId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ev, status, err, reload: load };
}

function Section({ title, icon, children, className }: { title: ReactNode; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-[18px] border border-line bg-surface p-5', className)}>
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted">{icon}{title}</div>
      {children}
    </section>
  );
}

function CardsRow({ label, cards, who, tone }: { label: string; cards?: string[] | undefined; who?: string | undefined; tone?: 'accent' | 'warn' | undefined }) {
  return (
    <div className="flex items-center gap-4">
      <div className="w-28 shrink-0">
        <div className={cx('text-sm font-bold uppercase tracking-wider', tone === 'warn' ? 'text-warn' : tone === 'accent' ? 'text-accent' : 'text-ink')}>{label}</div>
        {who && <div className="flex items-center gap-1 truncate text-xs text-muted"><UserRound className="h-3 w-3" />{who}</div>}
      </div>
      <div className="flex gap-2">{cards?.length ? cards.map((c) => <PlayingCard key={c} code={c} size="sm" />) : <span className="text-sm text-faint">not available</span>}</div>
    </div>
  );
}

function ReviewPanel({ api, r, live, mem, runner }: { api: TableApi; r: Round; live: Live; mem: Record<string, string[]>; runner: Runner }) {
  const { ev, status, err, reload } = useEvidence(api, r.id);
  const [mode, setMode] = useState<'view' | 'settle' | 'void'>('view');
  const [reason, setReason] = useState<VoidReason | null>(null);
  const [other, setOther] = useState('');
  useEffect(() => { setMode('view'); setReason(null); setOther(''); }, [r.id]);
  const iEntered = !!myEntry(r, mem);
  const busy = !!runner.pending;
  const entries = ev?.entries ?? r.entries;
  const dealer = entries.find((e) => e.source === 'dealer');
  const floor = entries.find((e) => e.source === 'floor');
  const camera = ev?.capture?.cards;
  const reasons = r.review_reasons ?? [];

  if (mode === 'settle') {
    return (
      <div className="flex h-full flex-col gap-4">
        <FlopEntry resetKey={`${r.id}-settle`} busy={busy} tone="warn" submitLabel={`Settle hand ${r.hand_no}`}
          title={<>Settle hand {r.hand_no} with cards</>} subtitle="Enter the flop the evidence shows. Bets pay on these cards."
          aside={<BigButton tone="neutral" onClick={() => setMode('view')}>Back to evidence</BigButton>}
          onSubmit={(cards) => void runner.run(api.review(r.id, { action: 'settle', cards }))} />
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 gap-5 lg:grid-cols-[1.2fr_1fr]" data-testid="review-panel">
      <div className="flex min-h-0 flex-col gap-4 overflow-auto">
        <Section title={<>Hand {r.hand_no} · review reasons</>} icon={<AlertOctagon className="h-4 w-4 text-warn" />}>
          <ul className="flex flex-col gap-2">
            {reasons.length ? reasons.map((x) => <li key={x} className="rounded-[12px] border border-warn/40 bg-warn/10 px-4 py-2.5 text-base text-warn">{x}</li>) : <li className="text-muted">No reason recorded.</li>}
          </ul>
        </Section>
        <Section title="Board camera evidence" icon={<Camera className="h-4 w-4" />}>
          {status === 'loading' && <div className="flex items-center gap-3 text-muted"><Spinner /> Loading verified evidence…</div>}
          {status === 'unavailable' && <div className="rounded-[12px] border border-line-strong bg-surface-2 px-4 py-3 text-base text-muted">The evidence viewer is not available on this server yet. Check the board camera stream before deciding.</div>}
          {status === 'error' && <div className="flex items-center justify-between gap-3 text-danger"><span>{err}</span><BigButton tone="neutral" onClick={() => void reload()}><RefreshCw className="h-5 w-5" /> Retry</BigButton></div>}
          {ev?.image_data_url && <img src={ev.image_data_url} alt={`Board camera image, hand ${r.hand_no}`} className="w-full rounded-[12px] border border-line" data-testid="evidence-image" />}
          {status === 'ok' && !ev?.image_data_url && <div className="text-sm text-muted">No verified image stored.</div>}
        </Section>
      </div>
      <div className="flex min-h-0 flex-col gap-4 overflow-auto">
        <Section title="Readings" icon={<Scale className="h-4 w-4" />}>
          <div className="flex flex-col gap-3">
            <CardsRow label="Camera" cards={camera} tone="accent" />
            <CardsRow label="Dealer" cards={dealer?.cards ?? undefined} who={dealer?.person_id} tone={dealer?.cards && camera && !sameFlop(dealer.cards, camera) ? 'warn' : undefined} />
            <CardsRow label="Floor" cards={floor?.cards ?? undefined} who={floor?.person_id} tone={floor?.cards && camera && !sameFlop(floor.cards, camera) ? 'warn' : undefined} />
          </div>
        </Section>
        {iEntered && (
          <div className="rounded-[16px] border border-danger/50 bg-danger/10 px-5 py-4 text-base text-danger">You entered this flop, so the server will refuse your decision. Another floor manager must resolve it.</div>
        )}
        {mode === 'view' && (
          <Section title="Decision" icon={<Gavel className="h-4 w-4" />} className="flex flex-col">
            <p className="mb-4 text-base text-muted">Decide from the verified camera image. You cannot resolve a hand whose flop you entered.</p>
            <div className="flex flex-col gap-3">
              <BigButton tone="warn" className="h-20 text-2xl" disabled={busy} onClick={() => setMode('settle')} data-testid="btn-settle-cards"><Scale className="h-7 w-7" /> SETTLE WITH CARDS</BigButton>
              <BigButton tone="neutral" className="h-16 text-xl" disabled={busy} onClick={() => setMode('void')}><CircleSlash className="h-6 w-6 text-danger" /> VOID HAND</BigButton>
            </div>
          </Section>
        )}
        {mode === 'void' && (
          <Section title={<>Void hand {r.hand_no}</>} icon={<Ban className="h-4 w-4 text-danger" />}>
            <ReasonPicker options={VOID_REASONS} value={reason} onChange={setReason} other={other} setOther={setOther} />
            <div className="mt-4 flex gap-3">
              <BigButton tone="neutral" className="flex-1" onClick={() => setMode('view')}>Back</BigButton>
              <HoldButton tone="danger" className="flex-[2] text-lg" ms={900} busy={busy} disabled={!reasonText(reason, other)}
                onHold={() => void runner.run(api.review(r.id, { action: 'void', reason: reasonText(reason, other) }))}>Void · refund all</HoldButton>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ table controls

const VOIDABLE = new Set(['OPEN', 'LOCKED', 'DEALT', 'REVIEW']);

function TableControls({ api, live, runner }: { api: TableApi; live: Live; runner: Runner }) {
  const s = live.state!;
  const voidable = s.rounds.filter((r) => VOIDABLE.has(r.state));
  const [hand, setHand] = useState<number | null>(null);
  const [reason, setReason] = useState<VoidReason | null>(null);
  const [other, setOther] = useState('');
  const [pReason, setPReason] = useState<PauseReason | null>(null);
  const [pOther, setPOther] = useState('');
  const target = voidable.find((r) => r.hand_no === hand) ?? voidable.find((r) => r.state !== 'OPEN') ?? voidable[0];
  const busy = !!runner.pending;
  const paused = s.table.status === 'paused';
  return (
    <div className="grid h-full gap-5 overflow-auto lg:grid-cols-2">
      <Section title="Void hand" icon={<Ban className="h-4 w-4 text-danger" />}>
        {voidable.length === 0 ? <p className="text-base text-muted">No hand can be voided right now.</p> : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <span className="text-sm text-muted">Hand</span>
              <Choice options={voidable.map((r) => String(r.hand_no))} value={target ? String(target.hand_no) : null} onChange={(v) => setHand(Number(v))} cols={Math.max(2, voidable.length)}
                render={(v) => { const r = voidable.find((x) => String(x.hand_no) === v)!; return <span className="flex flex-col items-center"><span>Hand {v}</span><span className="text-xs font-medium text-muted">{r.state.toLowerCase()}</span></span>; }} />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm text-muted">Reason</span>
              <ReasonPicker options={VOID_REASONS} value={reason} onChange={setReason} other={other} setOther={setOther} />
            </div>
            <HoldButton tone="danger" ms={900} className="text-xl" busy={busy} disabled={!target || !reasonText(reason, other)}
              onHold={() => target && void runner.run(api.voidHand(target.hand_no, reasonText(reason, other)))}>
              VOID HAND {target?.hand_no ?? ''} · refund all
            </HoldButton>
          </div>
        )}
      </Section>
      <Section title="Table" icon={paused ? <Pause className="h-4 w-4 text-warn" /> : <Play className="h-4 w-4 text-accent" />}>
        <div className="mb-5 flex items-center gap-3">
          <Badge tone={paused ? 'warn' : 'accent'}>{s.table.status}</Badge>
          {s.table.pause_reason && <span className="text-base text-muted">{s.table.pause_reason}</span>}
        </div>
        {paused ? (
          <HoldButton tone="accent" className="w-full text-xl" busy={busy} onHold={() => void runner.run(api.resume())}>
            <span className="inline-flex items-center gap-3"><Play className="h-6 w-6" /> RESUME TABLE</span>
          </HoldButton>
        ) : (
          <div className="flex flex-col gap-4">
            <ReasonPicker options={PAUSE_REASONS} value={pReason} onChange={setPReason} other={pOther} setOther={setPOther} />
            <HoldButton tone="warn" className="w-full text-xl" busy={busy} disabled={!reasonText(pReason, pOther)} onHold={() => void runner.run(api.pause(reasonText(pReason, pOther)))}>
              <span className="inline-flex items-center gap-3"><Pause className="h-6 w-6" /> PAUSE TABLE</span>
            </HoldButton>
            <p className="text-sm text-muted">Pausing stops new betting. A hand already in progress continues; void it separately if needed.</p>
          </div>
        )}
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ screen

export function ManagerScreen({ api, live, mem, runner, submitFlop }: {
  api: TableApi; live: Live; mem: Record<string, string[]>; runner: Runner; submitFlop: (r: Round, cards: string[]) => void;
}) {
  const [tab, setTab] = useState<Tab>('hand');
  const [pick, setPick] = useState<string | null>(null);
  const s = live.state;
  const reviews = (s?.rounds ?? []).filter((r) => r.state === 'REVIEW');
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const fresh = reviews.find((r) => !seen.current.has(r.id));
    for (const r of reviews) seen.current.add(r.id);
    if (fresh && !myEntry(fresh, mem)) setTab('review');
  }, [reviews.map((r) => r.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = reviews.find((r) => r.id === pick) ?? reviews[0];

  const tabs: { k: Tab; label: string; icon: ReactNode; count?: number }[] = [
    { k: 'hand', label: 'Floor entry', icon: <Scale className="h-5 w-5" /> },
    { k: 'review', label: 'Review', icon: <Gavel className="h-5 w-5" />, count: reviews.length },
    { k: 'table', label: 'Void · Pause', icon: <Ban className="h-5 w-5" /> },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="flex gap-2 px-5 pt-4">
        {tabs.map((t) => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)} data-testid={`tab-${t.k}`}
            className={cx('inline-flex min-h-14 items-center gap-2 rounded-[14px] border px-5 text-base font-semibold',
              tab === t.k ? 'border-accent bg-accent-soft text-ink' : 'border-line text-muted active:text-ink')}>
            {t.icon}{t.label}
            {!!t.count && <span className="grid h-7 min-w-7 place-items-center rounded-full bg-warn px-2 text-sm font-bold text-black pf-pulse">{t.count}</span>}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1">
        {tab === 'hand' && (
          <FloorScreen live={live} mem={mem} runner={runner} submitFlop={submitFlop}
            banner={reviews.length > 0 ? (
              <button type="button" onClick={() => setTab('review')} className="flex min-h-14 items-center gap-3 rounded-[16px] border border-warn/60 bg-warn/10 px-5 text-left text-base font-semibold text-warn">
                <AlertOctagon className="h-6 w-6" /> Hand {reviews[0]!.hand_no} needs a review decision
              </button>
            ) : undefined} />
        )}
        {tab === 'review' && (
          <div className="flex h-full min-h-0 flex-col gap-4 p-5">
            <ActionStatus runner={runner} />
            {reviews.length > 1 && (
              <div className="flex gap-2">{reviews.map((r) => <BigButton key={r.id} tone={r.id === current?.id ? 'warn' : 'neutral'} onClick={() => setPick(r.id)}>Hand {r.hand_no}</BigButton>)}</div>
            )}
            {current ? <div className="min-h-0 flex-1"><ReviewPanel api={api} r={current} live={live} mem={mem} runner={runner} /></div> : (
              <div className="grid flex-1 place-items-center rounded-[22px] border border-dashed border-line-strong text-center">
                <div><div className="font-serif text-4xl">No hands in review</div><p className="mt-2 text-lg text-muted">When the dealer, floor and camera disagree, the hand appears here.</p>
                  {s?.rounds[0] && <div className="mt-4"><StateBadge r={s.rounds[0]} /></div>}</div>
              </div>
            )}
          </div>
        )}
        {tab === 'table' && s && <div className="flex h-full min-h-0 flex-col gap-4 p-5"><ActionStatus runner={runner} /><div className="min-h-0 flex-1"><TableControls api={api} live={live} runner={runner} /></div></div>}
      </div>
    </div>
  );
}
