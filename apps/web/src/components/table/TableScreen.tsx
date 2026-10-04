import { ApiError } from '@preflop/client';
import { Badge, Button, type RoundPhase, cx, formatMoneyShort, formatOdds } from '@preflop/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Info, LayoutGrid, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../../lib/api.ts';
import { type BetIntent, type IntentInputs, newIntent, priceOfferFor, withAcceptedPrice } from '../../lib/betIntent.ts';
import { type BetOption, MAIN_GRID, MAX_FAVORITES, removeFavorite, resolveOption } from '../../lib/bets.ts';
import { resultLine, roundLabel } from '../../lib/flop.ts';
import { openHandNo, phaseOf, streamGate, tableStatus } from '../../lib/live.ts';
import { marketAllowed } from '../../lib/embed.ts';
import { type BetProblem, betProblem } from '../../lib/problems.ts';
import { qk, useBalance, useBook, useFavorites, useResetPlay, useRoom } from '../../lib/queries.ts';
import { betQuote, quoteLines } from '../../lib/quote.ts';
import { amountLabel, amountRange, balanceLabel, isLargeStake, isPool, noCashValueLine, roomOption, stakePresets } from '../../lib/rooms.ts';
import { KEYS, readJson, writeJson, writeString } from '../../lib/storage.ts';
import { useBetIntent } from '../../lib/useBetIntent.ts';
import { useTableLive } from '../../lib/useTableLive.ts';
import { HowToPlay, PracticePill } from '../AppShell.tsx';
import { MiniFlop } from '../MiniFlop.tsx';
import { StreamView, feltLabel, feltTheme } from '../StreamView.tsx';
import { ErrorState, Notice, Sheet, Skeleton } from '../ui.tsx';
import { CatalogueSheet } from './Catalogue.tsx';
import { LiveBanner } from './LiveBanner.tsx';
import { RoundCompleteSheet } from './RoundCompleteSheet.tsx';
import { StakeConfirmSheet } from './StakeConfirmSheet.tsx';
import { EmptyFavoriteSlot, FavoriteTile } from './Tiles.tsx';

const PRESET_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' };

/** Choose → Lock → Reveal, numbered, as on the practice table. */
function Steps({ phase }: { phase: RoundPhase }) {
  const steps: { key: RoundPhase; label: string }[] = [{ key: 'open', label: 'Choose' }, { key: 'locked', label: 'Lock' }, { key: 'reveal', label: 'Reveal' }];
  const at = steps.findIndex((s) => s.key === phase);
  return (
    <ol className="flex items-center justify-center gap-6 sm:gap-10" aria-label="Round progress">
      {steps.map((s, i) => (
        <li key={s.key} aria-current={i === at ? 'step' : undefined} className={cx('flex items-center gap-2.5 text-[13px]', i === at ? 'text-accent' : 'text-ink/80')}>
          <span className={cx('grid h-[22px] w-[22px] place-items-center rounded-full border text-[11px]',
            i === at ? 'border-accent bg-accent font-bold text-accent-ink' : i < at ? 'border-accent/60 text-accent' : 'border-line-strong')}>{i + 1}</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

const PROMPT: Record<RoundPhase, { eyebrow: string; title: string }> = {
  open: { eyebrow: 'A fresh flop awaits', title: 'What will the next three cards bring?' },
  locked: { eyebrow: 'Predictions locked', title: 'The shuffle is on. The flop is coming.' },
  reveal: { eyebrow: 'The flop is out', title: 'Three cards on the felt.' },
};

/**
 * The table screen: felt with the previous flop, the round steps, six favorite bets with the
 * full catalogue one tap away, amount and confirm, then Round complete when the round settles.
 * With ?room=<id> the same screen plays in an organizer's room: the room's odds, the room's
 * closed-loop wallet (chips or diamonds) and room_id on every bet.
 * Used by /app/table/:id (and …/bets, which opens the catalogue) and by /embed/table/:id, where
 * the partner's `embedOptions` limit the markets shown and set the stake pills.
 */
export function TableScreen({ tableId, embed = false, catalogue = false, embedOptions, guest = false }: {
  tableId: string; embed?: boolean; catalogue?: boolean; embedOptions?: { markets: string[] | null; stakes: number[] | null } | undefined;
  /** Signed-out demo (/demo): the live table is read-only and the bet panel becomes a "Play free" call to action. */
  guest?: boolean;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const roomId = params.get('room');
  const live = useTableLive(tableId);
  const book = useBook();
  const favs = useFavorites();
  const play = useBalance();
  const rm = useRoom(roomId);
  const reset = useResetPlay();
  const t = live.detail.data;
  const room = rm.room;
  const pool = isPool(room);
  const roomQs = roomId ? `?room=${encodeURIComponent(roomId)}` : '';

  const [selectedId, setSelectedId] = useState<string>(() => params.get('sel') ?? 'hand-class:pair');
  const [stake, setStake] = useState<number>(() => embedOptions?.stakes?.[0] ?? readJson<number>(KEYS.stake) ?? 100);
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<BetProblem | null>(null);
  const [placedMsg, setPlacedMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [help, setHelp] = useState(false);
  const [catalogueOpen, setCatalogueOpen] = useState(catalogue);
  /** A large stake waiting for the confirm sheet: frozen when the sheet opens, sent as shown. */
  const [draft, setDraft] = useState<BetIntent | null>(null);
  /** A price change offered for one exact intent (lib/betIntent.ts): consent never carries over to other inputs. */
  const [offer, setOffer] = useState<{ intent: BetIntent; oddsCenti: number } | null>(null);

  useEffect(() => { if (!embed && !guest) writeString(KEYS.lastTable, tableId); }, [tableId, embed, guest]);
  useEffect(() => writeJson(KEYS.stake, stake), [stake]);
  useEffect(() => setCatalogueOpen(catalogue), [catalogue]);
  // A bet chosen elsewhere arrives as ?sel=…
  useEffect(() => {
    const sel = params.get('sel');
    if (sel) {
      setSelectedId(sel);
      params.delete('sel');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const closeCatalogue = () => {
    setCatalogueOpen(false);
    if (catalogue && !embed) nav(`/app/table/${tableId}${roomQs}`, { replace: true });
  };

  // A partner widget can limit the markets shown (?markets=…); everything else is unchanged.
  const marketFilter = embedOptions?.markets ?? null;
  const optionFor = useCallback((id: string): BetOption | undefined => {
    const o = resolveOption(book.index, id);
    return o && !marketAllowed(marketFilter, o.marketId) ? undefined : roomOption(o, room);
  }, [book.index, room, marketFilter]);
  const option = optionFor(selectedId);
  const nameOf = useCallback((id: string) => {
    const tile = MAIN_GRID.find((g) => g.id === id || resolveOption(book.index, g.id)?.id === id);
    return resolveOption(book.index, id)?.name ?? tile?.title ?? id;
  }, [book.index]);
  const allOptions = useMemo(() => [...book.index.values()].filter((o) => marketAllowed(marketFilter, o.marketId)).map((o) => roomOption(o, room)!), [book.index, room, marketFilter]);
  const favIds = useMemo(() => (marketFilter && book.index.size ? favs.ids.filter((id) => optionFor(id)) : favs.ids), [favs.ids, optionFor, marketFilter, book.index.size]);
  // The default pick may be outside the partner's markets: start on the first one shown instead.
  useEffect(() => {
    if (!marketFilter || !book.index.size || optionFor(selectedId)) return;
    const first = favIds[0] ?? allOptions[0]?.id;
    if (first) setSelectedId(first);
  }, [marketFilter, book.index.size, optionFor, selectedId, favIds, allOptions]);

  // Money context: the room's closed-loop wallet, or free chips.
  const currency = room?.currency ?? t?.currency ?? 'PLAY';
  const balance = room ? (rm.walletsLoaded ? rm.wallet?.balance_minor ?? 0 : null) : play.balance;
  const [p1, p2, p3] = stakePresets(room?.rules.min_stake_minor);
  const minStake = room?.rules.min_stake_minor ?? 1;
  const partnerPresets = embedOptions?.stakes?.filter((x) => x >= minStake);
  const presets = partnerPresets?.length ? partnerPresets : [p1, p2, p3, p3 * 2];
  const step = Math.max(10, minStake);
  const roomMismatch = !!room && room.table_id !== tableId;

  const status = t ? tableStatus(t) : null;
  const phase = t ? phaseOf(t, !!live.reveal) : 'open';
  const openId = t?.open_round_id ?? null;
  const hand = t ? openHandNo(t) : null;
  const prev = t?.last_flop ?? null;
  const history = (t?.history ?? []).filter((h) => h.flop && h.flop.length === 3).slice(0, 5);

  const thisRound = useMemo(() => live.placed.filter((b) => b.roundId === openId), [live.placed, openId]);
  const inFlight = useMemo(() => live.placed.filter((b) => b.roundId !== openId && b.status === 'accepted'), [live.placed, openId]);

  const bet = useBetIntent({
    onPlaced: (b, intent) => {
      if (intent.tableId === tableId) live.addPlaced({ betId: b.bet_id, roundId: b.round_id, selectionId: b.selection_id, stakeMinor: b.stake_minor, oddsCenti: b.odds_centi, status: b.status, currency: b.currency });
      setProblem(null);
      const price = intent.roomId && pool ? 'in the pool' : `at ${formatOdds(b.odds_centi)}`;
      setPlacedMsg(`${nameOf(b.selection_id)} ${price} for ${amountLabel(b.stake_minor, b.currency)}. Good luck.`);
      void qc.invalidateQueries({ queryKey: ['me', 'wallets'] });
      void qc.invalidateQueries({ queryKey: qk.bets });
    },
    onRefused: (err, intent) => {
      const p = betProblem(err);
      // The new price is offered for this intent only; accepting it needs a fresh tap.
      setOffer(p.kind === 'price_changed' && p.oddsCenti > 0 ? { intent, oddsCenti: p.oddsCenti } : null);
      setProblem(room && p.kind === 'insufficient_funds' ? { kind: 'other', message: `Not enough ${balanceLabel(currency).toLowerCase()} in ${room.org_name}.` } : p);
      if (p.kind === 'unauthorized' && !embed) nav(`/login?next=/app/table/${tableId}`);
    },
    onUnknown: () => setProblem({ kind: 'other', message: 'We could not confirm your prediction yet. We are checking with PreFlop; you can place another one once we know.' }),
    onNotPlaced: () => setProblem({ kind: 'other', message: 'Your last prediction was not placed. Nothing was taken from your balance.' }),
  });

  // What the slip would send now; a confirm freezes it into an intent with one Idempotency-Key.
  const inputs: IntentInputs | null = openId && option?.offered
    ? { tableId, roundId: openId, selectionId: option.id, stakeMinor: stake, oddsCenti: option.oddsCenti, roomId: room?.id ?? null, currency }
    : null;
  // The price notice belongs to the bet it was raised for: another selection, stake, wallet or a new
  // round drops it for good, so a later price change always needs fresh consent.
  const offerStale = !!offer && !priceOfferFor(offer, inputs);
  useEffect(() => {
    if (!offerStale) return;
    setOffer(null);
    setProblem((p) => (p?.kind === 'price_changed' ? null : p));
  }, [offerStale]);

  if (live.detail.isError) {
    return (
      <div className={embed ? 'px-5' : ''}>
        <ErrorState title="This table is not available" onRetry={() => void live.detail.refetch()}>
          {live.detail.error instanceof ApiError && live.detail.error.status === 404 ? 'We could not find this table.' : 'We could not load the table right now.'}
        </ErrorState>
        {!embed && <Link to="/app" className="mt-4 block text-center text-sm text-accent">Back to the lobby</Link>}
      </div>
    );
  }

  const tooMuch = balance !== null && stake > balance;
  // No bets while the live stream is down: the round may already be locked without us seeing it.
  const gate = streamGate(live.ws, live.resyncing);
  // The balance must be known: the large-stake confirmation (and the "more than you have" check)
  // depend on it, so nothing is sent while it is still loading.
  const canConfirm = balance !== null && !gate.paused && !!openId && !!option?.offered && stake >= minStake && !tooMuch && !bet.busy && status?.open !== false && !roomMismatch && !(roomId && !room);
  const send = (i: BetIntent) => {
    setProblem(null); setPlacedMsg(null); setOffer(null); setDraft(null);
    void bet.submit(i);
  };
  const confirm = () => {
    if (!inputs || !canConfirm) return;
    const i = newIntent(inputs);
    if (isLargeStake(stake, balance)) setDraft(i);
    else send(i);
  };
  const liveOffer = priceOfferFor(offer, inputs);
  const shownProblem = problem?.kind === 'price_changed' && !liveOffer ? null : problem;
  const liveDraft = draft && inputs && priceOfferFor({ intent: draft, oddsCenti: draft.oddsCenti }, inputs) ? draft : null;
  const favCount = favIds.length;
  const unavailable = !!t && (t.status !== 'active' || status?.label === 'Stream unavailable');
  const prompt = PROMPT[phase];
  // The engine's own fee arithmetic: equals the API's potential_payout_minor for this stake.
  const quote = option?.offered ? betQuote(stake, option.oddsCenti, room) : null;
  const returns = quote?.totalReturnMinor ?? null;
  const draftQuote = liveDraft ? betQuote(liveDraft.stakeMinor, liveDraft.oddsCenti, room) : null;
  const fmt = (m: number) => amountLabel(m, currency);

  return (
    <div className={cx('@container', embed && 'px-4 pb-8 pt-4')}>
      {!guest && <LiveBanner ws={live.ws} resyncing={live.resyncing} className="mb-4" />}
      {/* heading */}
      {!embed && !guest && t && (
        <Link to={`/app/clubs/${t.club_id}`} className="inline-flex items-center gap-1.5 text-[14px] text-ink/85 hover:text-ink">
          <ChevronLeft className="h-4 w-4" aria-hidden /> {t.club_name}
        </Link>
      )}
      <div className={cx('flex items-start gap-4', !embed && 'mt-5')}>
        <div className="min-w-0 flex-1">
          {t ? (
            <h1 className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-serif text-[30px] leading-tight tracking-[-0.045em] @min-[640px]:text-[36px]">{room ? room.name : t.name}</span>
              <span className="text-[13px] text-ink/80">
                {room ? `${room.org_name} · ${pool ? 'Player pool' : 'Organizer house'} · ${t.name}` : feltLabel(t.name) ? `${t.club_name} · ${t.city ?? 'Online'}` : (t.kind === 'simulated' ? 'Practice table' : t.kind === 'manual' ? 'Test table' : 'Live table')}
              </span>
            </h1>
          ) : <Skeleton className="h-10 w-64" />}
        </div>
        <div className="flex items-center gap-2 pt-2">
          {!room && !embed && currency === 'PLAY' && <PracticePill className="hidden sm:inline-flex" />}
          {room && <Badge tone={room.currency === 'DIAMOND' ? 'info' : 'accent'}>{room.currency === 'DIAMOND' ? 'Diamonds' : 'Chips'}</Badge>}
          <button type="button" onClick={() => setHelp(true)} aria-label="How to play" className="grid h-9 w-9 place-items-center rounded-full text-ink/85 hover:bg-surface-3">
            <Info className="h-5 w-5" strokeWidth={1.6} />
          </button>
        </div>
      </div>

      {(roomId && rm.isError) || roomMismatch || (room && rm.walletsLoaded && !rm.wallet) ? (
        <div className="mt-4 space-y-2">
          {roomId && rm.isError && <Notice tone="warn">This room is not available. <Link to={`/app/table/${tableId}`} className="text-accent underline">Play with free chips instead</Link>.</Notice>}
          {roomMismatch && <Notice tone="warn">This room plays at {room!.table_name}. <Link to={`/app/table/${room!.table_id}?room=${room!.id}`} className="text-accent underline">Go to its table</Link>.</Notice>}
          {room && rm.walletsLoaded && !rm.wallet && (
            <Notice tone="info">You have no {balanceLabel(currency).toLowerCase()} from {room.org_name} yet. Organizers transfer them to their players; ask yours to send some.</Notice>
          )}
        </div>
      ) : null}

      <div className="mt-7 grid grid-cols-[minmax(0,1fr)] items-start gap-7 @min-[880px]:grid-cols-[minmax(0,1fr)_420px] @min-[1080px]:grid-cols-[minmax(0,1fr)_460px]">
        {/* left: the table */}
        <div className="@min-[880px]:col-start-1 @min-[880px]:row-start-1">
          <section aria-label="The table" className="overflow-hidden rounded-[12px] border border-line-strong/60 bg-surface">
            <StreamView cards={prev?.cards} size="lg" revealKey={live.reveal} unavailable={unavailable} theme={feltTheme(t?.club_id)} label={feltLabel(t?.name)} badgeText={t?.kind === 'manual' ? 'TEST TABLE' : 'SIMULATED TABLE'}
              onExpand={() => setExpanded(true)} className="h-[250px] @min-[640px]:h-[340px]" />
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 text-[12px] text-ink/85">
              <span>Previous flop · {prev ? roundLabel(prev.hand_no) : '—'}{prev && <span className="text-muted"> · {resultLine(prev.cards).replace('.', '')}</span>}</span>
              <span className="text-right">{t?.kind === 'simulated' ? 'Simulated · Not a live stream' : t?.kind === 'manual' ? 'Test table · Flop entered by the PreFlop team' : 'Live table'}</span>
            </div>
            <div className="border-b border-line px-4 py-5"><Steps phase={phase} /></div>
            <div className="px-6 py-8 @min-[640px]:px-8">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">{prompt.eyebrow}</p>
              <h2 className="mt-3 max-w-[460px] font-serif text-[28px] leading-[1.2] tracking-[-0.04em]">{prompt.title}</h2>
              <p className="mt-4 max-w-[500px] text-[14px] leading-relaxed text-ink/80" aria-live="polite">
                {!t ? 'Loading…' : openId && hand ? (
                  <>{roundLabel(hand)} is <span className="text-accent">open for predictions</span>. Pick one of your six favorites or explore the full catalogue. The cards above are the previous flop, not the round you are predicting.</>
                ) : unavailable ? 'This table is offline right now. Check back later or choose another table.'
                  : status && !status.open && status.label !== 'Round in progress' ? `${status.label}. The next round opens shortly.` : 'Predictions are closed for this round. The next round opens after this flop.'}
              </p>
              {(thisRound.length > 0 || inFlight.length > 0) && (
                <div className="mt-5">
                  <div className="text-[13px] font-semibold">Your predictions in play</div>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {[...inFlight, ...thisRound].map((b) => (
                      <li key={b.betId} className={cx('rounded-[6px] border px-3 py-1.5 text-[13px]', b.roundId === openId ? 'border-accent/60 bg-accent-deep/30' : 'border-info/50')}>
                        {nameOf(b.selectionId)} · {amountLabel(b.stakeMinor, b.currency)}
                        {b.roundId !== openId && <span className="ml-1 text-muted">· awaiting flop</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* right: favorites, amount, confirm (second on phones, beside the table on wide screens) */}
        {guest ? <GuestPanel tableId={tableId} /> : (
        <section aria-labelledby="favs" className="rounded-[12px] border border-line-strong/60 bg-surface p-5 @min-[640px]:p-6 @min-[880px]:col-start-2 @min-[880px]:row-span-2 @min-[880px]:row-start-1">
          <div className="flex items-center gap-2.5">
            <h2 id="favs" className="text-[20px] font-bold">Favorite bets</h2>
            <span className="rounded-[4px] border border-line-strong px-1.5 py-0.5 text-[11px] font-semibold">{favCount}</span>
            <div className="flex-1" />
            <button type="button" onClick={() => setEditing((e) => !e)} className="text-[13px] text-accent hover:underline">{editing ? 'Done' : 'Edit'}</button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {favIds.map((id) => (
              <FavoriteTile key={id} id={id} option={optionFor(id)} selected={selectedId === id || optionFor(id)?.id === selectedId} editing={editing} pool={pool}
                onSelect={() => setSelectedId(id)} onRemove={() => favs.save(removeFavorite(favs.ids, id))} />
            ))}
            {Array.from({ length: Math.max(0, MAX_FAVORITES - favCount) }, (_, i) => <EmptyFavoriteSlot key={i} onClick={() => setCatalogueOpen(true)} />)}
          </div>
          {favs.source === 'device' && <p className="mt-2 text-xs text-faint">Favorites are saved on this device.</p>}
          <button type="button" onClick={() => setCatalogueOpen(true)}
            className="mt-3 flex h-12 w-full items-center gap-3 rounded-[8px] border border-line-strong px-5 text-[15px] hover:border-accent/60">
            <LayoutGrid className="h-[18px] w-[18px]" strokeWidth={1.6} aria-hidden />
            <span className="flex-1 text-left">Browse all {allOptions.length || ''} bets</span>
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>

          <div className="mt-6 border-t border-line pt-6">
            <div className="flex items-center justify-between text-[12px] text-ink/85">
              <span>Your prediction</span>
              <button type="button" onClick={() => setHelp(true)} className="inline-flex items-center gap-1.5 text-accent hover:underline">Rules <Info className="h-4 w-4" aria-hidden /></button>
            </div>
            <div className="mt-2.5 flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[17px] font-bold">{option ? nameOf(selectedId) : 'Choose a bet'}</span>
              <span className="shrink-0 text-[17px] font-bold text-accent">
                {!option ? '' : !option.offered ? <span className="text-sm font-normal text-faint">Not offered{room ? ' in this room' : ''}</span> : pool ? 'Pool' : formatOdds(option.oddsCenti)}
              </span>
            </div>

            <div className="mt-5 flex items-center justify-between text-[12px]">
              <span className="text-[14px]">Amount</span>
              <span className="text-ink/85">{balance === null ? balanceLabel(currency) : amountRange(minStake, Math.max(minStake, balance), currency)}</span>
            </div>
            <div className="mt-2 flex h-12 overflow-hidden rounded-[8px] border border-line-strong/70 bg-bg">
              <button type="button" aria-label="Decrease amount" onClick={() => setStake((s) => Math.max(minStake, s - step))} className="grid w-12 place-items-center bg-surface-3 hover:text-accent"><Minus className="h-4 w-4" /></button>
              <label className="sr-only" htmlFor="stake">Amount</label>
              <input id="stake" type="number" inputMode="numeric" min={minStake} step={1} value={stake || ''}
                onChange={(e) => setStake(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="min-w-0 flex-1 bg-transparent text-center text-[16px] text-ink focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
              <button type="button" aria-label="Increase amount" onClick={() => setStake((s) => s + step)} className="grid w-12 place-items-center bg-surface-3 hover:text-accent"><Plus className="h-4 w-4" /></button>
            </div>
            <div className={cx('mt-2.5 grid gap-2', PRESET_COLS[presets.length] ?? 'grid-cols-4')}>
              {presets.map((p) => (
                <button key={p} type="button" aria-pressed={stake === p} onClick={() => setStake(p)}
                  className={cx('h-10 rounded-[6px] border text-[13px] transition-colors', stake === p ? 'border-accent/60 bg-accent-deep text-accent' : 'border-line-strong/70 text-ink/90 hover:border-accent/50')}>
                  {formatMoneyShort(p, currency)}
                </button>
              ))}
            </div>
            {tooMuch && <p className="mt-2 text-xs text-warn">More than your {amountLabel(balance!, currency)}.</p>}
            {balance === null && (play.isError && !play.isFetching ? (
              // the room and free-chip balances come from the same wallets query
              <p className="mt-2 text-xs text-warn" role="alert">
                Your balance could not be loaded, so predictions are paused.{' '}
                <button type="button" className="font-semibold text-accent underline" onClick={() => void play.refetch()}>Retry</button>
              </p>
            ) : <p className="mt-2 text-xs text-muted" aria-live="polite">Loading your balance…</p>)}
            {stake > 0 && stake < minStake && <p className="mt-2 text-xs text-warn">The minimum here is {amountLabel(minStake, currency)}.</p>}

            <div className="mt-5 flex items-baseline justify-between text-[13px]">
              <span className="text-ink/85">{pool ? 'Pool payout' : 'Total return if correct'}</span>
              <span className="font-bold">{pool ? 'Share of the pool' : returns !== null ? amountLabel(returns, currency).replace('free chips', 'chips') : '—'}</span>
            </div>
            {quoteLines(quote, fmt).length > 0 && (
              <dl className="mt-2 space-y-1 text-[12px] text-ink/80" aria-label="Fees">
                {quoteLines(quote, fmt).map((l) => <div key={l.label} className="flex justify-between gap-3"><dt>{l.label}</dt><dd>{l.value}</dd></div>)}
              </dl>
            )}
            <p className="mt-1 text-[12px] text-ink/75">
              {pool ? `Winners share the pool after the room’s ${((room?.rules.rake_bps ?? 0) / 100).toFixed(0)}% rake.` : room ? 'Room odds, after the organizer’s fees.' : 'Decimal odds include your original chips.'}
            </p>

            {shownProblem && (
              <div className="mt-4">
                <ProblemNotice problem={shownProblem} offerOdds={liveOffer?.oddsCenti ?? null} pending={bet.busy || gate.paused} canReset={!room}
                  onAccept={() => { if (liveOffer && canConfirm) send(withAcceptedPrice(liveOffer.intent, liveOffer.oddsCenti)); }}
                  onReset={() => setConfirmReset(true)} onDismiss={() => { setProblem(null); setOffer(null); }} />
              </div>
            )}
            {placedMsg && !shownProblem && <Notice tone="accent" className="mt-4">{placedMsg}</Notice>}

            <Button size="lg" className="mt-5 h-[50px] w-full text-[15px]" disabled={!canConfirm} onClick={confirm}>
              {bet.status === 'sending' ? 'Placing…' : bet.status === 'checking' ? 'Checking your last prediction…' : gate.paused ? (live.ws === 'open' ? 'Bets paused · updating' : 'Bets paused · reconnecting') : !openId && t ? 'Waiting for the next round' : `Confirm · ${amountLabel(stake, currency).replace('free chips', 'chips')}`}
            </Button>
            <p className="mt-4 text-center text-[12px] text-ink/80">{currency === 'PLAY' ? 'Free chips. No purchases, prizes or cash-out.' : noCashValueLine(currency)}</p>
          </div>
        </section>
        )}

        <section aria-label="Recent flops" className="rounded-[12px] border border-line-strong/60 bg-surface px-6 py-6 @min-[640px]:px-8 @min-[880px]:col-start-1 @min-[880px]:row-start-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-bold">Recent flops at this table</h2>
            {!embed && !guest && <Link to="/app/activity" className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">Activity <ChevronRight className="h-4 w-4" aria-hidden /></Link>}
          </div>
          {history.length === 0 ? (
            <p className="mt-4 text-[13px] text-ink/75">Completed rounds will appear here.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {history.map((h) => (
                <li key={h.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                  <MiniFlop cards={h.flop} />
                  <span className="flex-1 text-ink/85">{h.voided_at ? 'Voided · refunded' : resultLine(h.flop!)}</span>
                  <span className="text-muted">{roundLabel(h.hand_no)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <CatalogueSheet open={catalogueOpen} onClose={closeCatalogue} options={allOptions} loading={book.isLoading} error={book.isError} onRetry={() => void book.refetch()}
        favorites={favIds} onSaveFavorites={(ids) => favs.save(ids)} pool={pool} inRoom={!!room}
        onPick={(o) => { setSelectedId(o.id); closeCatalogue(); }} />

      <RoundCompleteSheet summary={live.completed} nameOf={nameOf} voidReason={live.completed ? live.voidReasons[live.completed.roundId] : undefined}
        onNext={live.dismiss} onActivity={() => { live.dismiss(); if (!embed) nav('/app/activity'); }} />

      <Sheet open={expanded} onClose={() => setExpanded(false)} title="Table view" wide>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted">{t?.name} · Previous flop · {prev ? roundLabel(prev.hand_no) : '—'}</span>
          <button type="button" onClick={() => setExpanded(false)} aria-label="Close table view" className="grid h-9 w-9 place-items-center rounded-[8px] border border-line"><X className="h-4 w-4" /></button>
        </div>
        <StreamView cards={prev?.cards} size="lg" revealKey={live.reveal} theme={feltTheme(t?.club_id)} label={feltLabel(t?.name)} badgeText={t?.kind === 'manual' ? 'TEST TABLE' : 'SIMULATED TABLE'} className="mt-4 h-[320px] rounded-[12px]" />
        {prev && <p className="mt-4 text-center font-serif text-2xl">{resultLine(prev.cards)}</p>}
        <p className="mt-2 text-center text-xs text-faint">{t?.kind === 'manual' ? 'Test table: the PreFlop team enters each flop after betting closes.' : 'Simulated table: the flop is real game data, shown on a practice felt.'}</p>
      </Sheet>

      <Sheet open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset free chips">
        <h2 className="font-serif text-2xl">Reset free chips?</h2>
        <p className="mt-2 text-sm text-muted">Your free-chip balance goes back to the starting amount. Free chips have no cash value.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setConfirmReset(false)}>Cancel</Button>
          <Button disabled={reset.isPending} onClick={() => reset.mutate(undefined, { onSuccess: () => { setConfirmReset(false); setProblem(null); } })}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Reset
          </Button>
        </div>
      </Sheet>

      <StakeConfirmSheet open={!!liveDraft && canConfirm} onClose={() => setDraft(null)} onConfirm={() => { if (liveDraft) send(liveDraft); }} busy={bet.busy}
        selection={liveDraft ? nameOf(liveDraft.selectionId) : ''} stake={liveDraft ? fmt(liveDraft.stakeMinor) : ''}
        allIn={!!liveDraft && balance !== null && liveDraft.stakeMinor >= balance} share={liveDraft && balance ? liveDraft.stakeMinor / balance : 0}
        breakdown={quoteLines(draftQuote, fmt)}
        potential={pool ? 'A share of the pool' : draftQuote?.totalReturnMinor != null ? fmt(draftQuote.totalReturnMinor) : '—'} />

      <HowToPlay open={help} onClose={() => setHelp(false)} />
    </div>
  );
}

/** The demo's right-hand panel: what playing is, and the way in. */
export function GuestPanel({ tableId }: { tableId: string }) {
  const next = encodeURIComponent(`/app/table/${tableId}`);
  return (
    <section aria-labelledby="guest-h" className="rounded-[12px] border border-accent/40 bg-surface p-6 @min-[880px]:col-start-2 @min-[880px]:row-span-2 @min-[880px]:row-start-1">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Watching as a guest</p>
      <h2 id="guest-h" className="mt-3 font-serif text-[28px] leading-[1.2] tracking-[-0.04em]">Call the next flop yourself.</h2>
      <p className="mt-3 text-[14px] leading-relaxed text-ink/85">
        This practice table is dealing now. Create a free account to predict each flop with 10,000 free chips: pick a bet, lock it in, watch the reveal.
      </p>
      <ul className="mt-4 space-y-2 text-[13px] text-ink/85">
        <li>· Every bet priced exactly over all 22,100 possible flops</li>
        <li>· Free chips only: no purchases, no cash value</li>
        <li>· 18+ only</li>
      </ul>
      <Link to={`/register?next=${next}`} className="mt-6 flex h-[50px] w-full items-center justify-center rounded-[8px] bg-accent text-[15px] font-bold text-accent-ink hover:bg-accent-strong">Play free</Link>
      <p className="mt-3 text-center text-[13px] text-ink/80">Have an account? <Link to={`/login?next=${next}`} className="text-accent underline">Sign in</Link></p>
    </section>
  );
}

function ProblemNotice({ problem, offerOdds, pending, canReset, onAccept, onReset, onDismiss }: {
  problem: BetProblem;
  /** The new price offered for the bet that was refused (null once the slip no longer shows that bet). */
  offerOdds: number | null;
  pending: boolean; canReset: boolean; onAccept: () => void; onReset: () => void; onDismiss: () => void;
}) {
  return (
    <Notice tone={problem.kind === 'round_locked' ? 'info' : 'warn'}>
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p>{problem.message}</p>
          {problem.kind === 'price_changed' && offerOdds !== null && (
            <Button size="sm" className="mt-2" disabled={pending} onClick={onAccept}>
              Accept {formatOdds(offerOdds)} and confirm
            </Button>
          )}
          {problem.kind === 'insufficient_funds' && canReset && (
            <Button size="sm" variant="secondary" className="mt-2" onClick={onReset}><RotateCcw className="h-4 w-4" aria-hidden /> Reset free chips</Button>
          )}
        </div>
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className="text-muted hover:text-ink"><X className="h-4 w-4" /></button>
      </div>
    </Notice>
  );
}
