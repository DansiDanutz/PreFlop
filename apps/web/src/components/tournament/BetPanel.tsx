import { ApiError, type TournamentBet, newIdempotencyKey } from '@preflop/client';
import { Button, Segmented, StatusDot, cx, formatOdds } from '@preflop/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, LayoutGrid, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../../lib/api.ts';
import { resolveOption } from '../../lib/bets.ts';
import { roundLabel } from '../../lib/flop.ts';
import { openHandNo, tableStatus } from '../../lib/live.ts';
import { useBook, useFavorites, useLobby } from '../../lib/queries.ts';
import {
  QUICK_STAKES, type QuickStake, points, potentialReturn, pts, quickStake, quickStakeLabel, stakeCap, stakeError, tournamentErrorText,
} from '../../lib/tournaments.ts';
import { type TournamentView, tournamentKey } from '../../lib/useTournament.ts';
import { Notice, Skeleton } from '../ui.tsx';
import { CatalogueSheet } from '../table/Catalogue.tsx';
import { FavoriteTile } from '../table/Tiles.tsx';

/** A fresh key for every attempt (a price-change retry is a new attempt). */
const attemptKey = () => globalThis.crypto?.randomUUID?.() ?? newIdempotencyKey();

/** Applies a just-placed bet to the cached detail so the panel updates before the refetch lands. */
function withBet(d: TournamentView | undefined, bet: TournamentBet): TournamentView | undefined {
  if (!d?.you) return d;
  const apply = <S extends { stack: number; bets_used: number; bets_left: number; pending_bets: number }>(s: S): S =>
    ({ ...s, stack: s.stack - bet.stake, bets_used: s.bets_used + 1, bets_left: Math.max(0, s.bets_left - 1), pending_bets: s.pending_bets + 1 });
  return {
    ...d,
    you: { ...apply(d.you), bets: [bet, ...d.you.bets.filter((b) => b.id !== bet.id)] },
    standings: d.standings.map((s) => (s.you ? apply(s) : s)),
  };
}

/**
 * Bet tournament points on the open flop of any live table at the PreFlop odds of the moment.
 * One bet per flop: once you have a bet on a round, its selections are disabled until the next one.
 */
export function BetPanel({ d }: { d: TournamentView }) {
  const qc = useQueryClient();
  const lobby = useLobby();
  const book = useBook();
  const favs = useFavorites();
  const t = d.tournament;
  const you = d.you!;

  const tables = useMemo(() => (lobby.data?.tables ?? []).filter((x) => x.status === 'active'), [lobby.data]);
  const [tableId, setTableId] = useState<string | null>(null);
  // Default: an open flop you have not bet on yet, then any open flop, then any table.
  const table = tables.find((x) => x.id === tableId)
    ?? tables.find((x) => x.open_round_id && !you.bets.some((b) => b.round_id === x.open_round_id))
    ?? tables.find((x) => x.open_round_id) ?? tables[0] ?? null;
  const [selectedId, setSelectedId] = useState('hand-class:pair');
  const [stake, setStake] = useState<number>(() => quickStake('10', you.stack, t.min_stake, t.max_stake) ?? t.min_stake);
  const [catalogue, setCatalogue] = useState(false);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);

  const option = resolveOption(book.index, selectedId);
  const nameOf = (id: string) => resolveOption(book.index, id)?.name ?? id;
  const allOptions = useMemo(() => [...book.index.values()], [book.index]);
  const status = table ? tableStatus(table) : null;
  const openId = table?.open_round_id ?? null;
  const hand = table ? openHandNo(table) : null;
  const betThisFlop = !!openId && you.bets.some((b) => b.round_id === openId);
  const problem = stakeError(stake, you.stack, t.min_stake, t.max_stake);
  const chip = QUICK_STAKES.find((q) => quickStake(q, you.stack, t.min_stake, t.max_stake) === stake) ?? 'custom';

  const place = useMutation({
    mutationFn: (o: { acceptPrice?: number }) => {
      if (!openId) throw new ApiError(409, { type: 'round_locked', title: 'closed', status: 409 });
      if (!option?.offered) throw new ApiError(422, { type: 'not_offered', title: 'not offered', status: 422 });
      return api.tournamentBet(t.id, {
        round_id: openId, selection_id: option.id, stake, odds_centi: o.acceptPrice ?? option.oddsCenti,
        ...(o.acceptPrice !== undefined ? { accept_price_change: true } : {}),
        idempotency_key: attemptKey(),
      });
    },
    onMutate: () => { setError(null); setPlaced(null); setPriceChange(null); },
    onSuccess: (bet) => {
      qc.setQueryData<TournamentView>(tournamentKey(t.id), (old) => withBet(old, bet));
      void qc.invalidateQueries({ queryKey: tournamentKey(t.id) });
      setPlaced(`${nameOf(bet.selection_id)} at ${formatOdds(bet.odds_centi)} for ${points(bet.stake)}. Good luck.`);
      // Keep the next stake within the smaller stack.
      setStake((s) => Math.min(s, Math.max(t.min_stake, stakeCap(you.stack - bet.stake, t.max_stake))));
    },
    onError: (err) => {
      if (err instanceof ApiError && err.type === 'price_changed' && typeof err.problem.odds_centi === 'number') setPriceChange(err.problem.odds_centi);
      else setError(tournamentErrorText(err));
      if (err instanceof ApiError && ['one_bet_per_flop', 'no_bets_left', 'entry_busted', 'tournament_not_running'].includes(err.type)) {
        void qc.invalidateQueries({ queryKey: tournamentKey(t.id) });
      }
    },
  });

  const ret = option?.offered && !problem ? potentialReturn(stake, option.oddsCenti) : null;
  const canPlace = !!openId && !!option?.offered && !problem && !betThisFlop && !place.isPending;

  return (
    <section aria-labelledby="bet-h" className="rounded-[12px] border border-line-strong/60 bg-surface p-5 lg:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="bet-h" className="text-[20px] font-bold">Place a bet</h2>
        <span className="text-[12px] text-muted">{you.bets_left} of {t.bets_allowed} bets left</span>
      </div>

      {/* table and its open round */}
      <label htmlFor="t-table" className="mt-5 block text-[13px] font-medium">Table</label>
      {lobby.isLoading ? <Skeleton className="mt-1.5 h-12" /> : (
        <select id="t-table" value={table?.id ?? ''} onChange={(e) => { setTableId(e.target.value); setError(null); setPlaced(null); setPriceChange(null); }}
          className="mt-1.5 h-12 w-full rounded-[8px] border border-line-strong bg-surface-2 px-3.5 text-[15px] text-ink focus:border-accent focus:outline-none">
          {tables.length === 0 && <option value="">No live tables</option>}
          {tables.map((x) => <option key={x.id} value={x.id}>{x.name} — {tableStatus(x).label}</option>)}
        </select>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line-strong/60 bg-surface-2/50 px-4 py-3" aria-live="polite">
        <span className="text-[14px] font-semibold">{hand ? roundLabel(hand) : table?.current_round ? roundLabel(table.current_round.hand_no) : 'No round'}</span>
        {status && <StatusDot tone={betThisFlop ? 'info' : status.tone === 'accent' ? 'accent' : status.tone === 'warn' ? 'warn' : 'muted'}
          label={betThisFlop ? 'You have a bet on this flop' : status.open ? 'Open for bets' : status.label} />}
      </div>
      <p className="mt-2 text-[12px] text-ink/75">
        {betThisFlop ? 'One bet per flop. Wait for the next round here, or pick another table.' : openId ? 'Bets close when the dealer locks the round.' : 'The next round opens after this flop.'}
      </p>

      {/* selections */}
      <fieldset disabled={betThisFlop || !openId} className={cx('mt-5 min-w-0', (betThisFlop || !openId) && 'opacity-60')}>
        <legend className="text-[13px] font-medium">Your prediction</legend>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
          {favs.ids.map((id) => (
            <FavoriteTile key={id} id={id} option={resolveOption(book.index, id)} editing={false} onRemove={() => {}}
              selected={selectedId === id || resolveOption(book.index, id)?.id === selectedId} onSelect={() => { setSelectedId(id); setPriceChange(null); }} />
          ))}
        </div>
        <button type="button" onClick={() => setCatalogue(true)}
          className="mt-3 flex h-12 w-full items-center gap-3 rounded-[8px] border border-line-strong px-5 text-[15px] hover:border-accent/60">
          <LayoutGrid className="h-[18px] w-[18px]" strokeWidth={1.6} aria-hidden />
          <span className="flex-1 text-left">Browse all {allOptions.length || ''} bets</span>
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </fieldset>

      <div className="mt-5 flex items-baseline justify-between gap-3 border-t border-line pt-5">
        <span className="min-w-0 truncate text-[17px] font-bold">{option ? nameOf(selectedId) : 'Choose a bet'}</span>
        <span className="shrink-0 text-[17px] font-bold text-accent">{option?.offered ? formatOdds(option.oddsCenti) : option ? <span className="text-sm font-normal text-faint">Not offered</span> : ''}</span>
      </div>

      {/* stake */}
      <div className="mt-4 flex items-center justify-between text-[12px]">
        <label htmlFor="t-stake" className="text-[14px]">Stake (points)</label>
        <span className="text-ink/80">{pts(t.min_stake)}–{pts(stakeCap(you.stack, t.max_stake))} · stack {pts(you.stack)}</span>
      </div>
      <input id="t-stake" type="number" inputMode="numeric" min={t.min_stake} max={stakeCap(you.stack, t.max_stake)} step={1} value={stake || ''}
        aria-invalid={!!problem} aria-describedby="t-stake-h"
        onChange={(e) => setStake(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="mt-2 h-12 w-full rounded-[8px] border border-line-strong/70 bg-bg px-4 text-center text-[16px] text-ink focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
      <Segmented<QuickStake | 'custom'> className="mt-2.5" options={QUICK_STAKES} value={chip}
        onChange={(q) => { const v = q === 'custom' ? null : quickStake(q, you.stack, t.min_stake, t.max_stake); if (v !== null) setStake(v); }}
        render={(q) => (q === 'custom' ? '' : quickStakeLabel(q))} />
      <p id="t-stake-h" className={cx('mt-2 text-xs', problem && stake > 0 ? 'text-warn' : 'text-muted')}>
        {problem && stake > 0 ? problem : 'Points have no cash value and only exist inside this tournament.'}
      </p>

      <div className="mt-4 flex items-baseline justify-between text-[13px]">
        <span className="text-ink/85">Back on your stack if it wins</span>
        <span className="font-bold tabular-nums">{ret !== null ? points(ret) : '—'}</span>
      </div>

      {priceChange !== null && (
        <Notice tone="warn" className="mt-4">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p>The price moved to <strong>{formatOdds(priceChange)}</strong> before your bet was placed.</p>
              <Button size="sm" className="mt-2" disabled={place.isPending} onClick={() => place.mutate({ acceptPrice: priceChange })}>
                Accept {formatOdds(priceChange)} and place
              </Button>
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => setPriceChange(null)} className="text-muted hover:text-ink"><X className="h-4 w-4" /></button>
          </div>
        </Notice>
      )}
      {error && <Notice tone="warn" className="mt-4">{error}</Notice>}
      {placed && !error && <Notice tone="accent" className="mt-4">{placed}</Notice>}

      <Button size="lg" className="mt-5 h-[50px] w-full text-[15px]" disabled={!canPlace} onClick={() => place.mutate({})}>
        {place.isPending ? 'Placing…' : betThisFlop ? 'Already bet on this flop' : !openId ? 'Waiting for the next round' : `Place bet · uses 1 of ${you.bets_left}`}
      </Button>

      <CatalogueSheet open={catalogue} onClose={() => setCatalogue(false)} options={allOptions} loading={book.isLoading} error={book.isError} onRetry={() => void book.refetch()}
        favorites={favs.ids} onSaveFavorites={(ids) => favs.save(ids)} pool={false} inRoom={false}
        onPick={(o) => { setSelectedId(o.id); setPriceChange(null); setCatalogue(false); }} />
    </section>
  );
}
