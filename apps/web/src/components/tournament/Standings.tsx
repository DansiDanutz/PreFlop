import type { Tournament, TournamentStanding } from '@preflop/client';
import { cx } from '@preflop/ui';
import { Users } from 'lucide-react';
import { amountLabel } from '../../lib/rooms.ts';
import { ENTRY_STATUS, pendingText, pts, rankLabels } from '../../lib/tournaments.ts';

function RankBadge({ label, rank }: { label: string; rank: number }) {
  return (
    <span className={cx('inline-grid h-8 min-w-8 place-items-center rounded-full px-1.5 text-[13px] font-bold tabular-nums',
      rank <= 3 ? 'border border-accent/45 bg-accent-deep text-accent' : 'text-ink/80')}>{label}</span>
  );
}

const statusTone = (s: TournamentStanding['status']) => (s === 'playing' ? 'text-ink/85' : s === 'busted' ? 'text-danger' : 'text-info');

const You = () => <span className="ml-2 rounded-[4px] border border-accent/45 px-1.5 py-0.5 text-[10px] font-semibold text-accent">YOU</span>;

/** Everyone, best first. A table on wide screens, a compact list on phones; your row is highlighted. */
export function Standings({ t, standings, final }: { t: Pick<Tournament, 'currency' | 'entries'>; standings: TournamentStanding[]; final: boolean }) {
  const labels = rankLabels(standings.map((s) => s.rank));
  const prize = (s: TournamentStanding) => (s.prize_minor > 0 ? <span className="text-accent">{amountLabel(s.prize_minor, t.currency)}</span> : <span className="text-faint">—</span>);
  return (
    <section aria-labelledby="standings" className="overflow-hidden rounded-[12px] border border-line-strong/60 bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
        <h2 id="standings" className="text-[17px] font-bold">{final ? 'Final standings' : 'Standings'}</h2>
        <p className="text-[12px] text-muted">Same stack? Fewer bets used ranks higher.</p>
      </div>
      {standings.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <Users className="mx-auto h-8 w-8 text-accent/70" aria-hidden />
          <p className="mt-3 font-serif text-[20px]">No entrants yet.</p>
          <p className="mt-1 text-[13px] text-ink/75">Register and you are first on the board.</p>
        </div>
      ) : (
        <>
          <table className="hidden w-full text-left text-[14px] md:table">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-[0.12em] text-ink/70">
              <tr>
                <th className="w-16 px-4 py-3 font-semibold">Pos.</th>
                <th className="px-4 py-3 font-semibold">Player</th>
                <th className="px-4 py-3 text-right font-semibold">Stack (points)</th>
                <th className="px-4 py-3 text-right font-semibold">Bets used</th>
                <th className="px-4 py-3 text-right font-semibold">Bets left</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">{final ? 'Prize' : 'Projected prize'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {standings.map((s, i) => (
                <tr key={`${s.rank}-${s.display_name}-${i}`} className={cx(s.you && 'bg-accent-deep/40')} aria-current={s.you ? 'true' : undefined}>
                  <td className="px-4 py-2.5"><RankBadge label={labels[i]!} rank={s.rank} /></td>
                  <td className="px-4 py-2.5">{s.display_name}{s.you && <You />}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums">{pts(s.stack)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink/80">{s.bets_used}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink/80">{s.bets_left}</td>
                  <td className={cx('px-4 py-2.5 text-[13px]', statusTone(s.status))}>
                    {ENTRY_STATUS[s.status]}
                    {s.pending_bets > 0 && <span className="block text-[12px] text-info">{pendingText(s.pending_bets)}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{prize(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div aria-hidden className="flex justify-between bg-surface-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/70 md:hidden">
            <span>Pos. · Player</span><span>Stack (points)</span>
          </div>
          <ol aria-label="Standings" className="divide-y divide-line md:hidden">
            {standings.map((s, i) => (
              <li key={`${s.rank}-${s.display_name}-${i}`} className={cx('flex items-center gap-3 px-4 py-3', s.you && 'bg-accent-deep/40')} aria-current={s.you ? 'true' : undefined}>
                <RankBadge label={labels[i]!} rank={s.rank} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center truncate text-[14px] font-semibold">{s.display_name}{s.you && <You />}</div>
                  <div className={cx('truncate text-[12px]', statusTone(s.status))}>
                    {s.bets_used} used · {s.bets_left} left · {ENTRY_STATUS[s.status]}
                    {s.pending_bets > 0 && <span className="text-info"> · {s.pending_bets} pending</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[15px] font-bold tabular-nums">{pts(s.stack)}<span className="sr-only"> points</span></div>
                  <div className="text-[12px] tabular-nums">{prize(s)}</div>
                </div>
              </li>
            ))}
          </ol>
          {t.entries > standings.length && <p className="border-t border-line px-5 py-3 text-[12px] text-muted">Showing the top {standings.length} of {t.entries}.</p>}
        </>
      )}
    </section>
  );
}
