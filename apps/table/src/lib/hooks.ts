import { useCallback, useEffect, useRef, useState } from 'react';
import { type Action, ApiProblem, type TableApi } from './api.ts';
import { isRetryable } from './problems.ts';
import type { Round, TableState } from './types.ts';

export const POLL_MS = 1500;

export interface Live {
  state: TableState | null;
  /** Last poll error (null when the last poll succeeded). */
  error: ApiProblem | null;
  lastOkAt: number | null;
  refresh: () => void;
}

/** Polls the signed GET /state every 1.5 s. Never queues anything. */
export function useTableState(api: TableApi): Live {
  const [state, setState] = useState<TableState | null>(null);
  const [error, setError] = useState<ApiProblem | null>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const busy = useRef(false);
  const tick = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const s = await api.state();
      setState(s);
      setError(null);
      setLastOkAt(Date.now());
    } catch (e) {
      setError(e instanceof ApiProblem ? e : new ApiProblem(0, 'network'));
    } finally {
      busy.current = false;
    }
  }, [api]);
  useEffect(() => {
    void tick();
    const h = setInterval(() => void tick(), POLL_MS);
    const vis = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(h); document.removeEventListener('visibilitychange', vis); };
  }, [tick]);
  return { state, error, lastOkAt, refresh: () => void tick() };
}

export interface Runner {
  run: (a: Action) => Promise<unknown>;
  retry: () => Promise<unknown>;
  dismiss: () => void;
  pending: Action | null;
  /** The failed action, kept so a retry reuses its Idempotency-Key. */
  failed: { action: Action; problem: ApiProblem; retryable: boolean } | null;
}

/**
 * Runs one write at a time. On no answer (network / timeout / retry_later) the action is kept
 * and the user gets a RETRY that resends the SAME Idempotency-Key with a fresh nonce. Nothing is
 * queued or retried silently.
 */
export function useRunner(api: TableApi, onDone?: (a: Action, result: unknown) => void, onProblem?: (a: Action, p: ApiProblem) => boolean | void): Runner {
  const [pending, setPending] = useState<Action | null>(null);
  const [failed, setFailed] = useState<Runner['failed']>(null);
  const inflight = useRef(false);
  const exec = useCallback(async (a: Action) => {
    if (inflight.current) return undefined;
    inflight.current = true;
    setPending(a);
    setFailed(null);
    try {
      const res = await api.send(a);
      onDone?.(a, res);
      return res;
    } catch (e) {
      const p = e instanceof ApiProblem ? e : new ApiProblem(0, 'network');
      const handled = onProblem?.(a, p);
      if (!handled) setFailed({ action: a, problem: p, retryable: isRetryable(p.type) || p.status >= 500 });
      return undefined;
    } finally {
      inflight.current = false;
      setPending(null);
    }
  }, [api, onDone, onProblem]);
  return {
    run: exec,
    retry: () => (failed ? exec(failed.action) : Promise.resolve(undefined)),
    dismiss: () => setFailed(null),
    pending,
    failed,
  };
}

// ------------------------------------------------------------------ local memory of own entries

/**
 * The state endpoint returns entries for the latest round only, so the tablet also remembers
 * its own submissions (round id → cards) to know a hand no longer needs its entry.
 */
const memKey = (cred: string) => `preflop-table:entries:${cred}`;
function readMem(cred: string): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem(memKey(cred)) ?? '{}') as Record<string, string[]>; } catch { return {}; }
}
export function useMyEntries(cred: string) {
  const [mem, setMem] = useState<Record<string, string[]>>(() => readMem(cred));
  const remember = useCallback((roundId: string, cards: string[]) => {
    setMem((m) => {
      const ids = Object.keys(m);
      const next = { ...m, [roundId]: cards };
      if (ids.length > 50) for (const k of ids.slice(0, ids.length - 50)) delete next[k];
      try { localStorage.setItem(memKey(cred), JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [cred]);
  return { mem, remember };
}

// ------------------------------------------------------------------ derived

export const needsEntry = (r: Round) => (r.state === 'LOCKED' && r.step === 'dealing') || r.state === 'DEALT' || r.state === 'REVIEW';

/** Whether this tablet's side (dealer / floor) of the flop is already recorded for round r. */
export function entryDone(s: TableState, r: Round, source: 'dealer' | 'floor', mem: Record<string, string[]>): boolean {
  if (mem[r.id]) return true;
  return s.rounds[0]?.id === r.id && s.entries.some((e) => e.source === source);
}

/** Oldest hand among the latest three that still needs this side's entry. */
export function pendingEntry(s: TableState, source: 'dealer' | 'floor', mem: Record<string, string[]>): Round | undefined {
  return [...s.rounds].reverse().find((r) => needsEntry(r) && !entryDone(s, r, source, mem));
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(h);
  }, [ms]);
  return now;
}
