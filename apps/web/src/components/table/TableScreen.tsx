import { ApiError } from '@preflop/client';
import { Badge, Button, Card, ChipIcon, RoundStepper, cx, formatMoney, formatOdds } from '@preflop/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../../lib/api.ts';
import { type BetOption, MAIN_GRID, MAX_FAVORITES, removeFavorite, resolveOption } from '../../lib/bets.ts';
import { resultLine, roundLabel } from '../../lib/flop.ts';
import { openHandNo, phaseOf, tableStatus } from '../../lib/live.ts';
import { type BetProblem, betProblem } from '../../lib/problems.ts';
import { useBalance, useBook, useFavorites, useResetPlay, useRoom } from '../../lib/queries.ts';
import { amountLabel, balanceLabel, isPool, noCashValueLine, roomOption, stakePresets } from '../../lib/rooms.ts';
import { KEYS, readJson, writeJson, writeString } from '../../lib/storage.ts';
import { useTableLive } from '../../lib/useTableLive.ts';
import { StreamView } from '../StreamView.tsx';
import { ErrorState, Notice, Sheet, Skeleton } from '../ui.tsx';
import { RoundCompleteSheet } from './RoundCompleteSheet.tsx';
import { StakePicker } from './StakePicker.tsx';
import { EmptyFavoriteSlot, FavoriteTile, PredictionTile, SectionTitle } from './Tiles.tsx';

/**
 * The table screen (concept screens 4, 5 and 8): stream, round stepper, the main 2×2 grid,
 * favorite bets, stake and confirm, then the Round complete sheet when the round settles.
 * With ?room=<id> the same screen plays in an organizer's room: the room's odds, the room's
 * closed-loop wallet (chips or diamonds) and room_id on every bet.
 * Used by /app/table/:id and by the partner iframe at /embed/table/:id.
 */
export function TableScreen({ tableId, embed = false }: { tableId: string; embed?: boolean }) {
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

  const [selectedId, setSelectedId] = useState<string>(() => params.get('sel') ?? 'hand-class:pair');
  const [stake, setStake] = useState<number>(() => readJson<number>(KEYS.stake) ?? 100);
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<BetProblem | null>(null);
  const [placedMsg, setPlacedMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => { if (!embed) writeString(KEYS.lastTable, tableId); }, [tableId, embed]);
  useEffect(() => writeJson(KEYS.stake, stake), [stake]);
  // A bet chosen on "Browse bets" arrives as ?sel=…
  useEffect(() => {
    const sel = params.get('sel');
    if (sel) {
      setSelectedId(sel);
      params.delete('sel');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const optionFor = useCallback((id: string): BetOption | undefined => roomOption(resolveOption(book.index, id), room), [book.index, room]);
  const option = optionFor(selectedId);
  const nameOf = useCallback((id: string) => {
    const tile = MAIN_GRID.find((g) => g.id === id || resolveOption(book.index, g.id)?.id === id);
    return tile?.title ?? resolveOption(book.index, id)?.name ?? id;
  }, [book.index]);

  // Money context: the room's closed-loop wallet, or free chips.
  const currency = room?.currency ?? t?.currency ?? 'PLAY';
  const balance = room ? (rm.walletsLoaded ? rm.wallet?.balance_minor ?? 0 : null) : play.balance;
  const presets = stakePresets(room?.rules.min_stake_minor);
  const minStake = room?.rules.min_stake_minor ?? 1;
  const roomMismatch = !!room && room.table_id !== tableId;

  const status = t ? tableStatus(t) : null;
  const phase = t ? phaseOf(t, !!live.reveal) : 'open';
  const openId = t?.open_round_id ?? null;
  const hand = t ? openHandNo(t) : null;
  const prev = t?.last_flop ?? null;

  const thisRound = useMemo(() => live.placed.filter((b) => b.roundId === openId), [live.placed, openId]);
  const inFlight = useMemo(() => live.placed.filter((b) => b.roundId !== openId && b.status === 'accepted'), [live.placed, openId]);

  const place = useMutation({
    mutationFn: async (o: { acceptPrice?: number }) => {
      if (!openId) throw new ApiError(409, { type: 'round_locked', title: 'closed', status: 409 });
      if (!option?.offered) throw new ApiError(422, { type: 'not_offered', title: 'not offered', status: 422 });
      return api.placeBet({
        round_id: openId, selection_id: option.id, stake_minor: stake, odds_centi: o.acceptPrice ?? option.oddsCenti,
        ...(o.acceptPrice !== undefined ? { accept_price_change: true } : {}),
        ...(room ? { room_id: room.id } : {}),
      });
    },
    onMutate: () => { setProblem(null); setPlacedMsg(null); },
    onSuccess: (bet) => {
      live.addPlaced({ betId: bet.bet_id, roundId: bet.round_id, selectionId: bet.selection_id, stakeMinor: bet.stake_minor, oddsCenti: bet.odds_centi, status: bet.status });
      const price = pool ? 'in the pool' : `at ${formatOdds(bet.odds_centi)}`;
      setPlacedMsg(`${nameOf(bet.selection_id)} ${price} for ${amountLabel(bet.stake_minor, bet.currency)}. Good luck.`);
      void qc.invalidateQueries({ queryKey: ['me', 'wallets'] });
    },
    onError: (err) => {
      const p = betProblem(err);
      setProblem(room && p.kind === 'insufficient_funds' ? { kind: 'other', message: `Not enough ${balanceLabel(currency).toLowerCase()} in ${room.org_name}.` } : p);
      if (p.kind === 'unauthorized' && !embed) nav(`/login?next=/app/table/${tableId}`);
    },
  });

  if (live.detail.isError) {
    return (
      <div className="px-5">
        <ErrorState title="This table is not available" onRetry={() => void live.detail.refetch()}>
          {live.detail.error instanceof ApiError && live.detail.error.status === 404 ? 'We could not find this table.' : 'We could not load the table right now.'}
        </ErrorState>
        {!embed && <Link to="/app" className="mt-4 block text-center text-sm text-accent">Back to the lobby</Link>}
      </div>
    );
  }

  const tooMuch = balance !== null && stake > balance;
  const canConfirm = !!openId && !!option?.offered && stake >= minStake && !tooMuch && !place.isPending && status?.open !== false && !roomMismatch && !(roomId && !room);
  const favCount = favs.ids.length;
  const browseHref = `/app/table/${tableId}/bets${roomId ? `?room=${encodeURIComponent(roomId)}` : ''}`;

  return (
    <div className="space-y-5 px-5 pb-8">
      {/* table card */}
      <Card className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          {t ? (
            <>
              <h1 className="truncate text-[16px] font-semibold">{room ? `${room.name} · ${t.name}` : `${t.name} · ${t.club_name}`}</h1>
              <p className="truncate text-[13px] text-muted">
                {room ? `${room.org_name} · ${pool ? 'Player pool' : 'Organizer house'}` : `${t.kind === 'simulated' ? 'Simulated table' : 'Live table'}${t.city ? ` · ${t.city}` : ''}`}
              </p>
            </>
          ) : (
            <><Skeleton className="h-5 w-48" /><Skeleton className="mt-1.5 h-4 w-28" /></>
          )}
        </div>
        <div className="flex items-center gap-2 text-right">
          {currency === 'DIAMOND' ? <span aria-hidden className="text-xl text-info">◆</span> : <ChipIcon size={22} />}
          <div>
            <div className="text-[16px] font-semibold leading-tight">{balance === null ? '—' : formatMoney(balance, 'PLAY')}</div>
            <div className="text-[11px] text-muted">{balanceLabel(currency)}</div>
          </div>
        </div>
      </Card>

      {roomId && rm.isError && <Notice tone="warn">This room is not available. <Link to={`/app/table/${tableId}`} className="text-accent underline">Play with free chips instead</Link>.</Notice>}
      {roomMismatch && <Notice tone="warn">This room plays at {room!.table_name}. <Link to={`/app/table/${room!.table_id}?room=${room!.id}`} className="text-accent underline">Go to its table</Link>.</Notice>}
      {room && rm.walletsLoaded && !rm.wallet && (
        <Notice tone="info">You have no {balanceLabel(currency).toLowerCase()} from {room.org_name} yet. Organizers transfer them to their players; ask yours to send some.</Notice>
      )}

      {/* stream */}
      <div>
        <StreamView cards={prev?.cards} size="md" revealKey={live.reveal} unavailable={status?.label === 'Stream unavailable'}
          onExpand={() => setExpanded(true)} className="h-[200px] rounded-[18px]" />
        <div className="mt-2 flex items-center justify-between text-[13px] text-muted">
          <span>Previous flop · {prev ? roundLabel(prev.hand_no) : '—'}</span>
          {prev && <span>{resultLine(prev.cards).replace('.', '')}</span>}
        </div>
      </div>

      <RoundStepper phase={phase} />

      <section aria-labelledby="predict" className="space-y-4">
        <div>
          <h2 id="predict" className="font-serif text-[30px] leading-tight">Predict the next flop</h2>
          <p className="mt-1 text-sm text-muted" aria-live="polite">
            {!t ? 'Loading…' : openId && hand ? (
              <>{roundLabel(hand)} · <span className="text-accent">Predictions open</span></>
            ) : status && !status.open && status.label !== 'Round in progress' ? status.label : 'Betting closed — next round opens after this flop'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {MAIN_GRID.map((g) => (
            <PredictionTile key={g.id} tile={g} option={book.isLoading || rm.isLoading ? undefined : optionFor(g.id)} pool={pool}
              selected={selectedId === g.id} onSelect={() => setSelectedId(g.id)} />
          ))}
        </div>
        {pool && <p className="text-xs text-muted">Player pool: winners share the pool after the room’s {((room?.rules.rake_bps ?? 0) / 100).toFixed(0)}% rake. There are no fixed odds.</p>}
      </section>

      {/* favorites */}
      <section aria-labelledby="favs" className="space-y-3">
        <SectionTitle right={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">{favCount} / {MAX_FAVORITES}</span>
            <button type="button" onClick={() => setEditing((e) => !e)} className="text-sm font-semibold text-accent hover:underline">{editing ? 'Done' : 'Edit'}</button>
          </div>}>
          <span id="favs">Favorite bets</span>
        </SectionTitle>
        <div className="grid grid-cols-3 gap-2.5">
          {favs.ids.map((id) => (
            <FavoriteTile key={id} id={id} option={optionFor(id)} selected={selectedId === id} editing={editing} pool={pool}
              onSelect={() => setSelectedId(id)} onRemove={() => favs.save(removeFavorite(favs.ids, id))} />
          ))}
          {!embed && Array.from({ length: Math.max(0, MAX_FAVORITES - favCount) }, (_, i) => <EmptyFavoriteSlot key={i} to={browseHref} />)}
        </div>
        {favs.source === 'device' && <p className="text-xs text-faint">Favorites are saved on this device.</p>}
        {!embed && (
          <Link to={browseHref} className="flex h-12 items-center justify-center gap-2 rounded-[14px] border border-line-strong text-[15px] font-semibold hover:border-accent hover:text-accent">
            <Search className="h-4 w-4" aria-hidden /> Browse all bets ›
          </Link>
        )}
      </section>

      {/* your prediction */}
      {option && (
        <Card className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-wider text-muted">Your prediction</div>
            <div className="truncate font-semibold">{nameOf(selectedId)}</div>
          </div>
          <div className="text-right">
            {!option.offered ? <div className="text-sm text-faint">Not offered{room ? ' in this room' : ''}</div> : pool ? (
              <><div className="font-semibold text-accent">Pool</div><div className="text-xs text-muted">share of the pool</div></>
            ) : (
              <>
                <div className="font-semibold text-accent">{formatOdds(option.oddsCenti)}</div>
                <div className="text-xs text-muted">
                  {room ? 'after room fees' : `returns ${amountLabel(Math.floor((stake * option.oddsCenti) / 100), currency)}`}
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {(thisRound.length > 0 || inFlight.length > 0) && (
        <div className="space-y-2">
          <div className="text-sm font-semibold">Your predictions this round</div>
          <ul className="flex flex-wrap gap-2">
            {[...inFlight, ...thisRound].map((b) => (
              <li key={b.betId} className={cx('rounded-full border px-3 py-1 text-[13px]', b.roundId === openId ? 'border-accent/60' : 'border-info/50')}>
                {nameOf(b.selectionId)} · {formatMoney(b.stakeMinor, 'PLAY')}
                {b.roundId !== openId && <span className="ml-1 text-muted">· awaiting flop</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <StakePicker value={stake} onChange={setStake} balance={balance} presets={presets} currency={currency} minStake={minStake} />

      {problem && <ProblemNotice problem={problem} pending={place.isPending} canReset={!room}
        onAccept={(odds) => place.mutate({ acceptPrice: odds })}
        onReset={() => setConfirmReset(true)}
        onDismiss={() => setProblem(null)} />}
      {placedMsg && !problem && <Notice tone="accent">{placedMsg}</Notice>}

      <div>
        <Button size="lg" className="w-full" disabled={!canConfirm} onClick={() => place.mutate({})}>
          {place.isPending ? 'Placing…' : `Confirm · ${amountLabel(stake, currency)}`}
        </Button>
        <p className="mt-2 text-center text-xs text-muted">{noCashValueLine(currency)}</p>
        {room && <div className="mt-2 flex justify-center"><Badge tone="muted">{room.mode === 'diamonds' ? 'Diamonds room' : 'Chips room'} · min {amountLabel(minStake, currency)}</Badge></div>}
      </div>

      <RoundCompleteSheet summary={live.completed} nameOf={nameOf} voidReason={live.completed ? live.voidReasons[live.completed.roundId] : undefined}
        onNext={live.dismiss} onActivity={() => { live.dismiss(); if (!embed) nav('/app/activity'); }} />

      <Sheet open={expanded} onClose={() => setExpanded(false)} title="Stream">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">{t?.name} · Previous flop · {prev ? roundLabel(prev.hand_no) : '—'}</span>
          <button type="button" onClick={() => setExpanded(false)} aria-label="Close stream" className="grid h-9 w-9 place-items-center rounded-full border border-line"><X className="h-4 w-4" /></button>
        </div>
        <StreamView cards={prev?.cards} size="lg" revealKey={live.reveal} className="mt-3 h-[300px] rounded-[18px]" />
        {prev && <p className="mt-3 text-center font-serif text-2xl">{resultLine(prev.cards)}</p>}
        <p className="mt-2 text-center text-xs text-faint">Simulated table: the flop is real game data, shown on a demo felt.</p>
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
    </div>
  );
}

function ProblemNotice({ problem, pending, canReset, onAccept, onReset, onDismiss }: {
  problem: BetProblem; pending: boolean; canReset: boolean; onAccept: (odds: number) => void; onReset: () => void; onDismiss: () => void;
}) {
  return (
    <Notice tone={problem.kind === 'round_locked' ? 'info' : 'warn'}>
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p>{problem.message}</p>
          {problem.kind === 'price_changed' && problem.oddsCenti > 0 && (
            <Button size="sm" className="mt-2" disabled={pending} onClick={() => onAccept(problem.oddsCenti)}>
              Accept {formatOdds(problem.oddsCenti)} and confirm
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
