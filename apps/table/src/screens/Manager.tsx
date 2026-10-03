import { Badge, PlayingCard, Spinner, cx } from '@preflop/ui';
import { AlertOctagon, Ban, Camera, CameraOff, CircleSlash, Gavel, Hourglass, Pause, Play, RefreshCw, Scale, UserRound, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ActionStatus, BigButton, Choice, HoldButton, Sheet } from '../components/controls.tsx';
import { FlopEntry } from '../components/FlopEntry.tsx';
import { StateBadge } from '../components/RoundBits.tsx';
import { ApiProblem, type TableApi } from '../lib/api.ts';
import { sameFlop } from '../lib/cards.ts';
import { EvidenceLoader, type EvidenceStatus, type EvidenceView, decisionAllowed, viewFor } from '../lib/evidence.ts';
import { type Live, type Runner, myEntry, useNow } from '../lib/hooks.ts';
import { type Countdown, type TrackedReview, reviewAlert, reviewCountdown, reviewDeadlineMs, trackReviews } from '../lib/review.ts';
import type { Round } from '../lib/types.ts';
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

/**
 * Evidence for one round, keyed by its id (lib/evidence.ts): switching hands aborts the earlier
 * request and ignores its late answer, and the view returned always belongs to `roundId`.
 */
function useEvidence(api: TableApi, roundId: string) {
  const [view, setView] = useState<EvidenceView | null>(null);
  const loader = useMemo(() => new EvidenceLoader((id, signal) => api.evidence(id, signal), setView), [api]);
  useEffect(() => {
    void loader.load(roundId);
    return () => loader.dispose();
  }, [loader, roundId]);
  return { view: viewFor(view, roundId), reload: () => void loader.load(roundId) };
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

/** Live countdown to the review deadline (server time). Hidden when the deadline is unknown. */
function ReviewCountdownBar({ c, handNo }: { c: Countdown | null; handNo: number }) {
  if (!c) return null;
  if (c.level === 'expired') {
    return (
      <div role="alert" data-testid="review-countdown" data-level="expired" className="flex items-center gap-3 rounded-[16px] border border-danger/60 bg-danger/15 px-5 py-4 text-base font-semibold text-danger">
        <Hourglass className="h-6 w-6 shrink-0" />
        <span>Review deadline passed. PreFlop is voiding hand {handNo} automatically and refunding all bets; a decision now will be refused.</span>
      </div>
    );
  }
  const warn = c.level === 'warn';
  return (
    <div role={warn ? 'alert' : 'status'} data-testid="review-countdown" data-level={c.level}
      className={cx('flex items-center gap-3 rounded-[16px] border px-5 py-3 text-base', warn ? 'border-danger/60 bg-danger/15 text-danger' : 'border-line-strong bg-surface-2 text-muted')}>
      <Hourglass className={cx('h-6 w-6 shrink-0', warn && 'pf-pulse')} />
      <span className="flex-1">{warn ? <b>Less than 2 minutes left to decide.</b> : 'Time left to decide'} At the deadline hand {handNo} is voided automatically and all bets refunded.</span>
      <span className={cx('font-mono text-3xl font-bold tabular-nums', warn ? 'text-danger' : 'text-ink')}>{c.label}</span>
    </div>
  );
}

/**
 * Explicit check before "Settle with cards": the manager confirms they looked at the verified board
 * camera image. Without an image the sheet says so plainly and asks for a press-and-hold instead.
 */
function CameraCheckSheet({ handNo, image, camera, status, onConfirm, onClose }: {
  handNo: number; image: string | null | undefined; camera: string[] | undefined; status: EvidenceStatus; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Sheet title={<>Settle hand {handNo}: check the camera</>} onClose={onClose} wide>
      <div data-testid="camera-check">
        {image ? (
          <>
            <img src={image} alt={`Board camera image, hand ${handNo}`} className="max-h-[46vh] w-full rounded-[12px] border border-line object-contain" />
            {!!camera?.length && <div className="mt-3 flex items-center gap-3 text-sm text-muted">Camera read: <span className="flex gap-2">{camera.map((c) => <PlayingCard key={c} code={c} size="sm" />)}</span></div>}
            <p className="mt-4 text-base text-muted">Bets pay on the cards you enter next. Look at the image above and compare it with the board before you continue.</p>
            <div className="mt-5 flex gap-3">
              <BigButton tone="neutral" className="flex-1" onClick={onClose}>Back</BigButton>
              <BigButton tone="warn" className="flex-[2]" onClick={onConfirm} data-testid="confirm-camera-checked">
                <Camera className="h-6 w-6" /> I checked the board camera image
              </BigButton>
            </div>
          </>
        ) : status === 'loading' ? (
          <div className="flex items-center gap-3 text-muted"><Spinner /> Loading the verified camera image…</div>
        ) : (
          <>
            <div role="alert" className="flex items-start gap-3 rounded-[14px] border border-danger/60 bg-danger/15 px-5 py-4 text-base text-danger" data-testid="no-camera-image">
              <CameraOff className="mt-0.5 h-6 w-6 shrink-0" />
              <span><b>There is no verified board camera image for hand {handNo}.</b> {status === 'error' ? 'The evidence could not be loaded.' : status === 'unavailable' ? 'This server has no evidence viewer.' : 'None was stored for this hand.'} Only settle if you have checked the board camera stream (or the physical board) yourself; otherwise void the hand.</span>
            </div>
            <div className="mt-5 flex gap-3">
              <BigButton tone="neutral" className="flex-1" onClick={onClose}>Back</BigButton>
              <HoldButton tone="danger" ms={1200} className="flex-[2] text-base" onHold={onConfirm} hint="Press and hold to confirm">
                <span data-testid="confirm-no-image">No image: I checked the camera stream myself</span>
              </HoldButton>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

/**
 * One round's review. Mounted with `key={r.id}`, so all of its state (mode, held reason, camera
 * check, evidence) starts fresh for every round; on top of that, every decision checks that the
 * evidence on screen belongs to the round it is about to decide (decisionAllowed).
 */
function ReviewPanel({ api, r, mem, runner }: { api: TableApi; r: Round; mem: Record<string, string[]>; runner: Runner }) {
  const { view, reload } = useEvidence(api, r.id);
  const { ev, status, err } = view;
  const [mode, setMode] = useState<'view' | 'settle' | 'void'>('view');
  const [checking, setChecking] = useState(false);
  const [reason, setReason] = useState<VoidReason | null>(null);
  const [other, setOther] = useState('');
  const ready = decisionAllowed(view, r.id);
  /** Runs a review decision for this round only if the evidence on screen is this round's. */
  const decide = (d: Parameters<TableApi['review']>[1]) => {
    if (!decisionAllowed(view, r.id)) return;
    void runner.run(api.review(r.id, d));
  };
  // Server time: the tablet clock corrected by the measured offset.
  const now = useNow(1000) + api.clockOffsetMs;
  const countdown = reviewCountdown(reviewDeadlineMs(r), now);
  const expired = countdown?.level === 'expired';
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
        <ReviewCountdownBar c={countdown} handNo={r.hand_no} />
        <FlopEntry resetKey={`${r.id}-settle`} busy={busy || expired} tone="warn" submitLabel={`Settle hand ${r.hand_no}`}
          title={<>Settle hand {r.hand_no} with cards</>} subtitle="Enter the flop the evidence shows. Bets pay on these cards."
          aside={<BigButton tone="neutral" onClick={() => setMode('view')}>Back to evidence</BigButton>}
          onSubmit={(cards) => decide({ action: 'settle', cards })} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
    <ReviewCountdownBar c={countdown} handNo={r.hand_no} />
    <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[1.2fr_1fr]" data-testid="review-panel" data-round-id={r.id} data-evidence-round-id={view.roundId}>
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
              <BigButton tone="warn" className="h-20 text-2xl" disabled={busy || expired || !ready} onClick={() => setChecking(true)} data-testid="btn-settle-cards"><Scale className="h-7 w-7" /> SETTLE WITH CARDS</BigButton>
              <BigButton tone="neutral" className="h-16 text-xl" disabled={busy || expired || !ready} onClick={() => setMode('void')}><CircleSlash className="h-6 w-6 text-danger" /> VOID HAND</BigButton>
            </div>
          </Section>
        )}
        {mode === 'void' && (
          <Section title={<>Void hand {r.hand_no}</>} icon={<Ban className="h-4 w-4 text-danger" />}>
            <ReasonPicker options={VOID_REASONS} value={reason} onChange={setReason} other={other} setOther={setOther} />
            <div className="mt-4 flex gap-3">
              <BigButton tone="neutral" className="flex-1" onClick={() => setMode('view')}>Back</BigButton>
              <HoldButton tone="danger" className="flex-[2] text-lg" ms={900} busy={busy} disabled={expired || !ready || !reasonText(reason, other)}
                onHold={() => decide({ action: 'void', reason: reasonText(reason, other) })}>Void · refund all</HoldButton>
            </div>
          </Section>
        )}
      </div>
    </div>
    {checking && (
      <CameraCheckSheet handNo={r.hand_no} image={ev?.image_data_url} camera={camera} status={status}
        onClose={() => setChecking(false)} onConfirm={() => { setChecking(false); if (decisionAllowed(view, r.id)) setMode('settle'); }} />
    )}
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
  // The tab only ever changes when the manager taps it: a new review never moves them away from a
  // half-entered flop or a VOID being held. It shows as a badge, a banner and (below) a notice.
  const [tab, setTab] = useState<Tab>('hand');
  const [pick, setPick] = useState<string | null>(null);
  const s = live.state;
  const reviews = (s?.rounds ?? []).filter((r) => r.state === 'REVIEW');
  const reviewKey = reviews.map((r) => r.id).join(',');
  // Reviews the manager has had on screen (the Review tab open while the round was listed).
  const [viewed, setViewed] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (tab !== 'review' || reviews.every((r) => viewed.has(r.id))) return;
    setViewed(new Set([...viewed, ...reviews.map((r) => r.id)]));
  }, [tab, reviewKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const alert = reviewAlert(reviews, viewed, (r) => !!myEntry(r, mem));
  // The panel stays on the round the manager is looking at; a newer review does not replace it.
  // With nothing picked yet it shows the oldest one (the nearest deadline).
  const current = reviews.find((r) => r.id === pick) ?? alert.oldest;
  useEffect(() => { if (current && current.id !== pick) setPick(current.id); }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rounds that left REVIEW because the deadline passed: say so instead of letting them vanish.
  const tracked = useRef<TrackedReview[]>([]);
  const [autoVoids, setAutoVoids] = useState<TrackedReview[]>([]);
  const roundsKey = (s?.rounds ?? []).map((r) => `${r.id}:${r.state}:${r.review_deadline ?? ''}:${r.review_started_at ?? ''}`).join(',');
  const tick = useNow(1000);
  useEffect(() => {
    if (!s) return;
    const { tracked: next, voided } = trackReviews(tracked.current, s.rounds, Date.now() + api.clockOffsetMs);
    tracked.current = next;
    if (voided.length) setAutoVoids((v) => [...v, ...voided.filter((x) => !v.some((y) => y.id === x.id))]);
  }, [roundsKey, Math.floor(tick / 5000)]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: { k: Tab; label: string; icon: ReactNode; count?: number; fresh?: boolean }[] = [
    { k: 'hand', label: 'Floor entry', icon: <Scale className="h-5 w-5" /> },
    { k: 'review', label: 'Review', icon: <Gavel className="h-5 w-5" />, count: alert.count, fresh: alert.unseen > 0 },
    { k: 'table', label: 'Void · Pause', icon: <Ban className="h-5 w-5" /> },
  ];

  const banner = tab !== 'review' && alert.oldest ? (
    <button type="button" onClick={() => setTab('review')} data-testid="review-banner"
      className="flex min-h-14 w-full items-center gap-3 rounded-[16px] border border-warn/60 bg-warn/10 px-5 text-left text-base font-semibold text-warn">
      <AlertOctagon className="h-6 w-6 shrink-0" />
      <span className="flex-1">
        {alert.count === 1 ? <>Hand {alert.oldest.hand_no} needs a review decision</> : <>{alert.count} hands need a review decision</>}
        {alert.decidable === 0 && <span className="font-normal"> · you entered {alert.count === 1 ? 'this flop' : 'these flops'}: another floor manager must decide</span>}
        <BannerDeadline r={alert.oldest} offsetMs={api.clockOffsetMs} />
      </span>
      <span className="shrink-0 text-sm underline underline-offset-4">Open Review when you are done here</span>
    </button>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="flex gap-2 px-5 pt-4">
        {tabs.map((t) => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)} data-testid={`tab-${t.k}`} aria-current={tab === t.k ? 'page' : undefined}
            className={cx('inline-flex min-h-14 items-center gap-2 rounded-[14px] border px-5 text-base font-semibold',
              tab === t.k ? 'border-accent bg-accent-soft text-ink' : t.fresh ? 'border-warn/70 text-warn' : 'border-line text-muted active:text-ink')}>
            {t.icon}{t.label}
            {!!t.count && <span data-testid={`badge-${t.k}`} className={cx('grid h-7 min-w-7 place-items-center rounded-full bg-warn px-2 text-sm font-bold text-black', t.fresh && 'pf-pulse')}>{t.count}{t.fresh ? ' new' : ''}</span>}
          </button>
        ))}
      </nav>
      {autoVoids.length > 0 && (
        <div className="flex flex-col gap-2 px-5 pt-3">
          {autoVoids.map((v) => (
            <div key={v.id} role="status" data-testid="auto-voided" className="flex items-center gap-3 rounded-[14px] border border-line-strong bg-surface-2 px-5 py-3 text-base">
              <Hourglass className="h-5 w-5 shrink-0 text-danger" />
              <span className="flex-1">Hand {v.hand_no} was <b>auto-voided</b>: its review deadline passed without a decision. All bets were refunded.</span>
              <button type="button" onClick={() => setAutoVoids((x) => x.filter((y) => y.id !== v.id))} aria-label="Dismiss" className="grid h-12 w-12 place-items-center rounded-full text-muted active:text-ink"><X className="h-5 w-5" /></button>
            </div>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {tab === 'hand' && <FloorScreen live={live} mem={mem} runner={runner} submitFlop={submitFlop} banner={banner ?? undefined} />}
        {tab === 'review' && (
          <div className="flex h-full min-h-0 flex-col gap-4 p-5">
            <ActionStatus runner={runner} />
            {reviews.length > 1 && (
              <div className="flex gap-2">{[...reviews].sort((a, b) => a.hand_no - b.hand_no).map((r) => <BigButton key={r.id} tone={r.id === current?.id ? 'warn' : 'neutral'} onClick={() => setPick(r.id)}>Hand {r.hand_no}</BigButton>)}</div>
            )}
            {current ? <div className="min-h-0 flex-1"><ReviewPanel key={current.id} api={api} r={current} mem={mem} runner={runner} /></div> : (
              <div className="grid flex-1 place-items-center rounded-[22px] border border-dashed border-line-strong text-center">
                <div><div className="font-serif text-4xl">No hands in review</div><p className="mt-2 text-lg text-muted">When the dealer, floor and camera disagree, the hand appears here.</p>
                  {s?.rounds[0] && <div className="mt-4"><StateBadge r={s.rounds[0]} /></div>}</div>
              </div>
            )}
          </div>
        )}
        {tab === 'table' && s && <div className="flex h-full min-h-0 flex-col gap-4 p-5">{banner}<ActionStatus runner={runner} /><div className="min-h-0 flex-1"><TableControls api={api} live={live} runner={runner} /></div></div>}
      </div>
    </div>
  );
}

/** Time left on the oldest review, inside the banner (only when the deadline is known). */
function BannerDeadline({ r, offsetMs }: { r: Round; offsetMs: number }) {
  const c = reviewCountdown(reviewDeadlineMs(r), useNow(1000) + offsetMs);
  if (!c) return null;
  return <span className={cx('font-normal', c.level !== 'ok' && 'font-bold text-danger')}> · {c.level === 'expired' ? 'deadline passed' : `${c.label} left`}</span>;
}
