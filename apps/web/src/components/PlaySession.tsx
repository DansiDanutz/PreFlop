import { Button, cx, formatMoney } from '@preflop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailWarning, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { clockLabel, durationLabel, minutesNow, realityChecksDue } from '../lib/account.ts';
import { api, setToken } from '../lib/api.ts';
import { useToken } from '../lib/auth.tsx';
import { errorText } from '../lib/problems.ts';
import { useMe } from '../lib/queries.ts';
import { readString, writeString } from '../lib/storage.ts';
import { Sheet } from './ui.tsx';

/**
 * The play session of this sign-in (GET /v1/me/session), its clock, and the reality checks:
 * every session_minutes (or 60) a dialog shows the time played and the net result, with
 * Continue or Take a break. When the session limit is reached the API refuses bets until the
 * player signs in again; the dialog says so.
 */
export function usePlaySession() {
  const token = useToken();
  const q = useQuery({ queryKey: ['me', 'session'], queryFn: () => api.mySession(), enabled: !!token, refetchInterval: 60_000, staleTime: 30_000 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!q.data) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [q.data]);
  const minutes = q.data ? minutesNow(q.data.minutes_played, q.dataUpdatedAt, now) : 0;
  const limitReached = !!q.data && (q.data.limit_reached || (q.data.limit_minutes !== null && minutes >= q.data.limit_minutes));
  return { session: q.data ?? null, minutes, limitReached, refetch: q.refetch };
}

/** Small clock in the top bar: time played in this session (and the limit, when one is set). */
export function SessionClock({ className }: { className?: string | undefined }) {
  const { session, minutes, limitReached } = usePlaySession();
  if (!session) return null;
  const label = session.limit_minutes !== null ? `${clockLabel(minutes)} / ${clockLabel(session.limit_minutes)}` : clockLabel(minutes);
  return (
    <span role="timer" aria-label={`Session time ${durationLabel(minutes)}${session.limit_minutes !== null ? ` of ${durationLabel(session.limit_minutes)}` : ''}`}
      title="Time played since you signed in"
      className={cx('inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-1 font-mono text-[12px] tabular-nums', limitReached ? 'border-warn/60 text-warn' : 'border-line-strong text-ink/80', className)}>
      <Timer className="h-3.5 w-3.5" aria-hidden />{label}
    </span>
  );
}

const ackKey = (startedAt: string) => `pf.reality.${startedAt}`;

/** The reality-check dialog; mount once in the signed-in layout. `embed`: stay on the page after signing out. */
export function RealityCheck({ embed = false }: { embed?: boolean }) {
  const { session, minutes, limitReached } = usePlaySession();
  const nav = useNavigate();
  const qc = useQueryClient();
  // Checks already acknowledged in this session (kept per tab, so a reload does not repeat one).
  const [acked, setAcked] = useState(0);
  const [dismissedLimit, setDismissedLimit] = useState(false);
  const logout = useMutation({
    mutationFn: () => api.logout().catch(() => ({ ok: true as const })),
    onSettled: () => { setToken(null); qc.clear(); if (!embed) nav('/'); },
  });
  if (!session) return null;
  const ack = Math.max(acked, Number(readString(ackKey(session.started_at), 'session') ?? 0) || 0);
  const due = realityChecksDue(minutes, session.reality_check_minutes);
  const showLimit = limitReached && !dismissedLimit;
  const open = showLimit || due > ack;
  const cont = () => {
    writeString(ackKey(session.started_at), String(due), 'session');
    setAcked(due);
    if (limitReached) setDismissedLimit(true);
  };
  return (
    <Sheet open={open} onClose={cont} title="Reality check">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Reality check</p>
      <h2 className="mt-2 font-serif text-[28px] leading-tight tracking-[-0.03em]">
        {showLimit ? 'Your session limit is reached.' : `You have been playing for ${durationLabel(minutes)}.`}
      </h2>
      {showLimit && <p className="mt-2 text-sm text-ink/85">You set a limit of {durationLabel(session.limit_minutes ?? 0)}. Predictions are paused until you take a break and sign in again.</p>}
      <div className="mt-4 rounded-[10px] border border-line-strong/60 p-4">
        <div className="text-[12px] uppercase tracking-[0.12em] text-muted">This session</div>
        {session.results.length === 0 ? <p className="mt-1 text-sm text-ink/85">No predictions yet.</p> : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {session.results.map((r) => (
              <li key={`${r.mode}:${r.currency}`} className="flex justify-between gap-3">
                <span className="text-ink/85">{r.bets} prediction{r.bets === 1 ? '' : 's'} · {r.currency === 'PLAY' ? 'free chips' : r.currency}</span>
                <span className={cx('font-semibold tabular-nums', r.net_minor < 0 ? 'text-warn' : 'text-ink')}>
                  {r.net_minor > 0 ? '+' : ''}{formatMoney(r.net_minor, r.currency)}{r.open_stake_minor > 0 ? ` (${formatMoney(r.open_stake_minor, r.currency)} open)` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={cont}>{showLimit ? 'Keep browsing' : 'Continue'}</Button>
        <Button disabled={logout.isPending} onClick={() => logout.mutate()}>Take a break</Button>
      </div>
      <p className="mt-3 text-xs text-muted">Take a break signs you out. Limits and time-outs are in your profile.</p>
    </Sheet>
  );
}

/** Shown in the app until the email address is confirmed (partner players are verified by their operator). */
export function VerifyEmailBanner() {
  const me = useMe();
  const resend = useMutation({ mutationFn: () => api.resendVerification() });
  const u = me.data;
  if (!u || u.email_verified || u.partner_id) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warn/40 bg-warn/10 px-5 py-2.5 text-[13px] lg:px-10">
      <MailWarning className="h-4 w-4 shrink-0 text-warn" aria-hidden />
      {/* A long address wraps anywhere instead of running under the action; on phones the action
          takes its own line, lined up with the text. */}
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">Confirm your email: we sent a link to <strong>{u.email}</strong>. Real-money play needs a confirmed address.</span>
      <span className="basis-full pl-7 sm:basis-auto sm:pl-0">
        {resend.isSuccess ? <span className="text-accent">Sent. Check your inbox.</span>
          : resend.isError ? <span className="text-warn">{errorText(resend.error)}</span>
            : <button type="button" disabled={resend.isPending} onClick={() => resend.mutate()} className="min-h-[44px] font-semibold text-accent hover:underline sm:min-h-0">Send the link again</button>}
      </span>
    </div>
  );
}
