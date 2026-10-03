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
import { REAL_MODES, maxStakeMinor } from '../lib/limits.ts';
import { assertLossLimit, toEurCents } from '../lib/rg.ts';
import { assertMayBet, assertRealMoneyAccount } from '../lib/accounts.ts';

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

/**
 * What a bet pays if it wins, exactly as settlement computes it: the at-risk part of the stake
 * (the whole stake unless room fees came out of it) at the accepted odds. A pool bet's share is
 * only known at settlement, so it shows 0, as at placement.
 */
export const potentialPayoutMinor = (b: { stake_minor: number; odds_centi: number; at_risk_minor?: number | null; house_kind?: string | null }): number =>
  b.house_kind === 'pool' ? 0 : payoutMinor(b.at_risk_minor ?? b.stake_minor, b.odds_centi);

const view = (b: { id: string; round_id: string; selection_id: string; stake_minor: number; odds_centi: number; at_risk_minor?: number | null; house_kind?: string | null; mode: string; currency: string; status: string }): BetView => ({
  bet_id: b.id, round_id: b.round_id, selection_id: b.selection_id, stake_minor: b.stake_minor, odds_centi: b.odds_centi,
  potential_payout_minor: potentialPayoutMinor(b), mode: b.mode, currency: b.currency, status: b.status,
});

/** A partner's player bets only while the partner organization is active (docs/14, Partner API). */
export const partnerSuspended = () => new ApiError(403, 'partner_suspended', 'the operator of this account is suspended');
/** Real money is taken only at a table the PreFlop team approved for it (docs/14, PreFlop team). */
export const tableNotApproved = () => new ApiError(403, 'table_not_approved', 'this table is not approved for real money');

/**
 * Re-checks, inside the bet transaction, what may have changed since the pre-checks: the account
 * status and its partner's status (rows shared-locked, so a suspension or self-exclusion commits
 * strictly before or after), the table status (a pause takes the table row lock) and, for real
 * money, the table's PreFlop approval (a revoke takes the table row lock too).
 * Lock order: round → user → table → wallet.
 */
export async function assertEligibleInTx(c: Tx, userId: string, tableId: string, opts: { realMoney?: boolean } = {}): Promise<void> {
  const u = (await c.query<{ status: string; partner_id: string | null }>('select status, partner_id from users where id = $1 for share', [userId])).rows[0];
  if (!u || u.status !== 'active') throw new ApiError(403, 'self_excluded', 'account cannot bet');
  if (u.partner_id) {
    const o = (await c.query<{ status: string }>('select status from organizations where id = $1 for share', [u.partner_id])).rows[0];
    if (o?.status !== 'active') throw partnerSuspended();
  }
  const t = (await c.query<{ status: string; real_money_approved_at: Date | null }>('select status, real_money_approved_at from poker_tables where id = $1 for share', [tableId])).rows[0];
  if (!t || t.status !== 'active') throw conflict('table_not_ready', `table is ${t?.status ?? 'missing'}`);
  if (opts.realMoney && !t.real_money_approved_at) throw tableNotApproved();
}

/** The smallest stake; the largest depends on the currency (lib/limits.ts). */
export const BET_LIMITS = { minStakeMinor: 1 };

/**
 * Sum of one player's potential payouts on one round across their PreFlop-house bets, the new one
 * included. Call it under the round lock: every bet that could add to the sum takes that lock first.
 */
export async function userRoundPayoutIfAdded(c: Tx, roundId: string, userId: string, payout: number): Promise<number> {
  const r = (await c.query<{ pay: number }>(
    `select coalesce(sum(stake_minor * odds_centi / 100), 0)::bigint as pay
       from bets where round_id = $1 and user_id = $2 and status = 'accepted' and house_kind = 'preflop'`, [roundId, userId])).rows[0]!;
  return Number(r.pay) + payout;
}

export async function placeBet(db: Db, i: PlaceBetInput, ev: EventBatch, modesEnabled: (m: PlayMode) => Promise<boolean>): Promise<BetView> {
  // 1. replay
  const prior = (await db.query('select * from bets where user_id = $1 and idempotency_key = $2', [i.userId, i.idempotencyKey])).rows[0];
  if (prior) return view(prior);

  // 2. validate
  if (!Number.isSafeInteger(i.stakeMinor) || i.stakeMinor < BET_LIMITS.minStakeMinor)
    throw unprocessable('invalid_stake', `stake must be a whole number of at least ${BET_LIMITS.minStakeMinor}`);
  let stats;
  try { stats = statsOf(i.selectionId); } catch { throw unprocessable('unknown_selection', `no selection ${i.selectionId}`); }

  // 3. queue same-process bets on this round (the row lock below is what serialises across processes)
  return withKeyLock(`round:${i.roundId}`, async () => {
    const r = (await db.query<{ id: string; table_id: string; state: string; mode: PlayMode; currency: string }>('select id, table_id, state, mode, currency from rounds where id = $1', [i.roundId])).rows[0];
    if (!r) throw notFound('round');
    const real = REAL_MODES.has(r.mode);
    // The largest stake is per currency (lib/limits.ts): 10,000 EUR is not 10,000 micro-USDT.
    const maxStake = maxStakeMinor(r.currency);
    if (i.stakeMinor > maxStake) throw unprocessable('invalid_stake', `stake must be at most ${maxStake} (${r.currency} minor units)`);
    // 4. round and table (fast pre-checks; the round state is re-checked under the lock)
    if (r.state !== 'OPEN') throw conflict('round_locked', 'betting on this flop has closed');
    const table = (await db.query<TableRow>('select * from poker_tables where id = $1', [r.table_id])).rows[0]!;
    const ready = await tableReadiness(db, table);
    if (!ready.ok) throw conflict('table_not_ready', ready.problems.join('; '));
    if (!(await modesEnabled(r.mode))) throw conflict('mode_disabled', `mode ${r.mode} is not enabled`);
    if (real && !table.real_money_approved_at) throw tableNotApproved();
    const u = (await db.query<{ status: string; kyc_status: string; partner_id: string | null; partner_status: string | null; country: string | null; date_of_birth: string | null }>(
      `select u.status, u.kyc_status, u.partner_id, o.status as partner_status, u.country, to_char(u.date_of_birth, 'YYYY-MM-DD') as date_of_birth
         from users u left join organizations o on o.id = u.partner_id where u.id = $1`, [i.userId])).rows[0];
    if (!u || u.status !== 'active') throw new ApiError(403, 'self_excluded', 'account cannot bet');
    // Every mode and every channel (player app, partner API): no bets under 18 or from a blocked country.
    await assertMayBet(db, u);
    if (u.partner_id && u.partner_status !== 'active') throw partnerSuspended();
    if (real && u.kyc_status !== 'verified') throw new ApiError(403, 'kyc_required', 'identity verification required for real money');
    if (real) await assertRealMoneyAccount(db, i.userId); // age, verified email, territory

    // 5. price
    const p = price(stats, i.channel ?? 'direct');
    if (!p.offered) throw unprocessable('not_offered', p.reason ?? 'selection not offered');
    if (p.oddsCenti !== i.oddsCenti && !i.acceptPriceChange) throw conflict('price_changed', 'the price changed', { odds_centi: p.oddsCenti });
    const odds = p.oddsCenti;
    const payout = payoutMinor(i.stakeMinor, odds);
    if (payout > table.max_round_loss_minor) throw unprocessable('limit_exceeded', 'payout above the table maximum');

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
      if (real) await c.query('select 1 from users where id = $1 for update', [i.userId]);
      await assertEligibleInTx(c, i.userId, r.table_id, { realMoney: real });
      const replay = (await c.query('select * from bets where user_id = $1 and idempotency_key = $2', [i.userId, i.idempotencyKey])).rows[0];
      if (replay) return { replay: true as const, row: replay };
      if (real) await assertLossLimit(c, i.userId, toEurCents(r.currency, i.stakeMinor));
      // exposure, from the database, under the round lock; the table's limits as of now
      const lim = (await c.query<{ max_round_loss_minor: number; max_user_round_payout_minor: number | null }>(
        'select max_round_loss_minor, max_user_round_payout_minor from poker_tables where id = $1', [r.table_id])).rows[0]!;
      // One player's potential payouts on this round, all their bets together (docs/04 §3). The round
      // lock above serialises every PreFlop-house bet on the round, in every mode, so the sum is exact.
      const userCap = lim.max_user_round_payout_minor ?? lim.max_round_loss_minor;
      if ((await userRoundPayoutIfAdded(c, r.id, i.userId, payout)) > userCap)
        throw new ApiError(403, 'user_round_limit', 'your bets on this flop would pay more than the per-player maximum', { max_payout_minor: userCap });
      if ((await roundLossIfAdded(c, r.id, stats, i.stakeMinor, odds)) > lim.max_round_loss_minor) throw unprocessable('limit_exceeded', 'the round has reached its risk limit for this selection');
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
