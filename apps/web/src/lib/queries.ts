import type { Lobby, StreamEvent, TableDetail } from '@preflop/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { api } from './api.ts';
import { useToken } from './auth.tsx';
import { DEFAULT_FAVORITES, indexBook, sanitizeFavorites } from './bets.ts';
import { applyRoundEvent } from './live.ts';
import { isNotImplemented } from './problems.ts';
import { type RoomDetail, roomWallet } from './rooms.ts';
import { KEYS, readJson, readString, writeJson, writeString } from './storage.ts';
import { useStream } from './stream.ts';

const FAV_MISSING = 'pf.favorites.api-missing';
const favApiMissing = () => readString(FAV_MISSING, 'session') === '1';

// ------------------------------------------------------------------ rooms

export const useRooms = () => useQuery({ queryKey: ['rooms'], queryFn: () => api.rooms(), staleTime: 60_000 });

/** A room (with its own odds) and the closed-loop wallet the player uses in it. */
export function useRoom(roomId: string | null) {
  const room = useQuery({
    queryKey: ['room', roomId],
    queryFn: () => api.room(roomId!) as Promise<RoomDetail>,
    enabled: !!roomId,
    staleTime: 60_000,
  });
  const wallets = useWallets();
  const wallet = room.data ? roomWallet(wallets.data?.wallets, room.data) : undefined;
  return { room: room.data ?? null, isLoading: room.isLoading && !!roomId, isError: room.isError, wallet, walletsLoaded: !!wallets.data };
}

export const qk = {
  book: ['book'] as const,
  modes: ['modes'] as const,
  lobby: ['lobby'] as const,
  club: (id: string) => ['club', id] as const,
  table: (id: string) => ['table', id] as const,
  me: ['me'] as const,
  wallets: ['me', 'wallets'] as const,
  bets: ['me', 'bets'] as const,
  stats: ['me', 'stats'] as const,
  ledger: ['me', 'ledger'] as const,
  favorites: ['me', 'favorites'] as const,
  limits: ['me', 'limits'] as const,
};

export function useBook() {
  const q = useQuery({ queryKey: qk.book, queryFn: () => api.book(), staleTime: 10 * 60_000 });
  const index = useMemo(() => indexBook(q.data), [q.data]);
  return { ...q, index };
}

export const useModes = () => useQuery({ queryKey: qk.modes, queryFn: () => api.modes(), staleTime: 5 * 60_000 });

/** True when any real-money mode is switched on. */
export function useRealMoney(): boolean {
  const m = useModes().data?.modes;
  return !!(m?.['real-fiat'] || m?.['real-crypto']);
}

const ROUND_EVENTS = new Set(['round.opened', 'round.locked', 'round.dealt', 'round.settled', 'round.voided', 'round.review']);

/** The lobby, kept live by patching the cache from the WS "lobby" topic. */
export function useLobby() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.lobby, queryFn: () => api.lobby(), refetchInterval: 60_000 });
  useStream(['lobby'], (e: StreamEvent) => {
    if (!ROUND_EVENTS.has(e.type)) return;
    qc.setQueryData<Lobby>(qk.lobby, (old) => (old ? { ...old, tables: old.tables.map((t) => applyRoundEvent(t, e)) } : old));
  });
  return q;
}

export function useMe() {
  const token = useToken();
  return useQuery({ queryKey: qk.me, queryFn: () => api.me(), enabled: !!token, staleTime: 30_000 });
}

export function useWallets() {
  const token = useToken();
  return useQuery({ queryKey: qk.wallets, queryFn: () => api.wallets(), enabled: !!token, staleTime: 5_000 });
}

/** Balance of one mode/currency wallet (defaults to free chips). */
export function useBalance(mode = 'play', currency = 'PLAY') {
  const w = useWallets();
  const wallet = w.data?.wallets.find((x) => x.mode === mode && x.currency === currency);
  return { ...w, balance: wallet?.balance_minor ?? (w.data ? 0 : null) };
}

export function useResetPlay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.resetPlay(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useTableDetail(id: string) {
  return useQuery<TableDetail>({ queryKey: qk.table(id), queryFn: () => api.table(id), refetchInterval: 60_000, retry: (n, err) => !isNotImplemented(err) && n < 2 });
}

// ------------------------------------------------------------------ favorites

/**
 * Favorite bets: GET/PUT /v1/me/favorites when the API has it; otherwise (404) the list lives in
 * localStorage on this device. The local copy is always kept as a cache.
 */
export function useFavorites() {
  const qc = useQueryClient();
  const token = useToken();
  const q = useQuery({
    queryKey: qk.favorites,
    queryFn: async (): Promise<{ ids: string[]; source: 'api' | 'device' }> => {
      const local = sanitizeFavorites(readJson(KEYS.favorites)) ?? [...DEFAULT_FAVORITES];
      if (!token || favApiMissing()) return { ids: local, source: 'device' };
      try {
        const r = await api.favorites();
        const ids = sanitizeFavorites(r.selection_ids);
        // An empty server list for a new account means "never set": keep the defaults.
        const out = ids && ids.length ? ids : local;
        writeJson(KEYS.favorites, out);
        return { ids: out, source: 'api' };
      } catch (err) {
        if (isNotImplemented(err)) {
          writeString(FAV_MISSING, '1', 'session');
          return { ids: local, source: 'device' };
        }
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
  const save = useMutation({
    mutationFn: async (ids: string[]) => {
      writeJson(KEYS.favorites, ids);
      qc.setQueryData(qk.favorites, { ids, source: q.data?.source ?? 'device' });
      if (!token || favApiMissing()) return;
      try {
        await api.setFavorites(ids);
      } catch (err) {
        if (!isNotImplemented(err)) throw err;
      }
    },
  });
  return { ids: q.data?.ids ?? [...DEFAULT_FAVORITES], source: q.data?.source ?? 'device', isLoading: q.isLoading, save: save.mutate, saving: save.isPending, saveError: save.error };
}

// ------------------------------------------------------------------ favorite clubs (device only)

export function useFavoriteClubs() {
  const [ids, setIds] = useState<string[]>(() => sanitizeFavorites(readJson(KEYS.favoriteClubs), 100) ?? []);
  const toggle = useCallback((id: string) => {
    setIds((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      writeJson(KEYS.favoriteClubs, next);
      return next;
    });
  }, []);
  return { ids, toggle, has: (id: string) => ids.includes(id) };
}

/** Tables the player starred in the lobby (a per-device convenience, like favorite clubs). */
export function useSavedTables() {
  const [ids, setIds] = useState<string[]>(() => sanitizeFavorites(readJson(KEYS.savedTables), 100) ?? []);
  const toggle = useCallback((id: string) => {
    setIds((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      writeJson(KEYS.savedTables, next);
      return next;
    });
  }, []);
  return { ids, toggle, has: (id: string) => ids.includes(id) };
}
