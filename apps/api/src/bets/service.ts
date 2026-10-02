import {
  type Channel, FLOP_COUNT, type PlayMode, type SelectionStats, getSelection, payoutMinor, price, statsFor,
} from '@preflop/odds-engine';
import { audit } from '../lib/audit.ts';
import { type Db, type Tx, tx } from '../lib/db.ts';
import { ApiError, conflict, notFound, unprocessable } from '../lib/errors.ts';
import type { EventBatch } from '../lib/events.ts';
import { newId } from '../lib/ids.ts';
import { acct, balance, lockAccount, post } from '../lib/ledger.ts';
import { type TableRow, tableReadiness } from '../rounds/readiness.ts';
import { assertLossLimit, toEurCents } from '../lib/rg.ts';

/**
 * Bet placement where PreFlop is the house (docs/13 §5).
 *
 * Correct with any number of API processes: the exposure check runs INSIDE the bet transaction,
 * after `select … for update` on the round row (first in the global lock order), and is computed
 * from the round's accepted bets in the database. Two bets on one round — from any process — are
 * therefore strictly serialised, and each sees every bet committed before it. The in-process
 * keyed mutex only queues same-process bets so they do not each hold a pool connection while
 * waiting for the row lock; correctness does not depend on it.
 */

const STATS = new Map<string, ReturnType<typeof statsFor>>();
export function statsOf(selectionId: string) {
  let s = STATS.get(selectionId);
  if (!s) {
    s = statsFor(getSelection(selectionId));
    STATS.set(selectionId, s);
  }
  return s;
}

// ---- keyed mutex (in-process queueing only; the database lock is what serialises)
const chains = new Map<string, Promise<unknown>>();
export async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => mine);
  chains.set(key, chained);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (chains.get(key) === chained) chains.delete(key);
  }
}

/** Test hook: lets a test inject a failure between commit and the response. */
export const hooks: { afterCommit?: ((betId: string) => void) | undefined } = {};

/**
 * Exact worst-case loss of a round's PreFlop book if one more bet were added (the same arithmetic
 * as RoundExposure.lossIfAdded): houseNet[flop] = Σ stakes − Σ payouts of the bets that win on
 * that flop. Accepted bets are aggregated per selection in SQL — payouts with the engine's exact
 * rounding, floor(stake × odds / 100) per bet — so the cost is per distinct selection, not per bet.
 * Call it with the round row locked FOR UPDATE, so no other bet can commit in between.
 */
export async function roundLossIfAdded(c: Tx, roundId: string, stats: SelectionStats, stakeMinor: number, oddsCenti: number): Promise<number> {
  const rows = (await c.query<{ selection_id: string; stake: number; pay: number }>(
    `select selection_id, sum(stake_minor)::bigint as stake, sum(stake_minor * odds_centi / 100)::bigint as pay
       from bets where round_id = $1 and status = 'accepted' and house_kind = 'preflop' group by selection_id`, [roundId])).rows;
  const pay = payoutMinor(stakeMinor, oddsCenti);
  let stakes = stakeMinor, gross = stakeMinor + pay;
  const owed = new Float64Array(FLOP_COUNT);
  for (const f of stats.winningFlops) owed[f]! += pay;
  for (const r of rows) {
    stakes += r.stake;
    gross += r.stake + r.pay;
    for (const f of statsOf(r.selection_id).winningFlops) owed[f]! += r.pay;
  }
  // Every partial sum is bounded by gross; within MAX_SAFE_INTEGER, Float64 stays exact.
  if (gross > Number.MAX_SAFE_INTEGER) throw unprocessable('limit_exceeded', 'round totals would exceed the safe integer range');
  let maxOwed = 0;
  for (let f = 0; f < FLOP_COUNT; f++) if (owed[f]! > maxOwed) maxOwed = owed[f]!;
  return Math.max(0, maxOwed - stakes);
}

export interface PlaceBetInput {
  userId: string;
  idempotencyKey: string;
  roundId: string;
  selectionId: string;
  stakeMinor: number;
  oddsCenti: number;
  acceptPriceChange?: boolean;
  channel?: Channel;
  partnerId?: string | null;
}

export interface BetView {
  bet_id: string;
  round_id: string;
  selection_id: string;
  stake_minor: number;
  odds_centi: number;
  potential_payout_minor: number;
  mode: string;
  currency: string;
  status: string;
}

const view = (b: { id: string; round_id: string; selection_id: string; stake_minor: number; odds_centi: number; mode: string; currency: string; status: string }): BetView => ({
  bet_id: b.id, round_id: b.round_id, selection_id: b.selection_id, stake_minor: b.stake_minor, odds_centi: b.odds_centi,
  potential_payout_minor: payoutMinor(b.stake_minor, b.odds_centi), mode: b.mode, currency: b.currency, status: b.status,
});

/**
 * Re-checks, inside the bet transaction, what may have changed since the pre-checks: the account
 * status (row shared-locked, so a suspension or self-exclusion commits strictly before or after)
 * and the table status (a pause takes the table row lock). Lock order: round → user → table → wallet.
 */
export async function assertEligibleInTx(c: Tx, userId: string, tableId: string): Promise<void> {
  const u = (await c.query<{ status: string }>('select status from users where id = $1 for share', [userId])).rows[0];
  if (!u || u.status !== 'active') throw new ApiError(403, 'self_excluded', 'account cannot bet');
  const t = (await c.query<{ status: string }>('select status from poker_tables where id = $1 for share', [tableId])).rows[0];
  if (!t || t.status !== 'active') throw conflict('table_not_ready', `table is ${t?.status ?? 'missing'}`);
}

export const BET_LIMITS = { minStakeMinor: 1, maxStakeMinor: 100_000_000 };

export async function placeBet(db: Db, i: PlaceBetInput, ev: EventBatch, modesEnabled: (m: PlayMode) => Promise<boolean>): Promise<BetView> {
  // 1. replay
  const prior = (await db.query('select * from bets where user_id = $1 and idempotency_key = $2', [i.userId, i.idempotencyKey])).rows[0];
  if (prior) return view(prior);

  // 2. validate
  if (!Number.isSafeInteger(i.stakeMinor) || i.stakeMinor < BET_LIMITS.minStakeMinor || i.stakeMinor > BET_LIMITS.maxStakeMinor)
    throw unprocessable('invalid_stake', `stake must be an integer between ${BET_LIMITS.minStakeMinor} and ${BET_LIMITS.maxStakeMinor}`);
  let stats;
  try { stats = statsOf(i.selectionId); } catch { throw unprocessable('unknown_selection', `no selection ${i.selectionId}`); }

  // 3. queue same-process bets on this round (the row lock below is what serialises across processes)
  return withKeyLock(`round:${i.roundId}`, async () => {
    const r = (await db.query<{ id: string; table_id: string; state: string; mode: PlayMode; currency: string }>('select id, table_id, state, mode, currency from rounds where id = $1', [i.roundId])).rows[0];
    if (!r) throw notFound('round');
    // 4. round and table (fast pre-checks; the round state is re-checked under the lock)
    if (r.state !== 'OPEN') throw conflict('round_locked', 'betting on this flop has closed');
    const table = (await db.query<TableRow>('select * from poker_tables where id = $1', [r.table_id])).rows[0]!;
    const ready = await tableReadiness(db, table);
    if (!ready.ok) throw conflict('table_not_ready', ready.problems.join('; '));
    if (!(await modesEnabled(r.mode))) throw conflict('mode_disabled', `mode ${r.mode} is not enabled`);
    const u = (await db.query<{ status: string; kyc_status: string }>('select status, kyc_status from users where id = $1', [i.userId])).rows[0];
    if (!u || u.status !== 'active') throw new ApiError(403, 'self_excluded', 'account cannot bet');
    if ((r.mode === 'real-fiat' || r.mode === 'real-crypto') && u.kyc_status !== 'verified') throw new ApiError(403, 'kyc_required', 'identity verification required for real money');

    // 5. price
    const p = price(stats, i.channel ?? 'direct');
    if (!p.offered) throw unprocessable('not_offered', p.reason ?? 'selection not offered');
    if (p.oddsCenti !== i.oddsCenti && !i.acceptPriceChange) throw conflict('price_changed', 'the price changed', { odds_centi: p.oddsCenti });
    const odds = p.oddsCenti;
    if (payoutMinor(i.stakeMinor, odds) > table.max_round_loss_minor) throw unprocessable('limit_exceeded', 'payout above the table maximum');

    // 6. one transaction in the global lock order: round → user → table → wallet
    const betId = newId('bet');
    const wallet = acct(i.userId, 'wallet', r.mode, r.currency);
    const out = await tx(db, async (c: Tx) => {
      // FOR UPDATE (not FOR SHARE): bets on one round run one at a time on every instance, so
      // the exposure computed below includes every bet committed before this one.
      const st = (await c.query<{ state: string }>('select state from rounds where id = $1 for update', [r.id])).rows[0]!;
      if (st.state !== 'OPEN') throw conflict('round_locked', 'betting on this flop has closed');
      // Real money: the player row is taken exclusively, so a concurrent bet, buy-in or deposit commits
      // strictly before or after this one and the loss limit below sees it.
      const real = r.mode === 'real-fiat' || r.mode === 'real-crypto';
      if (real) await c.query('select 1 from users where id = $1 for update', [i.userId]);
      await assertEligibleInTx(c, i.userId, r.table_id);
      const replay = (await c.query('select * from bets where user_id = $1 and idempotency_key = $2', [i.userId, i.idempotencyKey])).rows[0];
      if (replay) return { replay: true as const, row: replay };
      if (real) await assertLossLimit(c, i.userId, toEurCents(r.currency, i.stakeMinor));
      // exposure, from the database, under the round lock; the table's limit as of now
      const maxLoss = (await c.query<{ max_round_loss_minor: number }>('select max_round_loss_minor from poker_tables where id = $1', [r.table_id])).rows[0]!.max_round_loss_minor;
      if ((await roundLossIfAdded(c, r.id, stats, i.stakeMinor, odds)) > maxLoss) throw unprocessable('limit_exceeded', 'the round has reached its risk limit for this selection');
      await lockAccount(c, wallet);
      if ((await balance(c, wallet)) < i.stakeMinor) throw unprocessable('insufficient_funds', 'balance too low');
      const ins = await c.query(
        `insert into bets (id, idempotency_key, user_id, round_id, selection_id, stake_minor, odds_centi, mode, currency, status, channel, partner_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'accepted', $10, $11)
         on conflict (user_id, idempotency_key) do nothing returning *`,
        [betId, i.idempotencyKey, i.userId, r.id, i.selectionId, i.stakeMinor, odds, r.mode, r.currency, i.channel ?? 'direct', i.partnerId ?? null]);
      if (ins.rowCount !== 1) return { replay: true as const, row: (await c.query('select * from bets where user_id = $1 and idempotency_key = $2', [i.userId, i.idempotencyKey])).rows[0] };
      await post(c, 'bet.stake', betId, [{ from: wallet, to: acct('PreFlop', 'bankroll', r.mode, r.currency), amountMinor: i.stakeMinor }]);
      await audit(c, { type: 'bet.accepted', betId, roundId: r.id, userId: i.userId, selectionId: i.selectionId, stakeMinor: i.stakeMinor, oddsCenti: odds });
      return { replay: false as const, row: ins.rows[0] };
    });
    if (out.replay) return view(out.row);
    // 7. committed: nothing in memory to update, so a failure from here on cannot skew exposure
    hooks.afterCommit?.(betId);
    ev.push({ type: 'bet.accepted', userId: i.userId, roundId: r.id, tableId: r.table_id, data: { betId, selectionId: i.selectionId, stakeMinor: i.stakeMinor, oddsCenti: odds, tableId: r.table_id, roomId: null } });
    return view(out.row);
  });
}

/** Play money: reset the wallet to the starting amount at any time (no fees, no cash value). */
export async function resetPlay(db: Db, userId: string, startMinor: number): Promise<{ balance_minor: number }> {
  return tx(db, async (c) => {
    const wallet = acct(userId, 'wallet', 'play', 'PLAY');
    await lockAccount(c, wallet);
    const b = await balance(c, wallet);
    const diff = startMinor - b;
    const ref = newId('reset');
    const issuance = acct('PreFlop', 'play-issuance', 'play', 'PLAY');
    if (diff > 0) await post(c, 'play.reset', ref, [{ from: issuance, to: wallet, amountMinor: diff }]);
    else if (diff < 0) await post(c, 'play.reset', ref, [{ from: wallet, to: issuance, amountMinor: -diff }]);
    await audit(c, { type: 'play.reset', userId, fromMinor: b, toMinor: startMinor });
    return { balance_minor: startMinor };
  });
}
