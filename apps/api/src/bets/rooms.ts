import {
  GLOBAL_RULES, MIN_ODDS_CENTI, type PlayMode, RoundExposure, assertOrganizerBet, oddsForMargin, payoutMinor,
  platformFeeMinor, splitDiamondBet, validateDiamondRules, validateOrganizerHouse,
} from '@preflop/odds-engine';
import { audit } from '../lib/audit.ts';
import { type Db, type Tx, tx } from '../lib/db.ts';
import { ApiError, conflict, notFound, unprocessable } from '../lib/errors.ts';
import type { EventBatch } from '../lib/events.ts';
import { newId } from '../lib/ids.ts';
import { type Transfer, acct, balance, lockAccount, post, walletPurpose } from '../lib/ledger.ts';
import { type TableRow, tableReadiness } from '../rounds/readiness.ts';
import { poolAccount } from '../rounds/service.ts';
import { type BetView, assertEligibleInTx, statsOf, withKeyLock } from './service.ts';

/**
 * Rooms: books run by an organizer or club in virtual chips or diamonds (docs/08, docs/10).
 *
 * - house 'organizer': the organizer's collateral is the house. Odds use the room's margin;
 *   PreFlop takes a platform fee per bet (chips: % of stake, paid by the collateral; diamonds:
 *   1 ◆ from the stake). Every bet is admitted only if the collateral covers the worst-case
 *   outgo of every open round of that organizer (OrganizerCollateral semantics).
 * - house 'pool': players play against each other; the room's rake and PreFlop's fee are
 *   taken at placement and the rest goes into the round's pool (parimutuel at settlement).
 *
 * Balances are a closed loop per organization: players hold `<user>:wallet-<org>:<mode>:<cur>`.
 */

export interface RoomRules {
  margin_bps: number;
  min_stake_minor: number;
  rake_bps?: number;
  provider_share_bps?: number;
}

export interface RoomRow {
  id: string;
  org_id: string;
  name: string;
  table_id: string;
  mode: 'virtual-chips' | 'diamonds';
  currency: string;
  house: 'organizer' | 'pool';
  rules: RoomRules;
  status: string;
  visibility: string;
  invite_code: string | null;
}

export const ROOM_CURRENCY: Record<RoomRow['mode'], string> = { 'virtual-chips': 'CHIP', diamonds: 'DIAMOND' };

/** Validates room rules against PreFlop's global rules; returns problems (empty = ok). */
export function validateRoomRules(mode: PlayMode, house: 'organizer' | 'pool', r: RoomRules): { ok: boolean; problems: string[]; organizer_ev?: number; fee_rate_bound?: number } {
  const problems: string[] = [];
  if (mode !== 'virtual-chips' && mode !== 'diamonds') problems.push('rooms run in virtual chips or diamonds');
  if (!Number.isSafeInteger(r.min_stake_minor) || r.min_stake_minor < 1) problems.push('minimum stake must be a positive whole number');
  if (house === 'organizer') {
    if (!Number.isInteger(r.margin_bps) || r.margin_bps < GLOBAL_RULES.organizerMinMarginBps || r.margin_bps > 3000)
      problems.push(`margin must be ${GLOBAL_RULES.organizerMinMarginBps}–3000 bps`);
  }
  if (mode === 'diamonds') {
    problems.push(...validateDiamondRules({ rakeBps: r.rake_bps ?? 0, minStake: r.min_stake_minor, rakeShares: [{ role: 'organizer', party: 'organizer', bps: 10000 }] }));
  } else if (house === 'pool') {
    const rk = r.rake_bps ?? 0;
    if (rk < GLOBAL_RULES.poolRakeBpsMin || rk > GLOBAL_RULES.poolRakeBpsMax) problems.push(`pool rake must be ${GLOBAL_RULES.poolRakeBpsMin}–${GLOBAL_RULES.poolRakeBpsMax} bps`);
  }
  let organizer_ev: number | undefined;
  let fee_rate_bound: number | undefined;
  if (house === 'organizer' && mode === 'virtual-chips' && problems.length === 0) {
    const v = validateOrganizerHouse({ mode, marginBps: r.margin_bps, platformFee: GLOBAL_RULES.platformFee, providerShareBps: r.provider_share_bps ?? 0, minStakeMinor: r.min_stake_minor });
    problems.push(...v.problems);
    organizer_ev = v.organizerEv;
    fee_rate_bound = v.platformFeeRate;
  }
  if (house === 'organizer' && mode === 'diamonds' && problems.length === 0) {
    // At-risk part plays at the room margin; the 1 ◆ fee is paid by the player, not the house.
    organizer_ev = (r.margin_bps / 10000) * (1 - (r.provider_share_bps ?? 0) / 10000);
    fee_rate_bound = 0;
    if (organizer_ev * 10000 < GLOBAL_RULES.organizerMinEvBps)
      problems.push(`organizer EV ${(organizer_ev * 100).toFixed(2)}% is below the required ${(GLOBAL_RULES.organizerMinEvBps / 100).toFixed(2)}% — lower the provider share or raise the margin`);
  }
  if (r.provider_share_bps !== undefined && (!Number.isInteger(r.provider_share_bps) || r.provider_share_bps < 0 || r.provider_share_bps > 10000))
    problems.push('provider share must be 0–10000 bps');
  return { ok: problems.length === 0, problems, ...(organizer_ev !== undefined ? { organizer_ev } : {}), ...(fee_rate_bound !== undefined ? { fee_rate_bound } : {}) };
}

/** Odds a room offers on a selection (organizer house), or null if not offered. */
export function roomOdds(room: Pick<RoomRow, 'house' | 'rules'>, wins: number): number | null {
  if (room.house === 'pool') return 100;
  if (wins <= 0) return null;
  const o = oddsForMargin(wins, room.rules.margin_bps);
  return o >= MIN_ODDS_CENTI ? o : null;
}

/** Worst-case outgo of all unsettled rounds of an organizer house in one currency (+ the extra bet). */
async function collateralReserved(c: Tx | Db, orgId: string, currency: string, extra?: { roundId: string; selectionId: string; atRisk: number; odds: number }): Promise<number> {
  const rows = (await c.query<{ round_id: string; selection_id: string; stake: number; odds_centi: number }>(
    `select b.round_id, b.selection_id, coalesce(b.at_risk_minor, b.stake_minor) as stake, b.odds_centi
       from bets b join rounds r on r.id = b.round_id
      where b.house_kind = 'organizer' and b.house_owner = $1 and b.currency = $2 and b.status = 'accepted'
        and r.state in ('OPEN','LOCKED','DEALT','REVIEW','EVIDENCE_REJECTED')`, [orgId, currency])).rows;
  const byRound = new Map<string, RoundExposure>();
  const add = (rid: string, sel: string, stake: number, odds: number) => {
    let e = byRound.get(rid);
    if (!e) { e = new RoundExposure(Number.MAX_SAFE_INTEGER); byRound.set(rid, e); }
    e.tryAdd(statsOf(sel), stake, odds);
  };
  for (const r of rows) add(r.round_id, r.selection_id, r.stake, r.odds_centi);
  if (extra) add(extra.roundId, extra.selectionId, extra.atRisk, extra.odds);
  let reserved = 0;
  for (const e of byRound.values()) reserved += Math.max(0, e.totalStakesMinor - e.minNet().netMinor);
  return reserved;
}

export async function orgCollateralReserved(db: Db, orgId: string, currency: string): Promise<number> {
  return collateralReserved(db, orgId, currency);
}

export interface RoomBetInput {
  userId: string;
  idempotencyKey: string;
  roomId: string;
  roundId: string;
  selectionId: string;
  stakeMinor: number;
  oddsCenti: number;
  acceptPriceChange?: boolean;
}

export async function placeRoomBet(db: Db, i: RoomBetInput, ev: EventBatch, modeEnabled: (m: PlayMode) => Promise<boolean>): Promise<BetView> {
  const prior = (await db.query('select * from bets where user_id = $1 and idempotency_key = $2', [i.userId, i.idempotencyKey])).rows[0];
  if (prior) return { bet_id: prior.id, round_id: prior.round_id, selection_id: prior.selection_id, stake_minor: prior.stake_minor, odds_centi: prior.odds_centi, potential_payout_minor: prior.house_kind === 'pool' ? 0 : payoutMinor(prior.at_risk_minor ?? prior.stake_minor, prior.odds_centi), mode: prior.mode, currency: prior.currency, status: prior.status };

  const room = (await db.query<RoomRow>('select * from rooms where id = $1', [i.roomId])).rows[0];
  if (!room) throw notFound('room');
  if (room.status !== 'active') throw conflict('room_closed', `room is ${room.status}`);
  // Rules are re-validated on every bet, so a room created under older rules can never take a bet
  // that breaks the current global floors.
  const valid = validateRoomRules(room.mode, room.house, room.rules);
  if (!valid.ok) throw conflict('room_rules_invalid', `room rules no longer pass the global rules: ${valid.problems.join('; ')}`);
  const org = (await db.query<{ status: string }>('select status from organizations where id = $1', [room.org_id])).rows[0];
  if (org?.status !== 'active') throw conflict('room_closed', 'organizer is not active');
  if (room.visibility === 'invite') {
    const m = await db.query('select 1 from room_members where room_id = $1 and user_id = $2', [room.id, i.userId]);
    if (!m.rowCount) throw new ApiError(403, 'not_a_member', 'join this room with its invite code first');
  }
  if (!(await modeEnabled(room.mode))) throw conflict('mode_disabled', `mode ${room.mode} is not enabled`);
  if (!Number.isSafeInteger(i.stakeMinor) || i.stakeMinor < room.rules.min_stake_minor) throw unprocessable('invalid_stake', `minimum stake is ${room.rules.min_stake_minor}`);
  let stats;
  try { stats = statsOf(i.selectionId); } catch { throw unprocessable('unknown_selection', `no selection ${i.selectionId}`); }
  const odds = roomOdds(room, stats.wins);
  if (odds === null) throw unprocessable('not_offered', 'selection not offered in this room');
  if (room.house === 'organizer' && odds !== i.oddsCenti && !i.acceptPriceChange) throw conflict('price_changed', 'the price changed', { odds_centi: odds });

  const u = (await db.query<{ status: string }>('select status from users where id = $1', [i.userId])).rows[0];
  if (!u || u.status !== 'active') throw new ApiError(403, 'self_excluded', 'account cannot bet');

  // Split the stake (all integer, exact): fee to PreFlop, rake to the organizer, at-risk to house/pool.
  const mode = room.mode as PlayMode;
  const cur = room.currency;
  let feeFromStake = 0, feeFromCollateral = 0, rake = 0;
  if (mode === 'diamonds') {
    const split = splitDiamondBet(i.stakeMinor, { rakeBps: room.rules.rake_bps ?? 0, minStake: room.rules.min_stake_minor, rakeShares: [{ role: 'organizer', party: room.org_id, bps: 10000 }] });
    feeFromStake = split.preflopFee;
    rake = split.rake;
  } else if (room.house === 'organizer') {
    feeFromCollateral = platformFeeMinor(mode, i.stakeMinor, GLOBAL_RULES.platformFee);
    assertOrganizerBet({ mode, marginBps: room.rules.margin_bps, platformFee: GLOBAL_RULES.platformFee, providerShareBps: room.rules.provider_share_bps ?? 0, minStakeMinor: room.rules.min_stake_minor }, stats, i.stakeMinor, odds);
  } else {
    feeFromStake = platformFeeMinor(mode, i.stakeMinor, GLOBAL_RULES.platformFee);
    rake = Math.floor((i.stakeMinor * (room.rules.rake_bps ?? 0)) / 10000);
  }
  const atRisk = i.stakeMinor - feeFromStake - rake;
  if (atRisk <= 0) throw unprocessable('invalid_stake', 'stake too small for the room fees');

  const lockKey = room.house === 'organizer' ? `collateral:${room.org_id}:${cur}` : `round:${i.roundId}`;
  return withKeyLock(lockKey, async () => {
    const r = (await db.query<{ id: string; table_id: string; state: string }>('select id, table_id, state from rounds where id = $1', [i.roundId])).rows[0];
    if (!r) throw notFound('round');
    if (r.table_id !== room.table_id) throw unprocessable('wrong_table', 'this round is not at the room\'s table');
    if (r.state !== 'OPEN') throw conflict('round_locked', 'betting on this flop has closed');
    const table = (await db.query<TableRow>('select * from poker_tables where id = $1', [r.table_id])).rows[0]!;
    const ready = await tableReadiness(db, table);
    if (!ready.ok) throw conflict('table_not_ready', ready.problems.join('; '));

    const betId = newId('bet');
    const wallet = acct(i.userId, walletPurpose(room.org_id), mode, cur);
    const collateral = acct(room.org_id, 'collateral', mode, cur);
    const treasury = acct(room.org_id, 'treasury', mode, cur);
    const fees = acct('PreFlop', 'platform-fees', mode, cur);
    const pool = poolAccount(room.id, mode, cur);

    const row = await tx(db, async (c) => {
      const st = (await c.query<{ state: string }>('select state from rounds where id = $1 for share', [r.id])).rows[0]!;
      if (st.state !== 'OPEN') throw conflict('round_locked', 'betting on this flop has closed');
      await assertEligibleInTx(c, i.userId, r.table_id);
      // wallets in ascending id order
      for (const a of [wallet, ...(room.house === 'organizer' ? [collateral] : [])].sort()) await lockAccount(c, a);
      if ((await balance(c, wallet)) < i.stakeMinor) throw unprocessable('insufficient_funds', 'balance too low');
      if (room.house === 'organizer') {
        const reserved = await collateralReserved(c, room.org_id, cur, { roundId: r.id, selectionId: i.selectionId, atRisk, odds });
        const after = (await balance(c, collateral)) + atRisk - feeFromCollateral;
        if (reserved > after) throw unprocessable('house_limit', 'the organizer\'s collateral cannot cover this bet');
      }
      const ins = await c.query(
        `insert into bets (id, idempotency_key, user_id, round_id, selection_id, stake_minor, odds_centi, mode, currency, status, house_kind, house_owner, room_id, at_risk_minor, fee_minor, channel)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'accepted', $10, $11, $12, $13, $14, 'contest-user')
         on conflict (user_id, idempotency_key) do nothing returning *`,
        [betId, i.idempotencyKey, i.userId, r.id, i.selectionId, i.stakeMinor, odds, mode, cur, room.house, room.org_id, room.id, atRisk, feeFromStake + feeFromCollateral]);
      if (ins.rowCount !== 1) return (await c.query('select * from bets where user_id = $1 and idempotency_key = $2', [i.userId, i.idempotencyKey])).rows[0];
      const transfers: Transfer[] = [
        { from: wallet, to: room.house === 'organizer' ? collateral : pool, amountMinor: atRisk },
        { from: wallet, to: fees, amountMinor: feeFromStake },
        { from: wallet, to: treasury, amountMinor: rake },
        { from: collateral, to: fees, amountMinor: feeFromCollateral },
      ];
      await post(c, 'bet.stake', betId, transfers);
      await c.query('insert into room_members (room_id, user_id) values ($1, $2) on conflict do nothing', [room.id, i.userId]);
      await audit(c, { type: 'bet.accepted', betId, roundId: r.id, roomId: room.id, userId: i.userId, selectionId: i.selectionId, stakeMinor: i.stakeMinor, atRiskMinor: atRisk, oddsCenti: odds });
      return ins.rows[0];
    });
    ev.push({ type: 'bet.accepted', userId: i.userId, roundId: r.id, tableId: r.table_id, data: { betId: row.id, selectionId: i.selectionId, stakeMinor: i.stakeMinor, oddsCenti: odds, tableId: r.table_id, roomId: room.id } });
    return { bet_id: row.id, round_id: row.round_id, selection_id: row.selection_id, stake_minor: row.stake_minor, odds_centi: row.odds_centi, potential_payout_minor: room.house === 'pool' ? 0 : payoutMinor(atRisk, odds), mode: row.mode, currency: row.currency, status: row.status };
  });
}
