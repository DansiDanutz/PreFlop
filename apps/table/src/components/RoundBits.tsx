import { Badge, Flop, cx } from '@preflop/ui';
import type { Round, RoundState } from '../lib/types.ts';

const STATE_TONE: Record<RoundState, 'accent' | 'muted' | 'info' | 'warn' | 'danger'> = {
  OPEN: 'accent', LOCKED: 'info', DEALT: 'info', REVIEW: 'warn', EVIDENCE_REJECTED: 'danger', SETTLED: 'muted', VOID: 'danger',
};
const STATE_LABEL: Record<RoundState, string> = {
  OPEN: 'Bets open', LOCKED: 'Locked', DEALT: 'Dealt', REVIEW: 'In review', EVIDENCE_REJECTED: 'Evidence rejected', SETTLED: 'Settled', VOID: 'Void',
};
const STEP_LABEL: Record<string, string> = {
  open: 'open', locked: 'locked', shuffle_commanded: 'shuffling', shuffled: 'shuffled', cut_instructed: 'cut', cut: 'cut done', dealing: 'dealing',
};

export function StateBadge({ r }: { r: Round }) {
  const sub = r.state === 'LOCKED' ? ` · ${STEP_LABEL[r.step] ?? r.step}` : '';
  return <Badge tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}{sub}</Badge>;
}

/**
 * Last three hands. `showFlop` decides per round whether its flop may be shown (the floor must
 * not see anything about a hand it has not confirmed yet).
 */
export function Timeline({ rounds, showFlop, highlight }: { rounds: Round[]; showFlop: (r: Round) => boolean; highlight?: string | undefined }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-faint">Recent hands</div>
      {rounds.map((r) => (
        <div key={r.id} className={cx('rounded-[16px] border bg-surface px-4 py-3', r.id === highlight ? 'border-accent/60' : 'border-line')}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-serif text-xl">Hand {r.hand_no}</span>
            <StateBadge r={r} />
          </div>
          {(r.state === 'SETTLED' || r.state === 'VOID') && (
            <div className="mt-3 flex items-center justify-start">
              {r.state === 'SETTLED' && showFlop(r) ? <Flop cards={r.flop} size="sm" className="justify-start" /> : <span className="text-sm text-muted">{r.state === 'VOID' ? 'Voided · all bets refunded' : 'Flop hidden'}</span>}
            </div>
          )}
        </div>
      ))}
      {rounds.length === 0 && <div className="text-sm text-muted">No hands yet.</div>}
    </div>
  );
}
