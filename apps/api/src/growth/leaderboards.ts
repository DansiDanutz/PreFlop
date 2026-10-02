import { type PlayMode } from '@preflop/odds-engine';
import { audit } from '../lib/audit.ts';
import type { Db, Tx } from '../lib/db.ts';
import { forbidden, unprocessable } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { acct, balance, lockAccount, post, walletPurpose } from '../lib/ledger.ts';

/**
 * Leaderboards and their prize pools (docs/16 §1–2). Standings are computed from settled bets;
 * every movement of value is a balanced ledger post with a unique (kind, ref).
 */

export type Metric = 'net' | 'volume' | 'roi' | 'points';
export const REAL_MODES = new Set<PlayMode>(['real-fiat', 'real-crypto']);
/** Chips and diamonds live in one organization's closed loop, so their boards always belong to an organization. */
export const CLOSED_LOOP_MODES = new Set<PlayMode>(['virtual-chips', 'diamonds']);
export const DEFAULT_MIN_ROUNDS: Record<Metric, number> = { net: 10, volume: 1, roi: 20, points: 1 };

export interface LeaderboardRow {
  id: string; owner_org: string | null; name: string; mode: PlayMode; currency: string;
  scope: 'global' | 'org' | 'table' | 'room'; scope_ref: string | null; metric: Metric; min_rounds: number;
  prize_split_bps: number[]; starts_at: Date; ends_at: Date; status: 'scheduled' | 'active' | 'settled' | 'cancelled';
  margin_bps: number; contribution_bps: number; accrued_until: Date | null; created_by: string; created_at: Date; settled_at: Date | null;
}

export interface Standing { user_id: string; display_name: string; score: number; rounds: number; staked: number; returned: number; qualified: boolean; rank: number | null }

type Q = Pick<Db, 'query'>;

export const poolAccount = (lb: Pick<LeaderboardRow, 'id' | 'mode' | 'currency'>) => acct(lb.id, 'pool', lb.mode, lb.currency);
export const poolBalance = (c: Q, lb: Pick<LeaderboardRow, 'id' | 'mode' | 'currency'>) => balance(c as Tx, poolAccount(lb));

/** The wallet a prize lands in: free chips and real money in the player's own wallet; chips and diamonds stay in the owner's closed loop. */
export function prizeWallet(lb: Pick<LeaderboardRow, 'mode' | 'currency' | 'owner_org'>, userId: string): string {
  if (lb.mode === 'play' || REAL_MODES.has(lb.mode)) return acct(userId, 'wallet', lb.mode, lb.currency);
  if (!lb.owner_org) throw unprocessable('org_required', `${lb.mode} prizes are paid inside an organization's closed loop`);
  return acct(userId, walletPurpose(lb.owner_org), lb.mode, lb.currency);
}

export async function modeEnabled(c: Q, mode: PlayMode): Promise<boolean> {
  if (mode === 'play') return true;
  const v = (await c.query<{ value: Record<string, boolean> }>("select value from settings where key = 'modes_enabled'")).rows[0]?.value ?? {};
  return v[mode] === true;
}

/** Real-money boards stay closed while the owner keeps real money off (docs/06). */
export async function assertBoardModeAllowed(c: Q, mode: PlayMode): Promise<void> {
  if (REAL_MODES.has(mode) && !(await modeEnabled(c, mode))) throw forbidden('mode_disabled', `${mode} is switched off; real-money leaderboards open when it is enabled`);
}

/** SQL for the bets a board counts: its mode and currency, its scope, settled (won/lost) within the window. */
function scopeSql(lb: LeaderboardRow, until: Date): { where: string; params: unknown[] } {
  const params: unknown[] = [lb.mode, lb.currency, lb.starts_at, until];
  let scope = '';
  if (lb.scope === 'table') { params.push(lb.scope_ref); scope = `and r.table_id = $${params.length}`; }
  else if (lb.scope === 'room') { params.push(lb.scope_ref); scope = `and b.room_id = $${params.length}`; }
  else if (lb.scope === 'org') {
    params.push(lb.scope_ref);
    const i = params.length;
    scope = `and (t.club_id = $${i} or b.room_id in (select id from rooms where org_id = $${i}))`;
  }
  // Chips and diamonds stay in the owner's closed loop: only bets in its own rooms count.
  if (CLOSED_LOOP_MODES.has(lb.mode)) { params.push(lb.owner_org); scope += ` and b.room_id in (select id from rooms where org_id = $${params.length})`; }
  return {
    where: `b.mode = $1 and b.currency = $2 and b.status in ('won','lost') and b.settled_at >= $3 and b.settled_at < $4 ${scope}`,
    params,
  };
}

/** Live standings, best first; ties go to fewer rounds, then to whoever got there first. */
export async function standings(c: Q, lb: LeaderboardRow, limit = 50, now = new Date()): Promise<Standing[]> {
  const until = new Date(Math.min(now.getTime(), lb.ends_at.getTime()));
  const s = scopeSql(lb, until);
  const score = {
    net: 'sum(coalesce(b.payout_minor, 0)) - sum(b.stake_minor)',
    volume: 'sum(b.stake_minor)',
    roi: 'sum(coalesce(b.payout_minor, 0))::numeric / nullif(sum(b.stake_minor), 0)',
    points: "sum(case when b.status = 'won' then round(b.odds_centi / 10.0) else 0 end)",
  }[lb.metric];
  s.params.push(lb.min_rounds, limit);
  const rows = (await c.query<{ user_id: string; display_name: string; score: string; rounds: number; staked: string; returned: string; qualified: boolean }>(
    `with agg as (
       select b.user_id, count(distinct b.round_id)::int as rounds, sum(b.stake_minor)::bigint as staked,
              sum(coalesce(b.payout_minor, 0))::bigint as returned, (${score})::numeric as score, max(b.settled_at) as last_at
         from bets b join rounds r on r.id = b.round_id join poker_tables t on t.id = r.table_id
        where ${s.where}
        group by b.user_id)
     select a.user_id, u.display_name, a.score::text as score, a.rounds, a.staked::text as staked, a.returned::text as returned,
            a.rounds >= $${s.params.length - 1} as qualified
       from agg a join users u on u.id = a.user_id
      where u.status = 'active'
      order by (a.rounds >= $${s.params.length - 1}) desc, a.score desc nulls last, a.rounds asc, a.last_at asc
      limit $${s.params.length}`, s.params)).rows;
  let rank = 0;
  return rows.map((r) => ({
    user_id: r.user_id, display_name: r.display_name, score: Number(r.score), rounds: r.rounds, staked: Number(r.staked), returned: Number(r.returned),
    qualified: r.qualified, rank: r.qualified ? ++rank : null,
  }));
}

/** One player's standing, even outside the top N. */
export async function standingOf(c: Q, lb: LeaderboardRow, userId: string, now = new Date()): Promise<Standing | null> {
  const all = await standings(c, lb, 100_000, now);
  return all.find((s) => s.user_id === userId) ?? null;
}

export async function lockBoard(c: Tx, id: string): Promise<LeaderboardRow | undefined> {
  return (await c.query<LeaderboardRow>('select * from leaderboards where id = $1 for update', [id])).rows[0];
}

/** Moves a fixed amount into the pool from the owner's treasury ('org') or from PreFlop ('sponsor'). */
export async function fund(c: Tx, lb: LeaderboardRow, source: 'org' | 'sponsor', amountMinor: number, by: string): Promise<void> {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw unprocessable('invalid_amount', 'amount must be a positive whole number of minor units');
  if (lb.status === 'settled' || lb.status === 'cancelled') throw unprocessable('board_closed', `this leaderboard is ${lb.status}`);
  await assertBoardModeAllowed(c, lb.mode);
  let from: string;
  if (source === 'org') {
    if (!lb.owner_org) throw unprocessable('not_an_org_board', 'only an organization board is funded from a treasury');
    if (lb.mode === 'play') throw unprocessable('play_is_sponsored', 'free-chip boards are funded by PreFlop');
    from = acct(lb.owner_org, 'treasury', lb.mode, lb.currency);
    await lockAccount(c, from);
    if ((await balance(c, from)) < amountMinor) throw unprocessable('insufficient_treasury', 'the treasury does not hold that much');
  } else {
    from = lb.mode === 'play' ? acct('PreFlop', 'play-issuance', 'play', 'PLAY') : acct('PreFlop', 'marketing', lb.mode, lb.currency);
  }
  const id = newId('lbf');
  await post(c, `pool.fund.${source}`, id, [{ from, to: poolAccount(lb), amountMinor }]);
  await c.query('insert into leaderboard_funding (id, leaderboard_id, source, from_account, amount_minor) values ($1, $2, $3, $4, $5)', [id, lb.id, source, from, amountMinor]);
  await audit(c, { type: 'leaderboard.funded', leaderboardId: lb.id, source, amountMinor, by });
}

/**
 * Accrues PreFlop's margin share and the player contribution for bets settled since the last
 * accrual (docs/16 §2). The base is PreFlop's own house result (stake − payout on its bets) plus
 * its fee on organizer bets; losses are not clawed back. The contribution comes out of PreFlop's
 * bankroll, never from the player, so prices are unchanged.
 */
export async function accrue(c: Tx, lb: LeaderboardRow, now = new Date()): Promise<number> {
  if (lb.margin_bps === 0 && lb.contribution_bps === 0) return 0;
  const from = lb.accrued_until ?? lb.starts_at;
  const until = new Date(Math.min(now.getTime() - SETTLE_GRACE_MS, lb.ends_at.getTime()));
  if (until <= from) return 0;
  const s = scopeSql({ ...lb, starts_at: from }, until);
  const t = (await c.query<{ house: string; fees: string; staked: string }>(
    `select coalesce(sum(case when b.house_kind = 'preflop' then b.stake_minor - coalesce(b.payout_minor, 0) else 0 end), 0)::text as house,
            coalesce(sum(case when b.house_kind <> 'preflop' then b.fee_minor else 0 end), 0)::text as fees,
            coalesce(sum(b.stake_minor), 0)::text as staked
       from bets b join rounds r on r.id = b.round_id join poker_tables t on t.id = r.table_id where ${s.where}`, s.params)).rows[0]!;
  const ref = `${lb.id}:${until.toISOString()}`;
  const moves: { source: 'margin' | 'contribution'; from: string; amount: number }[] = [];
  const house = Math.max(0, Number(t.house)), fees = Math.max(0, Number(t.fees)), staked = Number(t.staked);
  if (lb.margin_bps > 0) {
    moves.push({ source: 'margin', from: acct('PreFlop', 'bankroll', lb.mode, lb.currency), amount: Math.floor((house * lb.margin_bps) / 10_000) });
    moves.push({ source: 'margin', from: acct('PreFlop', 'platform-fees', lb.mode, lb.currency), amount: Math.floor((fees * lb.margin_bps) / 10_000) });
  }
  if (lb.contribution_bps > 0 && REAL_MODES.has(lb.mode)) {
    moves.push({ source: 'contribution', from: acct('PreFlop', 'bankroll', lb.mode, lb.currency), amount: Math.floor((staked * lb.contribution_bps) / 10_000) });
  }
  let total = 0;
  for (const [i, m] of moves.entries()) {
    if (m.amount <= 0) continue;
    if (await post(c, `pool.accrue.${m.source}`, `${ref}:${i}`, [{ from: m.from, to: poolAccount(lb), amountMinor: m.amount }])) {
      await c.query('insert into leaderboard_funding (id, leaderboard_id, source, from_account, amount_minor) values ($1, $2, $3, $4, $5)', [newId('lbf'), lb.id, m.source, m.from, m.amount]);
      total += m.amount;
    }
  }
  await c.query('update leaderboards set accrued_until = $2 where id = $1', [lb.id, until]);
  return total;
}

/**
 * Settlement stamps settled_at inside a transaction that commits a moment later, so accrual and
 * final standings only look at bets settled at least this long ago.
 */
export const SETTLE_GRACE_MS = 2 * 60_000;

const BADGE = (rank: number): 'champion' | 'podium' | 'top10' | null => (rank === 1 ? 'champion' : rank <= 3 ? 'podium' : rank <= 10 ? 'top10' : null);

/** Returns what is left in the pool to its funders, pro rata to what each put in (largest share takes the rounding). */
async function returnRemainder(c: Tx, lb: LeaderboardRow, kind: string): Promise<number> {
  const left = await poolBalance(c, lb);
  if (left <= 0) return 0;
  const funders = (await c.query<{ from_account: string; total: string }>(
    'select from_account, sum(amount_minor)::text as total from leaderboard_funding where leaderboard_id = $1 group by from_account order by sum(amount_minor) desc, from_account', [lb.id])).rows;
  const sum = funders.reduce((a, f) => a + Number(f.total), 0);
  if (sum <= 0) return 0;
  const parts = funders.map((f) => ({ to: f.from_account, amount: Math.floor((left * Number(f.total)) / sum) }));
  parts[0]!.amount += left - parts.reduce((a, p) => a + p.amount, 0);
  await post(c, kind, lb.id, parts.filter((p) => p.amount > 0).map((p) => ({ from: poolAccount(lb), to: p.to, amountMinor: p.amount })));
  return left;
}

/**
 * The qualified players who may take a prize, re-ranked. On real-money boards only verified
 * identities win; anyone else steps aside and the ranks close up (self-excluded and suspended
 * players are already out of the standings).
 */
async function winners(c: Tx, lb: LeaderboardRow, now: Date): Promise<Standing[]> {
  const n = Math.max(10, lb.prize_split_bps.length);
  if (!REAL_MODES.has(lb.mode)) return (await standings(c, lb, n, now)).filter((s) => s.qualified);
  const all = (await standings(c, lb, 100_000, now)).filter((s) => s.qualified);
  const ok = new Set((await c.query<{ id: string }>(`select id from users where id = any($1) and kyc_status = 'verified' and status = 'active'`, [all.map((s) => s.user_id)])).rows.map((r) => r.id));
  return all.filter((s) => ok.has(s.user_id)).slice(0, n).map((s, i) => ({ ...s, rank: i + 1 }));
}

/**
 * Closes an ended board: final accrual, prizes by rank to qualified players, badges for the top
 * ten, and whatever is unallocated back to the funders. Idempotent: a settled board is skipped.
 * A real-money board waits while its mode is switched off; the team can cancel it to refund the pool.
 */
export async function settle(c: Tx, id: string, now = new Date()): Promise<boolean> {
  const lb = await lockBoard(c, id);
  if (!lb || lb.status === 'settled' || lb.status === 'cancelled' || lb.ends_at.getTime() + SETTLE_GRACE_MS > now.getTime()) return false;
  if (REAL_MODES.has(lb.mode) && !(await modeEnabled(c, lb.mode))) return false;
  await accrue(c, lb, now);
  const pool = await poolBalance(c, lb);
  const top = await winners(c, lb, now);
  for (const s of top) {
    const prize = s.rank! <= lb.prize_split_bps.length ? Math.floor((pool * lb.prize_split_bps[s.rank! - 1]!) / 10_000) : 0;
    if (prize > 0) await post(c, 'pool.payout', `${lb.id}:${s.rank}`, [{ from: poolAccount(lb), to: prizeWallet(lb, s.user_id), amountMinor: prize }]);
    const badge = BADGE(s.rank!);
    await c.query(`insert into leaderboard_results (leaderboard_id, rank, user_id, score, rounds, prize_minor, badge) values ($1, $2, $3, $4, $5, $6, $7)
                   on conflict do nothing`, [lb.id, s.rank, s.user_id, s.score, s.rounds, prize, badge]);
    if (badge) {
      const label = badge === 'champion' ? `Champion · ${lb.name}` : badge === 'podium' ? `Podium · ${lb.name}` : `Top 10 · ${lb.name}`;
      await c.query('insert into badges (id, user_id, kind, leaderboard_id, label) values ($1, $2, $3, $4, $5) on conflict do nothing', [newId('bdg'), s.user_id, badge, lb.id, label]);
    }
  }
  await returnRemainder(c, lb, 'pool.return');
  await c.query(`update leaderboards set status = 'settled', settled_at = now() where id = $1`, [lb.id]);
  await audit(c, { type: 'leaderboard.settled', leaderboardId: lb.id, pool, winners: top.filter((s) => s.rank! <= lb.prize_split_bps.length).length });
  return true;
}

/** Cancels a board that has not settled and returns the whole pool to its funders. */
export async function cancel(c: Tx, id: string, by: string): Promise<void> {
  const lb = await lockBoard(c, id);
  if (!lb) throw unprocessable('not_found', 'no such leaderboard');
  if (lb.status === 'settled' || lb.status === 'cancelled') throw unprocessable('board_closed', `this leaderboard is ${lb.status}`);
  await returnRemainder(c, lb, 'pool.cancel');
  await c.query(`update leaderboards set status = 'cancelled', settled_at = now() where id = $1`, [lb.id]);
  await audit(c, { type: 'leaderboard.cancelled', leaderboardId: lb.id, by });
}
