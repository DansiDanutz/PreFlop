import type { MyBet, StreamEvent, TableDetail } from '@preflop/client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { useToken } from './auth.tsx';
import { applyRoundEvent } from './live.ts';
import { qk, useTableDetail } from './queries.ts';
import { type RoundSummary, isFinal, summarizeRounds } from './rounds.ts';
import { useStream } from './stream.ts';

/**
 * Queries to refetch after the table socket re-opens: round events sent while it was down are
 * lost, so the cached table (open round, phase), the lobby rows and the player's bets and wallets
 * may all be stale. Without this the screen could keep showing a round as open after it locked.
 */
export const reconnectKeys = (tableId: string) => [qk.table(tableId), qk.lobby, qk.bets, qk.wallets] as const;

/** A bet shown on the table. Each keeps its own wallet currency: one table can hold bets from several wallets (rooms). */
export interface PlacedBet { betId: string; roundId: string; selectionId: string; stakeMinor: number; oddsCenti: number; status: string; currency: string }

/**
 * Everything live about one table for the player: the table state (patched from WS), the reveal
 * flash, the bets placed in this session and the Round complete summaries once they settle.
 * Settlement is detected from WS bet.settled / bet.voided, with GET /v1/me/bets polling as a
 * fallback so a dropped socket never leaves the player without a result.
 */
export function useTableLive(tableId: string) {
  const qc = useQueryClient();
  const token = useToken();
  const detail = useTableDetail(tableId);
  const [reveal, setReveal] = useState<{ key: string; until: number } | null>(null);
  const [placed, setPlaced] = useState<PlacedBet[]>([]);
  const [completed, setCompleted] = useState<RoundSummary[]>([]);
  const [voidReasons, setVoidReasons] = useState<Record<string, string>>({});
  const shown = useRef(new Set<string>());
  const placedRef = useRef(placed);
  placedRef.current = placed;

  // ---- settlement check (WS-triggered or polled)
  const checking = useRef(false);
  const check = useCallback(async () => {
    const pendingRounds = [...new Set(placedRef.current.filter((b) => !isFinal(b.status)).map((b) => b.roundId))];
    if (!pendingRounds.length || checking.current) return;
    checking.current = true;
    try {
      const { bets } = await api.myBets({ limit: 100 });
      const byId = new Map(bets.map((b) => [b.bet_id, b]));
      setPlaced((cur) => cur.map((p) => { const b = byId.get(p.betId); return b && b.status !== p.status ? { ...p, status: b.status } : p; }));
      for (const roundId of pendingRounds) {
        const mine = bets.filter((b) => b.round_id === roundId);
        const ours = placedRef.current.filter((p) => p.roundId === roundId);
        if (!ours.length || ours.some((p) => !byId.has(p.betId))) continue;
        if (mine.some((b) => !isFinal(b.status))) continue;
        // One summary per wallet: 100 free chips and 20 diamonds on one round are never added up.
        for (const s of summarizeRounds(mine)) {
          const k = `${roundId}|${s.walletKey}`;
          if (shown.current.has(k)) continue;
          shown.current.add(k);
          setCompleted((c) => [...c, s]);
          void qc.invalidateQueries({ queryKey: ['me'] });
        }
      }
    } catch {
      /* keep polling */
    } finally {
      checking.current = false;
    }
  }, [qc]);

  const hasPending = placed.some((b) => !isFinal(b.status));
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => void check(), 2500);
    return () => clearInterval(t);
  }, [hasPending, check]);

  // ---- stream
  const onEvent = useCallback((e: StreamEvent) => {
    if (e.type.startsWith('round.') && e.table_id === tableId) {
      qc.setQueryData<TableDetail>(qk.table(tableId), (old) => (old ? applyRoundEvent(old, e) : old));
      if (e.type === 'round.dealt' && e.round_id) setReveal({ key: e.round_id, until: Date.now() + 2600 });
      if (e.type === 'round.voided' && e.round_id) {
        setVoidReasons((v) => ({ ...v, [e.round_id!]: String(e.data?.reason ?? 'The round could not be verified.') }));
      }
      if ((e.type === 'round.settled' || e.type === 'round.voided') && placedRef.current.some((b) => b.roundId === e.round_id)) void check();
    }
    if (e.type === 'bet.settled' || e.type === 'bet.voided') {
      const betId = String(e.data?.betId ?? '');
      const status = e.type === 'bet.voided' ? 'void' : String(e.data?.status ?? '');
      setPlaced((cur) => cur.map((b) => (b.betId === betId ? { ...b, status } : b)));
      void check();
    }
  }, [qc, tableId, check]);
  // While the table refetches after a reconnect, bets stay paused: the cached round may be stale.
  const [resyncing, setResyncing] = useState(false);
  const restoreRef = useRef<() => void>(() => {});
  const onReconnect = useCallback(() => {
    setResyncing(true);
    const [table, ...rest] = reconnectKeys(tableId);
    for (const queryKey of rest) void qc.invalidateQueries({ queryKey });
    void qc.refetchQueries({ queryKey: table }).finally(() => setResyncing(false));
    restoreRef.current();
    void check();
  }, [qc, tableId, check]);
  const ws = useStream([`table:${tableId}`], onEvent, token, onReconnect);

  useEffect(() => {
    if (!reveal) return;
    const t = setTimeout(() => setReveal(null), Math.max(0, reveal.until - Date.now()));
    return () => clearTimeout(t);
  }, [reveal]);

  const addPlaced = useCallback((b: PlacedBet) => setPlaced((cur) => (cur.some((x) => x.betId === b.betId) ? cur : [...cur, b])), []);
  const dismiss = useCallback(() => setCompleted((c) => c.slice(1)), []);

  /** Restores the player's own accepted bets on this table after a reload (and after a reconnect). */
  const stopped = useRef(false);
  const restore = useCallback(() => {
    if (!token) return;
    api.myBets({ limit: 50, status: 'accepted' }).then(({ bets }) => {
      if (stopped.current) return;
      const here = bets.filter((b: MyBet) => b.table_id === tableId);
      setPlaced((cur) => [...cur, ...here.filter((b) => !cur.some((c) => c.betId === b.bet_id)).map((b) => ({
        betId: b.bet_id, roundId: b.round_id, selectionId: b.selection_id, stakeMinor: b.stake_minor, oddsCenti: b.odds_centi, status: b.status, currency: b.currency,
      }))]);
    }).catch(() => {});
  }, [token, tableId]);
  restoreRef.current = restore;
  useEffect(() => {
    stopped.current = false;
    restore();
    return () => { stopped.current = true; };
  }, [restore]);

  return { detail, reveal: reveal?.key ?? null, placed, addPlaced, completed: completed[0] ?? null, dismiss, voidReasons, ws, resyncing };
}
