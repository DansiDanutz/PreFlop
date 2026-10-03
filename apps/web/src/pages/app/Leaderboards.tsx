import type { Leaderboard, LeaderboardEntry, LeaderboardMetric, PlayMode } from '@preflop/client';
import { ChipIcon, EmptyState, cx, formatMoney, formatMoneyShort } from '@preflop/ui';
import { useQuery } from '@tanstack/react-query';
import { Award, ChevronLeft, ChevronRight, Crown, Medal, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { PageHeader } from '../../components/AppShell.tsx';
import { ErrorState, Notice, Skeleton, Tabs } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';

type Tab = 'play' | 'diamonds' | 'virtual-chips' | 'real';

export const METRIC: Record<LeaderboardMetric, { label: string; how: string }> = {
  net: { label: 'Net result', how: 'Chips returned minus chips used. The best result wins.' },
  volume: { label: 'Volume', how: 'Total chips used in predictions. This rewards activity; take breaks.' },
  roi: { label: 'Return per chip', how: 'Chips returned for every chip used, after a minimum number of rounds.' },
  points: { label: 'Points', how: 'Each correct prediction scores its odds × 10, so rarer calls score more.' },
};

export function money(minor: number, currency: string) {
  return formatMoney(minor, currency);
}

export function scoreText(metric: LeaderboardMetric, score: number, currency: string) {
  if (metric === 'roi') return `${score.toFixed(2)}×`;
  if (metric === 'points') return `${Math.round(score).toLocaleString('en-US')} pts`;
  const sign = metric === 'net' && score > 0 ? '+' : '';
  return sign + formatMoneyShort(score, currency);
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function StatusPill({ lb }: { lb: Leaderboard }) {
  const live = lb.status === 'active';
  const label = live ? 'Live' : lb.status === 'scheduled' ? `Starts ${when(lb.starts_at)}` : lb.status === 'settled' ? 'Final' : 'Cancelled';
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-0.5 text-[11px] font-semibold tracking-[0.06em]',
      live ? 'border-accent/45 bg-accent-deep text-accent' : 'border-line-strong text-ink/75')}>
      {live && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}{label.toUpperCase()}
    </span>
  );
}

function PoolIcon({ currency }: { currency: string }) {
  return currency === 'DIAMOND'
    ? <span aria-hidden className="grid h-11 w-11 place-items-center rounded-full border border-info/40 bg-info/10 text-xl text-info">◆</span>
    : <span className="grid h-11 w-11 place-items-center rounded-full border border-accent/40 bg-accent-deep"><ChipIcon size={28} /></span>;
}

function BoardCard({ lb }: { lb: Leaderboard }) {
  return (
    <Link to={`/app/leaderboards/${lb.id}`} className="group flex flex-col rounded-[12px] border border-line-strong/60 bg-surface p-5 hover:border-line-strong">
      <div className="flex items-center justify-between gap-3">
        <StatusPill lb={lb} />
        <span className="text-[12px] text-muted">{lb.owner_name}</span>
      </div>
      <h3 className="mt-4 font-serif text-[22px] leading-tight tracking-[-0.03em]">{lb.name}</h3>
      <p className="mt-1.5 text-[13px] text-ink/75">{METRIC[lb.metric].label} · {lb.prize_split_bps.length} {lb.prize_split_bps.length === 1 ? 'prize' : 'prizes'}</p>
      <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
        <PoolIcon currency={lb.currency} />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-ink/75">{lb.status === 'settled' ? 'Paid out' : 'Prize pool'}</div>
          <div className="font-serif text-[24px] leading-tight tabular-nums">{formatMoney(lb.pool_minor, lb.currency)}</div>
        </div>
        <ChevronRight className="h-5 w-5 text-muted group-hover:text-ink" aria-hidden />
      </div>
      <p className="mt-3 text-[12px] text-muted">{lb.status === 'settled' ? `Ended ${when(lb.ends_at)}` : `Ends ${when(lb.ends_at)}`}</p>
    </Link>
  );
}

export function LeaderboardsPage() {
  const [tab, setTab] = useState<Tab>('play');
  const mode: PlayMode | undefined = tab === 'real' ? undefined : tab;
  const q = useQuery({ queryKey: ['leaderboards', tab], queryFn: () => api.leaderboards(mode), enabled: tab !== 'real', refetchInterval: 30_000 });
  const badges = useQuery({ queryKey: ['me', 'badges'], queryFn: () => api.myBadges() });
  return (
    <div>
      <PageHeader eyebrow="Every flop counts" title="Leaderboards." subtitle="Read the flop better than the rest of the room. Free-chip boards pay free chips and badges." />
      {(badges.data?.badges.length ?? 0) > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {badges.data!.badges.slice(0, 6).map((b) => (
            <span key={b.id} className="inline-flex items-center gap-1.5 rounded-[6px] border border-accent/45 bg-accent-deep px-2.5 py-1 text-[12px] text-accent">
              {b.kind === 'champion' ? <Crown className="h-3.5 w-3.5" aria-hidden /> : b.kind === 'podium' ? <Medal className="h-3.5 w-3.5" aria-hidden /> : <Award className="h-3.5 w-3.5" aria-hidden />}{b.label}
            </span>
          ))}
        </div>
      )}
      <Tabs className="mt-7 flex-wrap" label="Currency" value={tab} onChange={setTab} options={[
        { id: 'play', label: 'Free chips' }, { id: 'diamonds', label: 'Diamonds' }, { id: 'virtual-chips', label: 'Chips' }, { id: 'real', label: 'Real money' },
      ]} />
      <div className="mt-6 border-t border-line pt-6">
        {tab === 'real' ? (
          <Notice tone="info">Real-money leaderboards open when real money is switched on in your country. Until then, everything here is free to play.</Notice>
        ) : q.isError ? <ErrorState title="Could not load leaderboards" onRetry={() => void q.refetch()} /> : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 xl:grid-cols-3 [&>li]:min-w-0">
            {q.isLoading && [0, 1, 2].map((i) => <li key={i}><Skeleton className="h-[250px]" /></li>)}
            {q.data?.leaderboards.map((lb) => <li key={lb.id} className="flex [&>a]:w-full"><BoardCard lb={lb} /></li>)}
          </ul>
        )}
        {q.data && q.data.leaderboards.length === 0 && tab !== 'real' && (
          <EmptyState title="No leaderboards right now">New boards open every week. Clubs and organizers run their own in chips and diamonds.</EmptyState>
        )}
      </div>
    </div>
  );
}

function RankCell({ e }: { e: LeaderboardEntry }) {
  if (!e.rank) return <span className="text-faint">—</span>;
  const top = e.rank <= 3;
  return <span className={cx('inline-grid h-8 w-8 place-items-center rounded-full text-[13px] font-bold', top ? 'border border-accent/45 bg-accent-deep text-accent' : 'text-ink/80')}>{e.rank}</span>;
}

export function LeaderboardPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['leaderboard', id], queryFn: () => api.leaderboard(id), refetchInterval: 15_000 });
  const back = <Link to="/app/leaderboards" className="inline-flex items-center gap-1.5 text-[14px] text-ink/85 hover:text-ink"><ChevronLeft className="h-4 w-4" aria-hidden /> All leaderboards</Link>;
  if (q.isError) return <div className="space-y-6">{back}<ErrorState title="Could not load this leaderboard" onRetry={() => void q.refetch()} /></div>;
  const d = q.data;
  const lb = d?.leaderboard;
  return (
    <div>
      {back}
      {!lb ? <Skeleton className="mt-8 h-40" /> : (
        <>
          <header className="mt-6 flex flex-col gap-6 border-b border-line pb-8 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3"><StatusPill lb={lb} /><span className="text-[13px] text-muted">{lb.owner_name}</span></div>
              <h1 className="mt-4 font-serif text-[36px] leading-[1.1] tracking-[-0.045em] lg:text-[44px]">{lb.name}</h1>
              <p className="mt-2 max-w-2xl text-[15px] text-ink/80">{METRIC[lb.metric].how} {lb.min_rounds > 1 && `Qualify with ${lb.min_rounds} rounds.`}</p>
              <p className="mt-1 text-[13px] text-muted">{when(lb.starts_at)} – {when(lb.ends_at)}</p>
            </div>
            <div className="flex items-center gap-4 rounded-[12px] border border-line-strong/60 bg-surface px-6 py-5">
              <PoolIcon currency={lb.currency} />
              <div>
                <div className="text-[12px] text-ink/75">{lb.status === 'settled' ? 'Paid out' : 'Prize pool'}</div>
                <div className="font-serif text-[34px] leading-none tabular-nums">{formatMoney(lb.pool_minor, lb.currency)}</div>
                <div className="mt-1 text-[12px] text-muted">{lb.currency === 'PLAY' ? 'Free chips. No cash value.' : lb.currency === 'DIAMOND' || lb.currency === 'CHIP' ? 'No cash value.' : 'Real money'}</div>
              </div>
            </div>
          </header>

          <div className="mt-8 grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section aria-label="Standings" className="overflow-hidden rounded-[12px] border border-line-strong/60 bg-surface">
              {d!.standings.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <Trophy className="mx-auto h-8 w-8 text-accent/70" aria-hidden />
                  <p className="mt-3 font-serif text-[22px]">The board is waiting for its first flop.</p>
                  <p className="mt-2 text-[14px] text-ink/75">Predict at any table in scope and you appear here.</p>
                  <Link to="/app" className="mt-5 inline-flex h-11 items-center rounded-[8px] bg-accent px-5 text-[15px] font-bold text-accent-ink hover:bg-accent-strong">Find a table</Link>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-[14px]">
                    <thead className="bg-surface-2 text-[11px] uppercase tracking-[0.12em] text-ink/70">
                      <tr><th className="w-16 px-4 py-3 font-semibold">Rank</th><th className="px-4 py-3 font-semibold">Player</th><th className="px-4 py-3 text-right font-semibold">{METRIC[lb.metric].label}</th><th className="px-4 py-3 text-right font-semibold">Rounds</th><th className="px-4 py-3 text-right font-semibold">Prize</th></tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {d!.standings.map((e, i) => (
                        <tr key={i} className={cx(e.you && 'bg-accent-deep/40', !e.qualified && 'text-ink/60')}>
                          <td className="px-4 py-2.5"><RankCell e={e} /></td>
                          <td className="px-4 py-2.5">{e.display_name}{e.you && <span className="ml-2 rounded-[4px] border border-accent/45 px-1.5 py-0.5 text-[10px] font-semibold text-accent">YOU</span>}{!e.qualified && <span className="ml-2 text-[12px] text-muted">qualifying</span>}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{scoreText(lb.metric, e.score, lb.currency)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-ink/75">{e.rounds}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{e.prize_minor > 0 ? <span className="text-accent">{formatMoney(e.prize_minor, lb.currency)}</span> : <span className="text-faint">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <aside className="space-y-5">
              <div className="rounded-[12px] border border-line-strong/60 bg-surface p-5">
                <h2 className="text-[17px] font-bold">Your place</h2>
                {d!.you ? (
                  <div className="mt-3">
                    <div className="font-serif text-[40px] leading-none">{d!.you.rank ? `#${d!.you.rank}` : '—'}</div>
                    <p className="mt-2 text-[13px] text-ink/80">{d!.you.qualified ? scoreText(lb.metric, d!.you.score, lb.currency) : `${d!.you.rounds} of ${lb.min_rounds} rounds to qualify`}</p>
                    {d!.you.prize_minor > 0 && <p className="mt-1 text-[13px] text-accent">{lb.status === 'settled' ? 'Won' : 'On course for'} {money(d!.you.prize_minor, lb.currency)}</p>}
                  </div>
                ) : <p className="mt-2 text-[13px] text-ink/75">Not on the board yet. Your predictions in scope count automatically.</p>}
              </div>
              <div className="rounded-[12px] border border-line-strong/60 bg-surface p-5">
                <h2 className="text-[17px] font-bold">Prizes</h2>
                <ul className="mt-3 divide-y divide-line text-[14px]">
                  {lb.prize_split_bps.map((bps, i) => (
                    <li key={i} className="flex justify-between py-2"><span className="text-ink/80">{i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`}</span><span className="tabular-nums">{(bps / 100).toFixed(bps % 100 ? 1 : 0)}% · {money(Math.floor((lb.pool_minor * bps) / 10_000), lb.currency)}</span></li>
                  ))}
                </ul>
                <p className="mt-3 text-[12px] text-muted">The pool grows while the board is live. Top 3 earn a podium badge, the top 10 a top-10 badge.</p>
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
