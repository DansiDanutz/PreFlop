import { Flop, Spinner, cx } from '@preflop/ui';
import { CheckCircle2, Hand, Play, Scissors, Shuffle } from 'lucide-react';
import type { ReactNode } from 'react';
import { ActionStatus, BigButton, HoldButton } from '../components/controls.tsx';
import { FlopEntry } from '../components/FlopEntry.tsx';
import { StateBadge, Timeline } from '../components/RoundBits.tsx';
import type { TableApi } from '../lib/api.ts';
import { prettyFlop } from '../lib/cards.ts';
import { type Live, type Runner, myEntry, pendingEntry } from '../lib/hooks.ts';
import type { Round, TableState } from '../lib/types.ts';

/** Centered stage for one big instruction. */
export function Stage({ eyebrow, title, children, className, testid }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; className?: string; testid?: string }) {
  return (
    <div className={cx('flex h-full flex-col items-center justify-center gap-6 text-center', className)} data-testid={testid}>
      {eyebrow && <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted">{eyebrow}</div>}
      <div className="font-serif text-5xl leading-tight">{title}</div>
      {children}
    </div>
  );
}

export type DealerTask =
  | { kind: 'procedure'; round: Round }
  | { kind: 'entry'; round: Round }
  | { kind: 'start'; round: Round; previous?: Round | undefined }
  | { kind: 'waiting'; round: Round }
  | { kind: 'idle'; round?: Round | undefined };

export function dealerTask(s: TableState, mem: Record<string, string[]>): DealerTask {
  const latest = s.rounds[0];
  if (latest?.state === 'LOCKED' && latest.step !== 'dealing') return { kind: 'procedure', round: latest };
  const pending = pendingEntry(s, 'dealer', mem);
  if (pending) return { kind: 'entry', round: pending };
  if (latest?.state === 'OPEN') return { kind: 'start', round: latest, previous: s.rounds[1] };
  if (latest && (latest.state === 'LOCKED' || latest.state === 'DEALT' || latest.state === 'REVIEW')) return { kind: 'waiting', round: latest };
  return { kind: 'idle', round: latest };
}

function ResultLine({ r, mine }: { r: Round; mine?: string[] | undefined }) {
  if (r.state === 'SETTLED') return <div className="flex flex-col items-center gap-3"><Flop cards={r.flop} size="md" /><div className="text-lg text-muted">Hand {r.hand_no} settled</div></div>;
  if (r.state === 'VOID') return <div className="text-lg text-danger">Hand {r.hand_no} voided · all bets refunded</div>;
  if (r.state === 'REVIEW') return <div className="text-lg text-warn">Hand {r.hand_no} is with the floor manager (entries differ)</div>;
  return <div className="text-lg text-muted">Hand {r.hand_no}: {mine?.length ? `your entry ${prettyFlop(mine)} · ` : ''}<StateBadge r={r} /></div>;
}

export function DealerScreen({ api, live, mem, runner, submitFlop }: {
  api: TableApi; live: Live; mem: Record<string, string[]>; runner: Runner; submitFlop: (r: Round, cards: string[]) => void;
}) {
  const s = live.state;
  if (!s) return <Stage title={<Spinner className="h-10 w-10" />} eyebrow="Connecting" />;
  const task = dealerTask(s, mem);
  const busy = !!runner.pending;
  let main: ReactNode;

  switch (task.kind) {
    case 'procedure': {
      const r = task.round;
      if (r.step === 'cut_instructed') {
        main = (
          <Stage testid="dealer-cut" eyebrow={`Hand ${r.hand_no} · bets closed`} title={<span className="sr-only">Cut</span>}>
            <div className="flex items-baseline gap-6 leading-none">
              <span className="font-sans text-6xl font-extrabold tracking-tight text-muted">CUT AT</span>
              <span className="font-sans text-[200px] font-extrabold tabular-nums tracking-tighter text-accent" data-testid="cut-depth">{r.cut_depth}</span>
            </div>
            <p className="max-w-2xl text-2xl text-ink/90">Cut the deck at <b>{r.cut_depth}</b> cards from the top with the cut card, then tap <b>CUT</b>.</p>
            <BigButton className="h-24 w-full max-w-xl text-3xl" busy={busy} onClick={() => void runner.run(api.hand(r.hand_no, 'cut', `Cut hand ${r.hand_no}`))} data-testid="btn-cut">
              <Scissors className="h-8 w-8" /> CUT
            </BigButton>
          </Stage>
        );
      } else if (r.step === 'cut') {
        main = (
          <Stage testid="dealer-deal" eyebrow={`Hand ${r.hand_no} · deck cut at ${r.cut_depth}`} title="Deal the hand">
            <p className="max-w-2xl text-2xl text-muted">Tap <b className="text-ink">DEAL START</b>, then deal the hole cards, burn, and the flop.</p>
            <BigButton className="h-24 w-full max-w-xl text-3xl" busy={busy} onClick={() => void runner.run(api.hand(r.hand_no, 'deal-start', `Deal start hand ${r.hand_no}`))} data-testid="btn-deal-start">
              <Hand className="h-8 w-8" /> DEAL START
            </BigButton>
          </Stage>
        );
      } else {
        main = (
          <Stage testid="dealer-shuffling" eyebrow={`Hand ${r.hand_no} · bets closed`} title="Waiting for the PreFlop shuffler…">
            <div className="relative grid h-32 w-32 place-items-center">
              <span className="absolute inset-0 animate-spin rounded-full border-4 border-line-strong border-t-accent" />
              <Shuffle className="h-12 w-12 text-accent" />
            </div>
            <p className="max-w-xl text-xl text-muted">The shuffler is preparing a fresh deck for this hand. Do not touch the deck. The cut depth appears here next.</p>
          </Stage>
        );
      }
      break;
    }
    case 'entry': {
      const r = task.round;
      main = (
        <FlopEntry resetKey={r.id} busy={busy} onSubmit={(cards) => submitFlop(r, cards)}
          title={<>Enter the flop · Hand {r.hand_no}</>}
          subtitle={r.state === 'LOCKED' ? 'Tap the three flop cards as they lie on the table.' : <>Hand {r.hand_no} is {r.state === 'DEALT' ? 'captured by the board camera' : 'in review'} — your entry is still needed.</>} />
      );
      break;
    }
    case 'waiting': {
      const r = task.round;
      const mine = myEntry(r, mem);
      main = (
        <Stage testid="dealer-waiting" eyebrow={`Hand ${r.hand_no}`} title={r.state === 'REVIEW' ? 'Entries differ — floor manager reviewing' : 'Entry recorded'}>
          {mine?.length ? <Flop cards={mine} size="lg" /> : null}
          <p className="max-w-xl text-xl text-muted">{r.state === 'REVIEW' ? 'Continue the hand. The floor manager decides the flop from the camera evidence.' : 'Waiting for floor confirmation and the board camera.'}</p>
          <StateBadge r={r} />
        </Stage>
      );
      break;
    }
    case 'start': {
      const r = task.round;
      const paused = s.table.status !== 'active';
      main = (
        <Stage testid="dealer-open" eyebrow={<span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-accent pf-pulse" /> Bets open</span>} title={<>Bets open on hand {r.hand_no}</>}>
          <p className="max-w-xl text-xl text-muted">When the table is ready for the next hand, press and hold <b className="text-ink">START HAND</b>. Betting closes immediately.</p>
          <HoldButton className="h-36 w-full max-w-xl text-4xl" disabled={paused} busy={busy} onHold={() => void runner.run(api.hand(r.hand_no, 'start', `Start hand ${r.hand_no}`))}>
            <span className="inline-flex items-center gap-4" data-testid="btn-start"><Play className="h-10 w-10 fill-current" /> START HAND</span>
          </HoldButton>
          {paused && <div className="text-lg text-warn">Table paused{s.table.pause_reason ? `: ${s.table.pause_reason}` : ''}</div>}
          {task.previous && <div className="mt-2"><ResultLine r={task.previous} mine={myEntry(task.previous, mem)} /></div>}
        </Stage>
      );
      break;
    }
    default: {
      const r = task.round;
      main = (
        <Stage testid="dealer-idle" eyebrow={r ? `Hand ${r.hand_no}` : 'No hand'} title={s.table.status === 'paused' ? 'Table paused' : 'Waiting for betting to open'}>
          {r && (r.state === 'SETTLED' || r.state === 'VOID') && <ResultLine r={r} />}
          {!s.readiness.ok && (
            <ul className="flex max-w-2xl flex-col gap-2 text-left">
              {s.readiness.problems.map((p) => <li key={p} className="rounded-[12px] border border-warn/40 bg-warn/10 px-4 py-2 text-base text-warn">{p}</li>)}
            </ul>
          )}
        </Stage>
      );
    }
  }

  const wide = task.kind === 'entry';
  return (
    <div className={cx('grid h-full gap-5 p-5', wide ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[1fr_300px]')}>
      <div className="flex min-h-0 flex-col gap-4">
        <ActionStatus runner={runner} />
        <div className={cx('min-h-0 flex-1 rounded-[22px] border border-line p-6', task.kind === 'procedure' && task.round.step === 'cut_instructed' ? 'bg-surface' : 'bg-surface/60')}>{main}</div>
        {task.kind === 'entry' && task.round.state !== 'LOCKED' && (
          <div className="flex items-center gap-2 text-sm text-muted"><CheckCircle2 className="h-4 w-4" /> The next hand can start after this entry.</div>
        )}
      </div>
      {!wide && <aside className="hidden min-h-0 overflow-auto lg:block"><Timeline rounds={s.rounds} showFlop={() => true} highlight={task.round?.id} /></aside>}
    </div>
  );
}
