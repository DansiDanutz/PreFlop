import { useCallback, useEffect, useRef, useState } from 'react';
import { type Action, ApiProblem, type TableApi } from './api.ts';
import { signingAllowed } from './lock.ts';
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
    // A locked tablet signs nothing, polls included.
    if (busy.current || !signingAllowed()) return;
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

export type RunOutcome =
  | { ok: true; result: unknown }
  | { ok: false; failed: { action: Action; problem: ApiProblem; retryable: boolean } | null };

/**
 * Sends one action and reports the outcome. `onDone` (the local workflow: remembered entries,
 * refresh) runs ONLY for an acknowledged write; a missing or unreadable acknowledgement comes back
 * as a retryable failure that keeps the same Action (and so the same Idempotency-Key).
 */
export async function runAction(api: Pick<TableApi, 'send'>, a: Action, onDone?: (a: Action, result: unknown) => void,
  onProblem?: (a: Action, p: ApiProblem) => boolean | void): Promise<RunOutcome> {
  let res: unknown;
  try {
    res = await api.send(a);
  } catch (e) {
    const p = e instanceof ApiProblem ? e : new ApiProblem(0, 'network');
    const handled = onProblem?.(a, p);
    return { ok: false, failed: handled ? null : { action: a, problem: p, retryable: isRetryable(p.type) || p.status >= 500 } };
  }
  onDone?.(a, res);
  return { ok: true, result: res };
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
      const out = await runAction(api, a, onDone, onProblem);
      if (out.ok) return out.result;
      if (out.failed) setFailed(out.failed);
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

// ------------------------------------------------------------------ own entries

/**
 * The server says per round whether each side has entered and what this person entered
 * (`has_*_entry`, `my_entry`). This session-only map is a safety net between a successful submit
 * and the next poll, and records `duplicate_entry` answers (side already entered elsewhere).
 */
export function useMyEntries() {
  const [mem, setMem] = useState<Record<string, string[]>>({});
  const remember = useCallback((roundId: string, cards: string[]) => setMem((m) => ({ ...m, [roundId]: cards })), []);
  return { mem, remember };
}

/** This person's entry for round r (server first), or undefined. */
export const myEntry = (r: Round, mem: Record<string, string[]>): string[] | undefined => r.my_entry ?? mem[r.id];

// ------------------------------------------------------------------ derived

export const needsEntry = (r: Round) => (r.state === 'LOCKED' && r.step === 'dealing') || r.state === 'DEALT' || r.state === 'REVIEW';

/** Whether this tablet's side (dealer / floor) of the flop is already recorded for round r. */
export function entryDone(_s: TableState, r: Round, source: 'dealer' | 'floor', mem: Record<string, string[]>): boolean {
  if (r.my_entry || mem[r.id]) return true;
  return source === 'dealer' ? r.has_dealer_entry : r.has_floor_entry;
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
