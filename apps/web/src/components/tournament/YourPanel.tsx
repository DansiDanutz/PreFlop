import { cx } from '@preflop/ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { amountLabel } from '../../lib/rooms.ts';
import { ENTRY_STATUS, type TournamentClock, countdownAnnouncement, formatCountdown, pendingText, pts, rankChangeText, rankLabel } from '../../lib/tournaments.ts';
import type { TournamentView } from '../../lib/useTournament.ts';

function Stat({ label, short, children, className }: { label: string; short?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <dt className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/70 lg:text-[11px]">
        {short ? <><span className="lg:hidden">{short}</span><span className="hidden lg:inline">{label}</span></> : label}
      </dt>
      <dd className="mt-0.5 truncate text-[17px] font-bold leading-tight tabular-nums lg:font-serif lg:text-[28px] lg:font-normal">{children}</dd>
    </div>
  );
}

/**
 * "Your panel": position, stack, bets used, bets left and time left, always in view while the
 * tournament runs (sticky under the top bar). The visible clock ticks every second as a timer
 * (not announced); a separate polite region speaks the time left at most once a minute, and
 * another one says when your position moves. Render it without a wrapper: sticky needs the
 * page, not a wrapper of its own height, as its containing block.
 */
export function YourPanel({ d, clock, className }: { d: TournamentView; clock: TournamentClock; className?: string }) {
  const t = d.tournament;
  const you = d.you;
  const ranks = d.standings.map((s) => s.rank);
  const position = you ? rankLabel(you.rank, ranks) : '—';

  const [rankMsg, setRankMsg] = useState('');
  const prev = useRef<number | null>(you?.rank ?? null);
  useEffect(() => {
    const next = you?.rank ?? null;
    const text = rankChangeText(prev.current, next, position.startsWith('='));
    if (text) setRankMsg(text);
    prev.current = next;
  }, [you?.rank, position]);

  const timeLabel = clock.phase === 'upcoming' ? 'Starts in' : 'Time left';
  const time = clock.ms !== null ? formatCountdown(clock.ms) : clock.phase === 'settling' ? '00:00' : '—';
  const pending = you ? pendingText(you.pending_bets) : null;
  const final = clock.phase === 'finished';

  return (
    <section aria-label="Your tournament"
      className={cx('sticky top-[72px] z-20 -mx-5 border-b border-line bg-bg/95 px-5 py-3 backdrop-blur lg:top-[92px] lg:mx-0 lg:rounded-[12px] lg:border lg:border-line-strong/60 lg:bg-surface/95 lg:px-6 lg:py-4', className)}>
      <dl className="grid grid-cols-[1fr_1.25fr_0.8fr_0.8fr_1.2fr] gap-2 lg:gap-6">
        <Stat label="Position" short="Pos.">
          {position}<span className="ml-1 text-[11px] font-normal text-muted lg:font-sans lg:text-[13px]">/{t.entries}</span>
        </Stat>
        <Stat label="Stack (points)" short="Stack">{you ? pts(you.stack) : '—'}</Stat>
        <Stat label="Bets used" short="Used">{you ? you.bets_used : '—'}</Stat>
        <Stat label="Bets left" short="Left">{you ? you.bets_left : '—'}</Stat>
        <Stat label={timeLabel} className="text-right lg:text-left">
          <span role="timer" aria-label={`${timeLabel} ${time}`} className={cx(clock.phase === 'running' && (clock.ms ?? 0) < 60_000 && 'text-warn')}>{time}</span>
        </Stat>
      </dl>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink/85 lg:text-[13px]">
        {you ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cx('h-1.5 w-1.5 rounded-full', you.status === 'playing' ? 'bg-accent' : you.status === 'busted' ? 'bg-danger' : 'bg-info')} />
            {final ? 'Final' : ENTRY_STATUS[you.status]}
          </span>
        ) : <span className="text-muted">{t.you?.registered ? 'Registered · your standing appears at the start' : 'You are not in this tournament'}</span>}
        {pending && <span className="text-info">{pending}</span>}
        {you && you.prize_minor > 0 && (
          <span className="text-accent">{final ? 'Prize' : 'Projected prize'} {amountLabel(you.prize_minor, t.currency)}</span>
        )}
      </p>
      <p className="sr-only" aria-live="polite">{clock.phase === 'running' ? countdownAnnouncement(clock.ms) : ''}</p>
      <p className="sr-only" aria-live="polite">{rankMsg}</p>
    </section>
  );
}
