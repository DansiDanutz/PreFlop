import type { ReactNode } from 'react';
import type { TableSummary } from '@preflop/client';
import { Badge, CardBack, PlayingCard, StatusDot, cx, formatMoney } from '@preflop/ui';
import { ROUND_STATE_TONE } from '../lib/format.ts';

export function RoundStateBadge({ state }: { state: string }) {
  const tone = ROUND_STATE_TONE[state] ?? 'muted';
  return <Badge tone={tone} className="!px-2 !py-0.5 !text-[10px]">{state.replace('_', ' ')}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ({ active: 'accent', delivered: 'accent', approved: 'accent', verified: 'accent', completed: 'accent', settled: 'accent', won: 'accent',
    paused: 'warn', pending: 'warn', new: 'info', none: 'muted', lost: 'muted', accepted: 'info',
    suspended: 'danger', failed: 'danger', rejected: 'danger', revoked: 'danger', closed: 'muted', retired: 'muted', self_excluded: 'warn', void: 'muted', voided: 'muted' } as const)[status] ?? 'muted';
  return <Badge tone={tone} className="!px-2 !py-0.5 !text-[10px]">{status.replace('_', ' ')}</Badge>;
}

/** Live status of a table as a dot + label (the concepts' "Predictions open" / "Round in progress"). */
export function TableStatus({ t }: { t: Pick<TableSummary, 'status' | 'ready' | 'current_round' | 'stream_live'> }) {
  if (t.status === 'paused') return <StatusDot tone="warn" label="Paused" />;
  if (t.status === 'retired') return <StatusDot tone="muted" label="Retired" />;
  if (!t.ready) return <StatusDot tone="danger" label="Not ready" />;
  const s = t.current_round?.state;
  if (s === 'OPEN') return <StatusDot tone="accent" label="Predictions open" />;
  if (s === 'REVIEW' || s === 'EVIDENCE_REJECTED') return <StatusDot tone="warn" label="In review" />;
  if (s) return <StatusDot tone="info" label="Round in progress" />;
  return <StatusDot tone="muted" label="Idle" />;
}

export function MiniFlop({ cards, className }: { cards: readonly string[] | null | undefined; className?: string }) {
  return (
    <div className={cx('flex gap-1.5', className)} aria-label={cards?.length ? `Flop ${cards.join(' ')}` : 'No flop yet'}>
      {[0, 1, 2].map((i) => (cards?.[i] ? <PlayingCard key={i} code={cards[i]!} size="sm" /> : <CardBack key={i} size="sm" />))}
    </div>
  );
}

/** Inline text-sized flop for tables: "K♥ 7♦ 2♣". */
export function FlopText({ cards }: { cards: readonly string[] | null | undefined }) {
  if (!cards?.length) return <span className="text-faint">—</span>;
  const S: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
  return (
    <span className="inline-flex gap-1.5 font-semibold">
      {cards.map((c, i) => {
        const suit = c.slice(-1).toLowerCase();
        return <span key={i} className={suit === 'h' || suit === 'd' ? 'text-[#ff6b66]' : 'text-ink'}>{c.slice(0, -1).replace('T', '10')}{S[suit]}</span>;
      })}
    </span>
  );
}

export const Money = ({ minor, currency, className }: { minor: number | null | undefined; currency: string; className?: string }) =>
  minor === null || minor === undefined ? <span className="text-faint">—</span> : <span className={cx('whitespace-nowrap tabular-nums', minor < 0 && 'text-danger', className)}>{formatMoney(minor, currency)}</span>;

export function KindChip({ kind }: { kind: string }) {
  return <span className={cx('rounded-full border px-2 py-0.5 text-[11px] font-medium', kind === 'physical' ? 'border-info/50 text-info' : 'border-line-strong text-muted')}>{kind}</span>;
}

export function Problems({ problems }: { problems: string[] }) {
  if (!problems.length) return <span className="text-xs text-accent">Ready</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {problems.map((p) => <li key={p} className="rounded-[8px] bg-danger/10 px-2 py-0.5 text-[11px] leading-snug text-danger ring-1 ring-danger/30">{p}</li>)}
    </ul>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end gap-3">{children}</div>;
}
