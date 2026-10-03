import type { StreamEvent, TournamentDetail } from '@preflop/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';
import { useToken } from './auth.tsx';
import { useStream } from './stream.ts';

/** The detail plus the server clock offset measured when it arrived. */
export type TournamentView = TournamentDetail & { offset: number };

export const tournamentKey = (id: string) => ['tournament', id] as const;

/** offset = server_time − device time at receipt, so countdowns follow the server, not the phone. */
export const withOffset = (d: TournamentDetail): TournamentView => ({ ...d, offset: Date.parse(d.server_time) - Date.now() });

/**
 * One tournament, kept live: WS `tournament:<id>` → `tournament.standings` refetches the detail,
 * and polling (5 s while running or settling, faster just before the start) covers a dropped socket.
 */
export function useTournament(id: string) {
  const qc = useQueryClient();
  const token = useToken();
  const q = useQuery({
    queryKey: tournamentKey(id),
    queryFn: async () => withOffset(await api.tournament(id)),
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return false;
      const s = d.tournament.status;
      if (s === 'running' || s === 'settling') return 5_000;
      if (s === 'scheduled') return Date.parse(d.tournament.starts_at) - (Date.now() + d.offset) < 60_000 ? 5_000 : 30_000;
      return false;
    },
  });
  const onEvent = useCallback((e: StreamEvent) => {
    if (e.type !== 'tournament.standings') return;
    const tid = typeof e.data?.tournament_id === 'string' ? e.data.tournament_id : id;
    if (tid === id) void qc.invalidateQueries({ queryKey: tournamentKey(id) });
  }, [qc, id]);
  // Standings events missed while the socket was down: refetch on reconnect.
  const ws = useStream([`tournament:${id}`], onEvent, token, () => void qc.invalidateQueries({ queryKey: tournamentKey(id) }));
  return { ...q, ws };
}

/** Device time plus an offset, re-rendered every `ms` (one second by default). */
export function useServerNow(offset: number, ms = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now + offset;
}
