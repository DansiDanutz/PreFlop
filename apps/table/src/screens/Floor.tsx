import { Flop, Spinner, cx } from '@preflop/ui';
import { CheckCircle2, EyeOff, Scale, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { ActionStatus } from '../components/controls.tsx';
import { FlopEntry } from '../components/FlopEntry.tsx';
import { StateBadge, Timeline } from '../components/RoundBits.tsx';
import { prettyFlop, sameFlop } from '../lib/cards.ts';
import { type Live, type Runner, myEntry, pendingEntry } from '../lib/hooks.ts';
import type { Round } from '../lib/types.ts';
import { Stage } from './Dealer.tsx';

/**
 * Independent floor confirmation. Before this tablet has submitted for a hand it shows NOTHING
 * about that hand's cards: not the dealer's entry, not the camera reading, not the flop. The
 * state payload still carries the dealer entry; it is deliberately never rendered here.
 */
export function FloorScreen({ live, mem, runner, submitFlop, banner }: {
  live: Live; mem: Record<string, string[]>; runner: Runner; submitFlop: (r: Round, cards: string[]) => void; banner?: ReactNode;
}) {
  const s = live.state;
  if (!s) return <Stage title={<Spinner className="h-10 w-10" />} eyebrow="Connecting" />;
  const pending = pendingEntry(s, 'floor', mem);
  const busy = !!runner.pending;
  const latest = s.rounds[0];
  const mineRound = s.rounds.find((r) => myEntry(r, mem));
  let main: ReactNode;

  if (pending) {
    main = (
      <FlopEntry resetKey={pending.id} busy={busy} tone="accent" onSubmit={(cards) => submitFlop(pending, cards)} submitLabel="Confirm flop"
        title={<>Confirm the flop · Hand {pending.hand_no}</>}
        subtitle="Enter the three cards you see. The dealer's entry stays hidden."
        aside={<span className="hidden items-center gap-2 rounded-full border border-line-strong px-3 py-1.5 text-sm text-muted xl:inline-flex"><EyeOff className="h-4 w-4" /> Blind entry</span>} />
    );
  } else if (mineRound) {
    const r = mineRound;
    const mine = myEntry(r, mem) ?? [];
    if (r.state === 'SETTLED') {
      const match = sameFlop(mine, r.flop);
      main = (
        <Stage testid="floor-result" eyebrow={`Hand ${r.hand_no} · settled`} title={match ? <span className="inline-flex items-center gap-4 text-accent"><CheckCircle2 className="h-12 w-12" /> Match</span> : mine.length ? <span className="inline-flex items-center gap-4 text-warn"><Scale className="h-12 w-12" /> Settled by review</span> : 'Settled'}>
          <Flop cards={r.flop} size="lg" />
          {!match && mine.length > 0 && <p className="text-xl text-muted">Your entry was <b className="font-mono text-ink">{prettyFlop(mine)}</b>. The floor manager settled the hand from the camera evidence.</p>}
          {match && <p className="text-xl text-muted">Your confirmation, the dealer entry and the board camera agree.</p>}
        </Stage>
      );
    } else if (r.state === 'VOID') {
      main = <Stage testid="floor-result" eyebrow={`Hand ${r.hand_no}`} title={<span className="inline-flex items-center gap-4 text-danger"><XCircle className="h-12 w-12" /> Hand voided</span>}><p className="text-xl text-muted">All bets on this flop are refunded.</p></Stage>;
    } else {
      main = (
        <Stage testid="floor-waiting" eyebrow={`Hand ${r.hand_no}`} title={r.state === 'REVIEW' ? 'Entries differ — in review' : mine.length ? 'Confirmation recorded' : 'Already recorded'}>
          {mine.length > 0 && <Flop cards={mine} size="lg" />}
          <p className="max-w-xl text-xl text-muted">{r.state === 'REVIEW' ? 'The floor manager decides from the camera evidence.' : 'Waiting for the dealer entry and the board camera. The match appears here when the hand settles.'}</p>
          <StateBadge r={r} />
        </Stage>
      );
    }
  } else if (latest) {
    main = (
      <Stage testid="floor-idle" eyebrow={`Hand ${latest.hand_no}`} title={latest.state === 'OPEN' ? 'Bets open — waiting for the dealer' : latest.state === 'LOCKED' ? 'Hand in progress' : 'Waiting'}>
        <p className="max-w-xl text-xl text-muted">The card picker appears here as soon as the dealer starts dealing.</p>
        <StateBadge r={latest} />
      </Stage>
    );
  } else {
    main = <Stage testid="floor-idle" title="No hand yet" />;
  }

  const wide = !!pending;
  return (
    <div className={cx('grid h-full gap-5 p-5', wide ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[1fr_300px]')}>
      <div className="flex min-h-0 flex-col gap-4">
        {banner}
        <ActionStatus runner={runner} />
        <div className="min-h-0 flex-1 rounded-[22px] border border-line bg-surface/60 p-6">{main}</div>
      </div>
      {!wide && (
        <aside className="hidden min-h-0 overflow-auto lg:block">
          {/* flops only for hands this tablet already confirmed */}
          <Timeline rounds={s.rounds} showFlop={(r) => !!myEntry(r, mem)} highlight={mineRound?.id} />
        </aside>
      )}
    </div>
  );
}
