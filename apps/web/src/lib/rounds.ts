import type { MyBet } from '@preflop/client';

/** Settled-round summary for the Round complete sheet (screen 8). */
export interface RoundSummary {
  roundId: string;
  handNo: number;
  tableName: string;
  flop: string[] | null;
  selections: string[];
  usedMinor: number;
  returnedMinor: number;
  /** returned − used */
  netMinor: number;
  status: 'won' | 'lost' | 'void' | 'mixed' | 'open';
  currency: string;
}

export const isFinal = (status: string) => status === 'won' || status === 'lost' || status === 'void' || status === 'voided' || status === 'refunded';
const isVoid = (s: string) => s === 'void' || s === 'voided' || s === 'refunded';

/** Aggregates my bets on one round. A void bet returns its stake. */
export function summarizeRound(bets: readonly MyBet[]): RoundSummary | null {
  const first = bets[0];
  if (!first) return null;
  let used = 0;
  let returned = 0;
  const statuses = new Set<string>();
  for (const b of bets) {
    used += b.stake_minor;
    if (b.status === 'won') returned += b.payout_minor ?? b.potential_payout_minor;
    else if (isVoid(b.status)) returned += b.payout_minor ?? b.stake_minor;
    statuses.add(isVoid(b.status) ? 'void' : b.status);
  }
  let status: RoundSummary['status'];
  if ([...statuses].some((s) => !isFinal(s))) status = 'open';
  else if (statuses.size === 1) status = [...statuses][0] as RoundSummary['status'];
  else if (statuses.has('won')) status = 'won';
  else status = 'mixed';
  return {
    roundId: first.round_id, handNo: first.hand_no, tableName: first.table_name, flop: bets.find((b) => b.flop)?.flop ?? null,
    selections: bets.map((b) => b.selection_id), usedMinor: used, returnedMinor: returned, netMinor: returned - used, status, currency: first.currency,
  };
}

/** Groups bets by round, newest round first (Activity screen). */
export function groupByRound(bets: readonly MyBet[]): { roundId: string; bets: MyBet[] }[] {
  const map = new Map<string, MyBet[]>();
  for (const b of bets) {
    const l = map.get(b.round_id);
    if (l) l.push(b);
    else map.set(b.round_id, [b]);
  }
  return [...map.entries()]
    .map(([roundId, list]) => ({ roundId, bets: list }))
    .sort((a, b) => (b.bets[0]!.placed_at > a.bets[0]!.placed_at ? 1 : -1));
}
