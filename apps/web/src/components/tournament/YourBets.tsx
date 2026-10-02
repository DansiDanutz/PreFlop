import type { TournamentBet } from '@preflop/client';
import { cx, formatOdds } from '@preflop/ui';
import { resolveOption } from '../../lib/bets.ts';
import { useBook, useLobby } from '../../lib/queries.ts';
import { potentialReturn, pts } from '../../lib/tournaments.ts';

const STATUS: Record<TournamentBet['status'], { label: string; cls: string }> = {
  accepted: { label: 'Waiting for the flop', cls: 'text-info' },
  won: { label: 'Won', cls: 'text-accent' },
  lost: { label: 'Lost', cls: 'text-ink/70' },
  void: { label: 'Void · returned', cls: 'text-warn' },
};

/** The bets you placed in this tournament, newest first. */
export function YourBets({ bets }: { bets: readonly TournamentBet[] }) {
  const book = useBook();
  const lobby = useLobby();
  const tableName = (id: string) => lobby.data?.tables.find((t) => t.id === id)?.name ?? id;
  const sorted = [...bets].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return (
    <section aria-labelledby="your-bets" className="rounded-[12px] border border-line-strong/60 bg-surface p-5">
      <h2 id="your-bets" className="text-[17px] font-bold">Your bets</h2>
      {sorted.length === 0 ? <p className="mt-2 text-[13px] text-ink/75">No bets yet. Each bet uses one of your bets, whatever the result.</p> : (
        <ul className="mt-3 divide-y divide-line">
          {sorted.map((b) => {
            const s = STATUS[b.status];
            return (
              <li key={b.id} className="flex items-start gap-3 py-3 text-[13px]">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{resolveOption(book.index, b.selection_id)?.name ?? b.selection_id}</div>
                  <div className="truncate text-ink/70">{b.table_name ?? tableName(b.table_id)} · {pts(b.stake)} at {formatOdds(b.odds_centi)}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={cx('font-semibold', s.cls)}>{s.label}</div>
                  <div className="tabular-nums text-ink/80">
                    {b.payout !== null && b.status !== 'lost' ? `+${pts(b.payout)}` : b.status === 'accepted' ? `to win ${pts(potentialReturn(b.stake, b.odds_centi))}` : '—'}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
