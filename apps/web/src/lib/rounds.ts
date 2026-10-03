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
  mode: string;
  roomId: string | null;
  /** The wallet these bets came from (walletKey): amounts of different wallets are never added. */
  walletKey: string;
}

/**
 * One wallet = mode + currency + room (a room is one organizer's closed-loop wallet). A round can
 * hold bets from several wallets (free chips at the table and diamonds in a room): each gets its own totals.
 */
export const walletKey = (b: Pick<MyBet, 'mode' | 'currency'> & { room_id?: string | null | undefined }) => `${b.mode}:${b.currency}:${b.room_id ?? '-'}`;

export const isFinal = (status: string) => status === 'won' || status === 'lost' || status === 'void' || status === 'voided' || status === 'refunded';
const isVoid = (s: string) => s === 'void' || s === 'voided' || s === 'refunded';

/**
 * Aggregates my bets on one round from ONE wallet (group with groupByRound or summarizeRounds first).
 * A void bet returns its stake. Bets of another wallet than the first are refused, never summed.
 */
export function summarizeRound(bets: readonly MyBet[]): RoundSummary | null {
  const first = bets[0];
  if (!first) return null;
  if (bets.some((b) => walletKey(b) !== walletKey(first) || b.round_id !== first.round_id)) throw new RangeError('summarizeRound: bets of one round and one wallet only');
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
    mode: first.mode, roomId: first.room_id ?? null, walletKey: walletKey(first),
  };
}

/** Groups bets by round and wallet, newest first (Activity screen, Round complete). */
export function groupByRound(bets: readonly MyBet[]): { roundId: string; walletKey: string; bets: MyBet[] }[] {
  const map = new Map<string, MyBet[]>();
  for (const b of bets) {
    const k = `${b.round_id}|${walletKey(b)}`;
    const l = map.get(k);
    if (l) l.push(b);
    else map.set(k, [b]);
  }
  return [...map.values()]
    .map((list) => ({ roundId: list[0]!.round_id, walletKey: walletKey(list[0]!), bets: list }))
    .sort((a, b) => (b.bets[0]!.placed_at > a.bets[0]!.placed_at ? 1 : b.bets[0]!.placed_at < a.bets[0]!.placed_at ? -1 : 0));
}

/** One summary per wallet the round was played from. */
export function summarizeRounds(bets: readonly MyBet[]): RoundSummary[] {
  return groupByRound(bets).map((g) => summarizeRound(g.bets)!);
}
