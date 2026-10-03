import type { RoundState, Step, StreamEvent, TableSummary } from '@preflop/client';
import type { RoundPhase } from '@preflop/ui';
import { handNoFromRoundId } from './flop.ts';

/** Lobby / table status line (screen 2, screen 3). */
export interface TableStatus { tone: 'accent' | 'info' | 'muted' | 'warn'; label: string; open: boolean }

export function tableStatus(t: Pick<TableSummary, 'status' | 'ready' | 'stream_live' | 'open_round_id' | 'current_round'>): TableStatus {
  if (t.status === 'paused') return { tone: 'warn', label: 'Paused', open: false };
  if (t.status !== 'active' || !t.stream_live) return { tone: 'muted', label: 'Stream unavailable', open: false };
  // An open round wins over the readiness snapshot: `ready` comes from the last poll and can be
  // stale between heartbeats, and the server still refuses bets with `table_not_ready` if needed.
  if (t.open_round_id) return { tone: 'accent', label: 'Predictions open', open: true };
  if (!t.ready) return { tone: 'warn', label: 'Table reconnecting', open: false };
  const s = t.current_round?.state;
  if (s === 'LOCKED' || s === 'DEALT' || s === 'REVIEW') return { tone: 'info', label: 'Round in progress', open: false };
  return { tone: 'muted', label: 'Waiting for next round', open: false };
}

const IN_PLAY: RoundState[] = ['LOCKED', 'DEALT', 'REVIEW'];

/** Stepper phase for a table: open while a round accepts predictions, locked while the flop is coming, reveal on the flop. */
export function phaseOf(t: Pick<TableSummary, 'open_round_id' | 'current_round'>, revealing: boolean): RoundPhase {
  if (revealing) return 'reveal';
  const s = t.current_round?.state;
  if (s === 'DEALT' || s === 'REVIEW') return 'reveal';
  if (t.open_round_id) return 'open';
  if (s && IN_PLAY.includes(s)) return 'locked';
  return 'open';
}

/** Hand number of the round that currently accepts predictions. */
export function openHandNo(t: Pick<TableSummary, 'open_round_id' | 'current_round'>): number | null {
  if (!t.open_round_id) return null;
  if (t.current_round?.id === t.open_round_id) return t.current_round.hand_no;
  return handNoFromRoundId(t.open_round_id);
}

/**
 * Applies a WS round event to a cached table summary, so the lobby and the table screen stay
 * live without refetching on every event. Unknown events return the table unchanged.
 */
export function applyRoundEvent<T extends TableSummary>(t: T, e: StreamEvent): T {
  if (!e.table_id || e.table_id !== t.id || !e.round_id) return t;
  const handNo = typeof e.data?.handNo === 'number' ? (e.data.handNo as number) : handNoFromRoundId(e.round_id) ?? t.current_round?.hand_no ?? 0;
  const cur = (state: RoundState, step: Step) => ({ id: e.round_id!, hand_no: handNo, state, step });
  const cards = Array.isArray(e.data?.cards) ? (e.data.cards as string[]) : null;
  switch (e.type) {
    case 'round.opened':
      return { ...t, open_round_id: e.round_id, current_round: cur('OPEN', 'open') };
    case 'round.locked':
      return {
        ...t,
        open_round_id: t.open_round_id === e.round_id ? null : t.open_round_id,
        current_round: t.current_round && t.current_round.id !== e.round_id && t.current_round.hand_no > handNo ? t.current_round : cur('LOCKED', 'locked'),
      };
    case 'round.dealt':
      return {
        ...t,
        open_round_id: t.open_round_id === e.round_id ? null : t.open_round_id,
        current_round: t.current_round && t.current_round.id !== e.round_id && t.current_round.hand_no > handNo ? t.current_round : cur('DEALT', 'dealing'),
        last_flop: cards ? { round_id: e.round_id, hand_no: handNo, cards } : t.last_flop,
      };
    case 'round.settled':
      return {
        ...t,
        current_round: t.current_round?.id === e.round_id ? { ...t.current_round, state: 'SETTLED' } : t.current_round,
        last_flop: cards ? { round_id: e.round_id, hand_no: handNo, cards } : t.last_flop,
      };
    case 'round.voided':
      return {
        ...t,
        open_round_id: t.open_round_id === e.round_id ? null : t.open_round_id,
        current_round: t.current_round?.id === e.round_id ? { ...t.current_round, state: 'VOID' } : t.current_round,
      };
    default:
      return t;
  }
}

// ------------------------------------------------------------------ connection

export type StreamStatus = 'connecting' | 'open' | 'closed';

/**
 * Bets are paused while the live stream is not open: the player would otherwise bet on a round
 * whose lock or flop they cannot see. The server stays authoritative (it refuses late bets
 * whatever the screen shows); this keeps the screen honest. `message` is null when connected
 * and in sync.
 */
export function streamGate(ws: StreamStatus, resyncing = false): { paused: boolean; message: string | null } {
  // Re-opened after a drop: still paused until the table is refetched (events were missed).
  if (ws === 'open') return resyncing ? { paused: true, message: 'Reconnected · updating the table…' } : { paused: false, message: null };
  if (ws === 'connecting') return { paused: true, message: 'Connecting to the table… bets paused' };
  return { paused: true, message: 'Reconnecting… bets paused' };
}
