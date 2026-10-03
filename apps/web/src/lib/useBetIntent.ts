import type { BetView } from '@preflop/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { type BetIntent, intentStore, reconcileIntent, submitIntent } from './betIntent.ts';

export type IntentStatus = 'idle' | 'sending' | 'checking';

/**
 * The table's bet-slip lifecycle around a frozen BetIntent (lib/betIntent.ts):
 * - submit(intent): persist it, send it (same key on every retry), clear it on a definitive answer;
 * - an intent left from before a reload (or whose outcome stayed unknown) is reconciled through
 *   GET /v1/me/bets every few seconds, and no new bet is allowed until it is.
 */
export function useBetIntent(h: {
  onPlaced: (bet: BetView, intent: BetIntent) => void;
  onRefused: (error: unknown, intent: BetIntent) => void;
  /** The intent stayed uncertain after the retries (we keep checking), or reconciled as never placed. */
  onUnknown: (intent: BetIntent) => void;
  onNotPlaced: (intent: BetIntent) => void;
}) {
  const [pending, setPending] = useState<BetIntent | null>(() => intentStore.load());
  const [status, setStatus] = useState<IntentStatus>(() => (pending ? 'checking' : 'idle'));
  const handlers = useRef(h);
  handlers.current = h;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const settle = useCallback(() => {
    intentStore.clear();
    if (!alive.current) return;
    setPending(null);
    setStatus('idle');
  }, []);

  const submit = useCallback(async (intent: BetIntent) => {
    let cur = intent;
    intentStore.save(cur);
    setPending(cur);
    setStatus('sending');
    const out = await submitIntent(api, cur, {
      onSend: (i) => { cur = Object.freeze({ ...i, sentAt: Date.now() }); intentStore.save(cur); },
    });
    if (out.kind === 'placed') { settle(); handlers.current.onPlaced(out.bet, intent); }
    else if (out.kind === 'refused') { settle(); handlers.current.onRefused(out.error, intent); }
    else if (out.kind === 'not_placed') { settle(); handlers.current.onNotPlaced(intent); }
    else if (alive.current) { setPending(cur); setStatus('checking'); handlers.current.onUnknown(intent); }
  }, [settle]);

  // Reconcile a pending intent (after a reload, or after an uncertain submit) before any new bet.
  useEffect(() => {
    if (status !== 'checking' || !pending) return;
    let stop = false;
    const tick = async () => {
      const out = await reconcileIntent(api, pending);
      if (stop) return;
      if (out.kind === 'placed') { settle(); handlers.current.onPlaced(out.bet, pending); }
      else if (out.kind === 'not_placed') { settle(); handlers.current.onNotPlaced(pending); }
    };
    void tick();
    const t = setInterval(() => void tick(), 3000);
    return () => { stop = true; clearInterval(t); };
  }, [status, pending, settle]);

  return { pending, status, submit, busy: status !== 'idle' };
}
