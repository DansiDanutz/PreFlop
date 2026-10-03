import type { Tournament } from '@preflop/client';
import { Button, cx } from '@preflop/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/api.ts';
import { useRealMoney } from '../../lib/queries.ts';
import { amountLabel } from '../../lib/rooms.ts';
import { tournamentErrorText } from '../../lib/tournaments.ts';
import { tournamentKey, withOffset } from '../../lib/useTournament.ts';
import { Notice, Sheet } from '../ui.tsx';

/**
 * Register / Unregister for one tournament. A paid buy-in asks for confirmation first and says it
 * comes back if the player unregisters before the start or the tournament is cancelled.
 */
export function RegisterControls({ t, compact = false, className }: { t: Tournament; compact?: boolean; className?: string }) {
  const qc = useQueryClient();
  const realOn = useRealMoney();
  const [confirm, setConfirm] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['tournaments'] });
    void qc.invalidateQueries({ queryKey: tournamentKey(t.id) });
    void qc.invalidateQueries({ queryKey: ['me', 'wallets'] });
  };
  const register = useMutation({
    mutationFn: () => api.registerTournament(t.id),
    onMutate: () => setMsg(null),
    onSuccess: (d) => {
      qc.setQueryData(tournamentKey(t.id), withOffset(d));
      setConfirm(false);
      setMsg(t.buy_in_minor > 0 ? `You are in. ${amountLabel(t.buy_in_minor, t.currency)} paid.` : 'You are in. Good luck.');
      refresh();
    },
  });
  const unregister = useMutation({
    mutationFn: () => api.unregisterTournament(t.id),
    onMutate: () => setMsg(null),
    onSuccess: (r) => {
      setConfirmLeave(false);
      setMsg(r.refunded_minor > 0 ? `Unregistered. ${amountLabel(r.refunded_minor, t.currency)} refunded.` : 'Unregistered.');
      refresh();
    },
  });

  const registered = !!t.you?.registered;
  const real = t.mode === 'real-fiat' || t.mode === 'real-crypto';
  const full = t.max_entries !== null && t.entries >= t.max_entries;
  const err = register.error ?? unregister.error;
  const size = compact ? 'sm' : 'md';
  const over = t.status === 'completed' || t.status === 'cancelled' || t.status === 'settling';

  let control;
  if (over) control = null;
  else if (registered) {
    control = (
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent"><Check className="h-4 w-4" aria-hidden /> Registered</span>
        {t.status === 'scheduled' && (
          <Button variant="secondary" size={size} disabled={unregister.isPending} onClick={() => setConfirmLeave(true)}>
            {unregister.isPending ? 'Unregistering…' : 'Unregister'}
          </Button>
        )}
      </div>
    );
  } else if (real && !realOn) control = <span className="text-[13px] text-muted">Opens when real money is on</span>;
  else if (!t.registration_open) control = <span className="text-[13px] text-muted">{full ? 'Full' : 'Registration closed'}</span>;
  else {
    control = (
      <Button size={size} disabled={register.isPending} onClick={() => (t.buy_in_minor > 0 ? setConfirm(true) : register.mutate())}>
        {register.isPending ? 'Registering…' : t.buy_in_minor > 0 ? `Register · ${amountLabel(t.buy_in_minor, t.currency)}` : 'Register · Freeroll'}
      </Button>
    );
  }

  return (
    <div className={cx('min-w-0', className)}>
      {control}
      {err && !confirm && !confirmLeave && <Notice tone="warn" className="mt-3">{tournamentErrorText(err)}</Notice>}
      {msg && !err && <Notice tone="accent" className="mt-3">{msg}</Notice>}
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Confirm your buy-in">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Buy-in</p>
        <h2 className="mt-2 font-serif text-[28px] leading-tight tracking-[-0.03em]">Join {t.name}?</h2>
        <div className="mt-5 flex items-baseline justify-between rounded-[10px] border border-line-strong/70 bg-surface-2 px-4 py-3">
          <span className="text-[14px] text-ink/80">Paid from your wallet now</span>
          <span className="text-[18px] font-bold tabular-nums">{amountLabel(t.buy_in_minor, t.currency)}</span>
        </div>
        <p className="mt-3 text-[13px] text-ink/80">
          Refunded in full if you unregister before the start, or if the tournament is cancelled.
          {t.currency === 'PLAY' || t.currency === 'CHIP' || t.currency === 'DIAMOND' ? ' No cash value.' : ''}
        </p>
        {register.isError && <Notice tone="warn" className="mt-3">{tournamentErrorText(register.error)}</Notice>}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
          <Button disabled={register.isPending} onClick={() => register.mutate()}>{register.isPending ? 'Registering…' : 'Pay and register'}</Button>
        </div>
      </Sheet>
      <Sheet open={confirmLeave} onClose={() => setConfirmLeave(false)} labelledBy={`leave-${t.id}`}>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-warn">Unregister</p>
        <h2 id={`leave-${t.id}`} className="mt-2 font-serif text-[28px] leading-tight tracking-[-0.03em]">Leave {t.name}?</h2>
        <p className="mt-3 text-[14px] text-ink/80">
          {t.buy_in_minor > 0 ? <>Your buy-in of <strong className="text-ink">{amountLabel(t.buy_in_minor, t.currency)}</strong> goes back to your wallet. </> : null}
          You can register again while registration is open{t.max_entries !== null ? ', if a seat is still free' : ''}.
        </p>
        {unregister.isError && <Notice tone="warn" className="mt-3">{tournamentErrorText(unregister.error)}</Notice>}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setConfirmLeave(false)}>Stay registered</Button>
          <Button disabled={unregister.isPending} onClick={() => unregister.mutate()}>{unregister.isPending ? 'Unregistering…' : 'Unregister'}</Button>
        </div>
      </Sheet>
    </div>
  );
}
