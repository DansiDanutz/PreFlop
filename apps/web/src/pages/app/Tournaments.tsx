import type { PlayMode, Tournament } from '@preflop/client';
import { Badge, ChipIcon, EmptyState, cx } from '@preflop/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Crown, Medal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router';
import { PageHeader } from '../../components/AppShell.tsx';
import { BetPanel } from '../../components/tournament/BetPanel.tsx';
import { RegisterControls } from '../../components/tournament/Registration.tsx';
import { Standings } from '../../components/tournament/Standings.tsx';
import { YourBets } from '../../components/tournament/YourBets.tsx';
import { YourPanel } from '../../components/tournament/YourPanel.tsx';
import { ErrorState, Notice, Skeleton, Tabs } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { amountLabel } from '../../lib/rooms.ts';
import {
  type LobbyTab, type TournamentClock, buyInText, durationText, modeLabel, ordinal, points, prizeNote, pts, rankLabel, tournamentClock, tournamentErrorText,
} from '../../lib/tournaments.ts';
import { type TournamentView, useServerNow, useTournament } from '../../lib/useTournament.ts';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function ModeBadge({ mode }: { mode: PlayMode }) {
  const tone = mode === 'diamonds' ? 'info' : mode === 'play' || mode === 'virtual-chips' ? 'accent' : 'warn';
  return <Badge tone={tone} className="py-0.5 tracking-[0.06em]">{modeLabel(mode)}</Badge>;
}

/** Live/upcoming/final pill with the countdown. The text ticks; it is not a live region. */
function ClockPill({ clock }: { clock: TournamentClock }) {
  const live = clock.phase === 'running';
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-0.5 text-[11px] font-semibold tabular-nums tracking-[0.06em]',
      live ? 'border-accent/45 bg-accent-deep text-accent' : clock.phase === 'cancelled' ? 'border-danger/45 text-danger' : 'border-line-strong text-ink/75')}>
      {live && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}{clock.text.toUpperCase()}
    </span>
  );
}

function PoolIcon({ currency }: { currency: string }) {
  return currency === 'DIAMOND'
    ? <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-info/40 bg-info/10 text-xl text-info">◆</span>
    : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-accent/40 bg-accent-deep"><ChipIcon size={28} /></span>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink/70">{label}</dt>
      <dd className="truncate text-[14px] font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

const entriesText = (t: Tournament) => `${t.entries}${t.max_entries !== null ? ` / ${t.max_entries}` : ''}`;

function TournamentCard({ t, now }: { t: Tournament; now: number }) {
  const clock = tournamentClock(t, now);
  return (
    <article className="flex h-full flex-col rounded-[12px] border border-line-strong/60 bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <ClockPill clock={clock} />
        <ModeBadge mode={t.mode} />
      </div>
      <h3 className="mt-4 font-serif text-[22px] leading-tight tracking-[-0.03em]">
        <Link to={`/app/tournaments/${t.id}`} className="hover:text-accent">{t.name}</Link>
      </h3>
      <p className="mt-1 text-[12px] text-muted">{t.owner_name} · {when(t.starts_at)} · {durationText(t.duration_minutes)}</p>
      <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
        <PoolIcon currency={t.currency} />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-ink/75">{t.status === 'completed' ? 'Paid out' : 'Prize pool'}</div>
          <div className="truncate font-serif text-[22px] leading-tight tabular-nums">{amountLabel(t.prize_pool_minor, t.currency)}</div>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Buy-in">{buyInText(t)}</Fact>
        <Fact label="Entries">{entriesText(t)}</Fact>
        <Fact label="Starting stack">{points(t.starting_stack)}</Fact>
        <Fact label="Bets allowed">{t.bets_allowed}</Fact>
      </dl>
      <p className="mt-3 text-[12px] text-muted">{prizeNote(t.currency)}</p>
      <div className="min-h-3 flex-1" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <RegisterControls t={t} compact />
        <Link to={`/app/tournaments/${t.id}`} aria-label={`Open ${t.name}`} className="ml-auto inline-flex items-center gap-1 text-[14px] text-accent hover:underline">
          {clock.phase === 'running' ? 'Standings' : clock.phase === 'finished' ? 'Results' : 'Details'} <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </article>
  );
}

export function TournamentsPage() {
  const [tab, setTab] = useState<LobbyTab>('running');
  const q = useQuery({ queryKey: ['tournaments', tab], queryFn: () => api.tournaments(tab), refetchInterval: tab === 'finished' ? false : 30_000 });
  // The list carries no server_time, so lobby countdowns use the device clock; the dashboard does not.
  const now = useServerNow(0);
  return (
    <div>
      <PageHeader eyebrow="Same stack. Same bets." title="Tournaments." subtitle="Everyone starts equal. The biggest stack when the clock runs out wins." />
      <Tabs className="mt-7 flex-wrap" label="Tournaments" value={tab} onChange={setTab} options={[
        { id: 'upcoming', label: 'Upcoming' }, { id: 'running', label: 'Running' }, { id: 'finished', label: 'Finished' },
      ]} />
      <div className="mt-6 border-t border-line pt-6">
        {q.isError ? <ErrorState title="Could not load tournaments" onRetry={() => void q.refetch()}>{tournamentErrorText(q.error)}</ErrorState> : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 xl:grid-cols-3 [&>li]:min-w-0">
            {q.isLoading && [0, 1, 2].map((i) => <li key={i}><Skeleton className="h-[380px]" /></li>)}
            {q.data?.tournaments.map((t) => <li key={t.id}><TournamentCard t={t} now={now} /></li>)}
          </ul>
        )}
        {q.data && q.data.tournaments.length === 0 && (
          <EmptyState title={tab === 'running' ? 'Nothing running right now' : tab === 'upcoming' ? 'No tournaments scheduled' : 'No finished tournaments yet'}>
            {tab === 'finished' ? 'Results appear here when a tournament ends.' : 'New tournaments are announced here. Freerolls cost nothing to enter.'}
          </EmptyState>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ dashboard

function Results({ d }: { d: TournamentView }) {
  const t = d.tournament;
  const you = d.you;
  const ranks = d.standings.map((s) => s.rank);
  const podium = d.standings.filter((s) => s.rank <= 3);
  return (
    <section aria-labelledby="results" className="rounded-[12px] border border-accent/40 bg-gradient-to-br from-accent-deep/50 to-surface p-5 lg:p-6">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Final results</p>
      <h2 id="results" className="mt-2 font-serif text-[26px] leading-tight tracking-[-0.03em]">
        {you ? `You finished ${rankLabel(you.rank, ranks).startsWith('=') ? 'joint ' : ''}${ordinal(you.rank)}.` : 'The clock has run out.'}
      </h2>
      {you && (
        <p className="mt-2 text-[14px] text-ink/85">
          Final stack {points(you.stack)} after {you.bets_used} {you.bets_used === 1 ? 'bet' : 'bets'}.
          {you.prize_minor > 0 ? ` You won ${amountLabel(you.prize_minor, t.currency)}, paid to your wallet.` : ' No prize this time.'}
          {you.rank === 1 ? ' A champion badge is on your profile.' : you.rank <= 3 ? ' A podium badge is on your profile.' : ''}
        </p>
      )}
      {podium.length > 0 && (
        <ol className="mt-4 grid gap-2 sm:grid-cols-3">
          {podium.map((s, i) => (
            <li key={i} className={cx('flex items-center gap-3 rounded-[10px] border px-3 py-2.5', s.you ? 'border-accent/60 bg-accent-deep/40' : 'border-line-strong/60 bg-surface')}>
              {s.rank === 1 ? <Crown className="h-5 w-5 shrink-0 text-accent" aria-hidden /> : <Medal className="h-5 w-5 shrink-0 text-accent/80" aria-hidden />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold">{rankLabel(s.rank, ranks)} · {s.display_name}</div>
                <div className="truncate text-[12px] text-ink/75">{pts(s.stack)} pts{s.prize_minor > 0 ? ` · ${amountLabel(s.prize_minor, t.currency)}` : ''}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** What the player can do now when the bet panel is not shown. */
function NoBetCard({ d, clock }: { d: TournamentView; clock: TournamentClock }) {
  const t = d.tournament;
  const you = d.you;
  let title: string;
  let body: string;
  if (clock.phase === 'upcoming') {
    title = t.you?.registered ? 'You are registered.' : 'Betting opens at the start.';
    body = `Every entrant starts with ${points(t.starting_stack)} and ${t.bets_allowed} bets, at ${pts(t.min_stake)}${t.max_stake !== null ? `–${pts(t.max_stake)}` : ' points or more'} per bet.`;
  } else if (clock.phase === 'settling') {
    title = 'The clock has run out.';
    body = 'No new bets. Bets already placed settle with their flop, then the final standings are paid.';
  } else if (you?.status === 'busted') {
    title = 'Out — stack lost.';
    body = 'Your stack is below the minimum stake, so you cannot bet again. Your position stands until the end.';
  } else if (you?.status === 'finished') {
    title = 'All bets used — final stack.';
    body = 'Your stack is final. Watch the standings until the clock runs out.';
  } else if (you && you.bets_left === 0) {
    title = 'All bets placed.';
    body = 'Your last bets are waiting for their flops.';
  } else {
    title = t.registration_open ? 'Join while late registration is open.' : 'You are watching.';
    body = t.registration_open ? `Late entrants get the full stack and every bet. Registration closes at ${time(t.late_reg_until)}.` : 'Registration is closed. Follow the standings live.';
  }
  return (
    <div className="rounded-[12px] border border-line-strong/60 bg-surface p-5">
      <h2 className="font-serif text-[22px] leading-tight tracking-[-0.03em]">{title}</h2>
      <p className="mt-2 text-[14px] text-ink/80">{body}</p>
    </div>
  );
}

function PrizesCard({ t }: { t: Tournament }) {
  return (
    <div className="rounded-[12px] border border-line-strong/60 bg-surface p-5">
      <h2 className="text-[17px] font-bold">Prizes</h2>
      <ul className="mt-3 divide-y divide-line text-[14px]">
        {t.payout_bps.map((bps, i) => (
          <li key={i} className="flex justify-between gap-3 py-2">
            <span className="text-ink/80">{ordinal(i + 1)}</span>
            <span className="tabular-nums">{(bps / 100).toFixed(bps % 100 ? 1 : 0)}% · {amountLabel(Math.floor((t.prize_pool_minor * bps) / 10_000), t.currency)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-muted">{prizeNote(t.currency)} Tied players share their places’ prizes. The top three earn badges.</p>
    </div>
  );
}

function RulesCard() {
  const rules = [
    'Each bet uses one of your bets, whatever the result, and takes the stake off your stack.',
    'A winning bet pays stake × odds back to your stack. A voided flop returns the stake and the bet.',
    'One bet per flop. Pick any live table.',
    'Biggest stack when the clock runs out wins. Same stack? Fewer bets used ranks higher.',
  ];
  return (
    <div className="rounded-[12px] border border-line-strong/60 bg-surface p-5">
      <h2 className="text-[17px] font-bold">How it works</h2>
      <ul className="mt-3 space-y-2 text-[13px] text-ink/80">
        {rules.map((r) => <li key={r} className="flex gap-2"><span aria-hidden className="text-accent">•</span><span>{r}</span></li>)}
      </ul>
    </div>
  );
}

export function TournamentPage() {
  const { id = '' } = useParams();
  const q = useTournament(id);
  const now = useServerNow(q.data?.offset ?? 0);
  const back = <Link to="/app/tournaments" className="inline-flex items-center gap-1.5 text-[14px] text-ink/85 hover:text-ink"><ChevronLeft className="h-4 w-4" aria-hidden /> All tournaments</Link>;
  if (q.isError) return <div className="space-y-6">{back}<ErrorState title="Could not load this tournament" onRetry={() => void q.refetch()}>{tournamentErrorText(q.error)}</ErrorState></div>;
  const d = q.data;
  if (!d) return <div>{back}<Skeleton className="mt-8 h-40" /><Skeleton className="mt-6 h-64" /></div>;

  const t = d.tournament;
  const clock = tournamentClock(t, now);
  const entered = !!d.you || !!t.you?.registered;
  const canBet = clock.phase === 'running' && d.you?.status === 'playing' && d.you.bets_left > 0 && d.you.stack >= t.min_stake;
  const final = clock.phase === 'finished';

  return (
    <div>
      {back}
      <header className="mt-6 flex flex-col gap-6 border-b border-line pb-8 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3"><ClockPill clock={clock} /><ModeBadge mode={t.mode} /><span className="text-[13px] text-muted">{t.owner_name}</span></div>
          <h1 className="mt-4 font-serif text-[34px] leading-[1.1] tracking-[-0.045em] lg:text-[44px]">{t.name}</h1>
          {t.description && <p className="mt-2 max-w-2xl text-[15px] text-ink/80">{t.description}</p>}
          <dl className="mt-4 grid max-w-2xl grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Fact label="Buy-in">{buyInText(t)}</Fact>
            <Fact label="Entries">{entriesText(t)}</Fact>
            <Fact label="Starting stack">{points(t.starting_stack)}</Fact>
            <Fact label="Bets">{t.bets_allowed}</Fact>
            <Fact label="Starts">{when(t.starts_at)}</Fact>
            <Fact label="Duration">{durationText(t.duration_minutes)}</Fact>
            <Fact label="Stake per bet">{pts(t.min_stake)}{t.max_stake !== null ? `–${pts(t.max_stake)}` : '+'} pts</Fact>
            <Fact label="Ends">{time(t.ends_at)}</Fact>
          </dl>
          {clock.phase !== 'cancelled' && !final && <RegisterControls t={t} className="mt-5" />}
          {clock.phase === 'running' && t.registration_open && !entered && <p className="mt-2 text-[12px] text-muted">Late registration until {time(t.late_reg_until)}.</p>}
        </div>
        <div className="flex items-center gap-4 rounded-[12px] border border-line-strong/60 bg-surface px-6 py-5">
          <PoolIcon currency={t.currency} />
          <div className="min-w-0">
            <div className="text-[12px] text-ink/75">{final ? 'Paid out' : 'Prize pool'}</div>
            <div className="font-serif text-[32px] leading-none tabular-nums">{amountLabel(t.prize_pool_minor, t.currency)}</div>
            <div className="mt-1 text-[12px] text-muted">{prizeNote(t.currency)}</div>
          </div>
        </div>
      </header>

      {clock.phase === 'cancelled' ? (
        <Notice tone="warn" className="mt-6">
          <strong>Cancelled.</strong> {t.cancel_reason ?? 'The tournament did not go ahead.'} Every buy-in was refunded in full.
        </Notice>
      ) : (
        <>
          {entered && !final && <YourPanel d={d} clock={clock} className="mt-6" />}
          {final && <div className="mt-6"><Results d={d} /></div>}
          {/* Phones: bet, standings, then the rest. Wide: standings left, everything else stacked right. */}
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[auto_1fr] lg:gap-x-6 xl:grid-cols-[minmax(0,1fr)_440px]">
            {!final && (
              <div className="min-w-0 lg:col-start-2 lg:row-start-1">
                {canBet ? <BetPanel d={d} /> : <NoBetCard d={d} clock={clock} />}
              </div>
            )}
            <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
              <Standings t={t} standings={d.standings} final={final} />
            </div>
            <aside className={cx('min-w-0 space-y-5 lg:col-start-2', final ? 'lg:row-span-2 lg:row-start-1' : 'lg:row-start-2')}>
              {d.you && <YourBets bets={d.you.bets} />}
              <PrizesCard t={t} />
              <RulesCard />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
