import { type Flop, MODES, type PlayMode, price, settle } from '@preflop/odds-engine';
import { statsOf } from '../bets/service.ts';
import { audit } from '../lib/audit.ts';
import { type Db, type Tx, tx } from '../lib/db.ts';
import { ApiError, conflict, forbidden, notFound, unprocessable } from '../lib/errors.ts';
import { EventBatch, publish } from '../lib/events.ts';
import { newId } from '../lib/ids.ts';
import { acct, balance, lockAccount, post, walletPurpose } from '../lib/ledger.ts';
import { type TableRow, tableReadiness } from '../rounds/readiness.ts';
import { CLOSED_LOOP_MODES, REAL_MODES, assertBoardModeAllowed, modeEnabled } from './leaderboards.ts';

/**
 * Tournaments (docs/17). A buy-in buys a stack of tournament points and a fixed number of bets on
 * live flops. Points never touch the ledger: only buy-ins, the added prize, the fee, prizes and
 * refunds are money, each a balanced post with a unique (kind, ref). Lock order everywhere:
 * round → tournament (shared) → entry for bets, round → entry for settlement, and
 * tournament → entry / wallet for registration, completion and cancelling.
 */

export interface TournamentRow {
  id: string; owner_org: string | null; name: string; description: string; mode: PlayMode; currency: string;
  buy_in_minor: string; fee_bps: number; added_minor: string; added_from: string | null;
  starting_stack: string; bets_allowed: number; min_stake: string; max_stake: string | null;
  starts_at: Date; ends_at: Date; late_reg_minutes: number; min_entries: number; max_entries: number | null;
  payout_bps: number[]; status: 'open' | 'completed' | 'cancelled'; cancel_reason: string | null;
  created_by: string; created_at: Date; completed_at: Date | null;
}
export type Phase = 'scheduled' | 'running' | 'settling' | 'completed' | 'cancelled';
export type EntryStatus = 'playing' | 'busted' | 'finished';

export const LIMITS = { maxPlaces: 50, maxFeeBps: 2000, minMinutes: 5, maxMinutes: 7 * 24 * 60, maxBets: 500 } as const;

const n = (v: string | number | null): number => Number(v ?? 0);
export const poolAccount = (t: Pick<TournamentRow, 'id' | 'mode' | 'currency'>) => acct(t.id, 'pool', t.mode, t.currency);
/** Free chips and real money live in the player's own wallet; chips and diamonds in the owner's closed loop. */
export const walletFor = (t: Pick<TournamentRow, 'mode' | 'currency' | 'owner_org'>, userId: string) =>
  acct(userId, CLOSED_LOOP_MODES.has(t.mode) ? walletPurpose(t.owner_org) : 'wallet', t.mode, t.currency);
const feeAccount = (t: Pick<TournamentRow, 'mode' | 'currency' | 'owner_org'>) =>
  t.owner_org ? acct(t.owner_org, 'treasury', t.mode, t.currency) : acct('PreFlop', 'platform-fees', t.mode, t.currency);

export const lateRegUntil = (t: Pick<TournamentRow, 'starts_at' | 'late_reg_minutes'>) => new Date(t.starts_at.getTime() + t.late_reg_minutes * 60_000);

/** The phase comes from the clock, so it is exact between worker ticks. */
export function phaseOf(t: Pick<TournamentRow, 'status' | 'starts_at' | 'ends_at'>, now = new Date()): Phase {
  if (t.status !== 'open') return t.status;
  if (now < t.starts_at) return 'scheduled';
  if (now < t.ends_at) return 'running';
  return 'settling';
}

// ------------------------------------------------------------------ pure rules (unit tested)

export interface RankInput { user_id: string; stack: number; bets_used: number; created_at: Date }

/** Biggest stack first; on the same stack fewer bets used; the same stack and bets used share the position. */
export function rankEntries<T extends RankInput>(entries: T[]): (T & { rank: number })[] {
  const sorted = [...entries].sort((a, b) => b.stack - a.stack || a.bets_used - b.bets_used || a.created_at.getTime() - b.created_at.getTime());
  let rank = 0;
  return sorted.map((e, i) => {
    const prev = sorted[i - 1];
    if (!prev || prev.stack !== e.stack || prev.bets_used !== e.bets_used) rank = i + 1;
    return { ...e, rank };
  });
}

/**
 * Splits the prize pool by final position. With fewer entrants than paid places the shares that
 * exist are scaled to 100%; tied players split the shares of the positions they occupy equally.
 * Every unit is paid: rounding goes to the first position, and inside a tie to the earliest entrant.
 */
export function allocatePrizes(pool: number, payoutBps: number[], ranked: { user_id: string; rank: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  const places = Math.min(payoutBps.length, ranked.length);
  if (places === 0 || pool <= 0) return out;
  const shares = payoutBps.slice(0, places);
  const total = shares.reduce((a, b) => a + b, 0);
  const byPosition = shares.map((s) => Math.floor((pool * s) / total));
  byPosition[0]! += pool - byPosition.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ranked.length;) {
    const rank = ranked[i]!.rank;
    let j = i;
    while (j < ranked.length && ranked[j]!.rank === rank) j++;
    const group = ranked.slice(i, j);
    const amount = byPosition.slice(i, Math.min(j, places)).reduce((a, b) => a + b, 0);
    const each = Math.floor(amount / group.length);
    group.forEach((g, k) => { if (amount > 0) out.set(g.user_id, each + (k === 0 ? amount - each * group.length : 0)); });
    i = j;
  }
  return out;
}

/** Status once nothing waits for a flop: out below the minimum stake, finished with every bet used. */
export function settledStatus(stack: number, betsUsed: number, minStake: number, betsAllowed: number): EntryStatus {
  if (stack < minStake) return 'busted';
  if (betsUsed >= betsAllowed) return 'finished';
  return 'playing';
}

// ------------------------------------------------------------------ creating

export interface TournamentInput {
  name: string; description?: string | undefined; mode: PlayMode; currency: string;
  buy_in_minor: number; fee_bps: number; added_minor?: number | undefined;
  starting_stack: number; bets_allowed: number; min_stake: number; max_stake?: number | null | undefined;
  starts_at: Date; duration_minutes: number; late_reg_minutes?: number | undefined;
  min_entries?: number | undefined; max_entries?: number | null | undefined; payout_bps: number[];
}

export async function createTournament(c: Tx, b: TournamentInput, ownerOrg: string | null, by: string, now = new Date()): Promise<TournamentRow> {
  if (!MODES[b.mode].currencies.includes(b.currency)) throw unprocessable('invalid_currency', `${b.currency} is not a ${b.mode} currency`);
  if (ownerOrg && !CLOSED_LOOP_MODES.has(b.mode)) throw forbidden('mode_not_allowed', 'organizations run chip and diamond tournaments');
  if (!ownerOrg && CLOSED_LOOP_MODES.has(b.mode)) throw unprocessable('org_required', 'chips and diamonds belong to one organization; its portal creates the tournament');
  await assertBoardModeAllowed(c, b.mode);
  if (b.payout_bps.length < 1 || b.payout_bps.length > LIMITS.maxPlaces || b.payout_bps.some((x) => !Number.isInteger(x) || x <= 0)
    || b.payout_bps.reduce((a, x) => a + x, 0) !== 10_000) throw unprocessable('invalid_payouts', 'payout shares are positive and add up to 100% (10,000 bps)');
  if (b.fee_bps < 0 || b.fee_bps > LIMITS.maxFeeBps) throw unprocessable('invalid_fee', 'the fee is 0–20%');
  if (b.buy_in_minor === 0 && b.fee_bps > 0) throw unprocessable('invalid_fee', 'a freeroll has no fee');
  if (b.duration_minutes < LIMITS.minMinutes || b.duration_minutes > LIMITS.maxMinutes) throw unprocessable('invalid_duration', 'a tournament runs 5 minutes to 7 days');
  if (b.starts_at.getTime() < now.getTime() - 60_000) throw unprocessable('invalid_start', 'the start is in the past');
  if (b.min_stake > b.starting_stack) throw unprocessable('invalid_stake', 'the minimum stake is above the starting stack');
  if (b.max_stake != null && b.max_stake < b.min_stake) throw unprocessable('invalid_stake', 'the maximum stake is below the minimum');
  if ((b.late_reg_minutes ?? 0) >= b.duration_minutes) throw unprocessable('invalid_late_reg', 'late registration closes before the end');
  if (b.max_entries != null && b.max_entries < (b.min_entries ?? 2)) throw unprocessable('invalid_entries', 'the maximum is below the minimum entries');

  const id = newId('trn');
  const ends = new Date(b.starts_at.getTime() + b.duration_minutes * 60_000);
  const added = b.added_minor ?? 0;
  let addedFrom: string | null = null;
  if (added > 0) {
    if (ownerOrg) {
      addedFrom = acct(ownerOrg, 'treasury', b.mode, b.currency);
      await lockAccount(c, addedFrom);
      if ((await balance(c, addedFrom)) < added) throw unprocessable('insufficient_treasury', 'the treasury does not hold the added prize');
    } else {
      addedFrom = b.mode === 'play' ? acct('PreFlop', 'play-issuance', 'play', 'PLAY') : acct('PreFlop', 'marketing', b.mode, b.currency);
    }
  }
  const row = (await c.query<TournamentRow>(
    `insert into tournaments (id, owner_org, name, description, mode, currency, buy_in_minor, fee_bps, added_minor, added_from, starting_stack,
       bets_allowed, min_stake, max_stake, starts_at, ends_at, late_reg_minutes, min_entries, max_entries, payout_bps, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) returning *`,
    [id, ownerOrg, b.name, b.description ?? '', b.mode, b.currency, b.buy_in_minor, b.fee_bps, added, addedFrom, b.starting_stack,
      b.bets_allowed, b.min_stake, b.max_stake ?? null, b.starts_at, ends, b.late_reg_minutes ?? 0, b.min_entries ?? 2, b.max_entries ?? null, b.payout_bps, by])).rows[0]!;
  if (added > 0) await post(c, 'tournament.added', id, [{ from: addedFrom!, to: poolAccount(row), amountMinor: added }]);
  await audit(c, { type: 'tournament.created', tournamentId: id, ownerOrg, mode: b.mode, buyInMinor: b.buy_in_minor, by });
  return row;
}

export async function lockTournament(c: Tx, id: string): Promise<TournamentRow> {
  const t = (await c.query<TournamentRow>('select * from tournaments where id = $1 for update', [id])).rows[0];
  if (!t) throw notFound('tournament');
  return t;
}

// ------------------------------------------------------------------ registering

export async function register(c: Tx, id: string, userId: string, ev: EventBatch, now = new Date()): Promise<void> {
  // The tournament row lock serialises registrations, so the cap holds under concurrency.
  const t = await lockTournament(c, id);
  if (t.status !== 'open' || now >= lateRegUntil(t) || now >= t.ends_at) throw conflict('registration_closed', 'registration is closed');
  if (!(await modeEnabled(c, t.mode))) throw forbidden('mode_disabled', `${t.mode} is switched off`);
  const u = (await c.query<{ status: string; kyc_status: string }>('select status, kyc_status from users where id = $1', [userId])).rows[0];
  if (!u || u.status !== 'active') throw new ApiError(403, 'self_excluded', 'this account cannot play');
  if (REAL_MODES.has(t.mode) && u.kyc_status !== 'verified') throw new ApiError(403, 'kyc_required', 'identity verification required for real money');
  if ((await c.query('select 1 from tournament_entries where tournament_id = $1 and user_id = $2', [id, userId])).rowCount) throw conflict('already_registered', 'you are already registered');
  const count = Number((await c.query<{ n: string }>('select count(*) as n from tournament_entries where tournament_id = $1', [id])).rows[0]!.n);
  if (t.max_entries != null && count >= t.max_entries) throw conflict('tournament_full', 'the tournament is full');
  const buyIn = n(t.buy_in_minor);
  const ref = newId('tbi');
  if (buyIn > 0) {
    const wallet = walletFor(t, userId);
    await lockAccount(c, wallet);
    if ((await balance(c, wallet)) < buyIn) throw unprocessable('insufficient_funds', 'your balance does not cover the buy-in');
    await post(c, 'tournament.buyin', ref, [{ from: wallet, to: poolAccount(t), amountMinor: buyIn }]);
  }
  await c.query('insert into tournament_entries (tournament_id, user_id, stack, buy_in_minor, buy_in_ref) values ($1, $2, $3, $4, $5)',
    [id, userId, n(t.starting_stack), buyIn, ref]);
  await audit(c, { type: 'tournament.registered', tournamentId: id, userId, buyInMinor: buyIn });
  changed(ev, id);
}

/** Before the start a player may leave with the buy-in back. */
export async function unregister(c: Tx, id: string, userId: string, ev: EventBatch, now = new Date()): Promise<number> {
  const t = await lockTournament(c, id);
  if (t.status !== 'open' || now >= t.starts_at) throw conflict('registration_closed', 'you can leave only before the start');
  const e = (await c.query<{ buy_in_minor: string; buy_in_ref: string }>('delete from tournament_entries where tournament_id = $1 and user_id = $2 returning buy_in_minor, buy_in_ref', [id, userId])).rows[0];
  if (!e) throw notFound('registration');
  const amount = n(e.buy_in_minor);
  if (amount > 0) await post(c, 'tournament.refund', e.buy_in_ref, [{ from: poolAccount(t), to: walletFor(t, userId), amountMinor: amount }]);
  await audit(c, { type: 'tournament.unregistered', tournamentId: id, userId, refundMinor: amount });
  changed(ev, id);
  return amount;
}

// ------------------------------------------------------------------ betting

export interface TournamentBetInput { roundId: string; selectionId: string; stake: number; oddsCenti: number; acceptPriceChange?: boolean | undefined; idempotencyKey: string }

interface TBetRow { id: string; tournament_id: string; user_id: string; round_id: string; selection_id: string; stake: string; odds_centi: number; status: string; payout: string | null; created_at: Date; settled_at: Date | null }

export async function placeTournamentBet(db: Db, id: string, userId: string, i: TournamentBetInput, ev: EventBatch, now = new Date()): Promise<TBetRow & { table_id: string }> {
  const replay = (await db.query<TBetRow & { table_id: string }>(
    'select b.*, r.table_id from tournament_bets b join rounds r on r.id = b.round_id where b.tournament_id = $1 and b.user_id = $2 and b.idempotency_key = $3',
    [id, userId, i.idempotencyKey])).rows[0];
  if (replay) return replay;
  if (!Number.isSafeInteger(i.stake) || i.stake <= 0) throw unprocessable('invalid_stake', 'the stake is a positive whole number of points');
  let stats;
  try { stats = statsOf(i.selectionId); } catch { throw unprocessable('unknown_selection', `no selection ${i.selectionId}`); }
  const p = price(stats, 'direct');
  if (!p.offered) throw unprocessable('not_offered', p.reason ?? 'selection not offered');
  if (p.oddsCenti !== i.oddsCenti && !i.acceptPriceChange) throw conflict('price_changed', 'the price changed', { odds_centi: p.oddsCenti });

  const out = await tx(db, async (c) => {
    // Lock order: round, then entry, exactly as settlement takes them.
    const r = (await c.query<{ state: string; table_id: string }>('select state, table_id from rounds where id = $1 for update', [i.roundId])).rows[0];
    if (!r) throw notFound('round');
    if (r.state !== 'OPEN') throw conflict('round_locked', 'betting on this flop has closed');
    const table = (await c.query<TableRow>('select * from poker_tables where id = $1', [r.table_id])).rows[0]!;
    const ready = await tableReadiness(c, table);
    if (!ready.ok) throw conflict('table_not_ready', ready.problems.join('; '));
    // Shared lock: completion and cancelling (exclusive) wait for bets in flight, and vice versa.
    const t = (await c.query<TournamentRow>('select * from tournaments where id = $1 for share', [id])).rows[0];
    if (!t) throw notFound('tournament');
    if (phaseOf(t, now) !== 'running') throw conflict('tournament_not_running', 'bets are accepted only while the tournament runs');
    // Eligibility is rechecked on every bet, not only at registration: the mode may have been switched
    // off, or the account suspended, self-excluded or (real money) its identity check rejected since.
    if (!(await modeEnabled(c, t.mode))) throw forbidden('mode_disabled', `${t.mode} is switched off`);
    const u = (await c.query<{ status: string; kyc_status: string }>('select status, kyc_status from users where id = $1', [userId])).rows[0];
    if (!u || u.status !== 'active') throw new ApiError(403, 'self_excluded', 'this account cannot play');
    if (REAL_MODES.has(t.mode) && u.kyc_status !== 'verified') throw new ApiError(403, 'kyc_required', 'identity verification required for real money');
    const entries = Number((await c.query<{ n: string }>('select count(*) as n from tournament_entries where tournament_id = $1', [id])).rows[0]!.n);
    if (entries < t.min_entries) throw conflict('not_enough_players', 'the tournament has not reached its minimum entries');
    const e = (await c.query<{ stack: string; bets_used: number; status: EntryStatus }>(
      'select stack, bets_used, status from tournament_entries where tournament_id = $1 and user_id = $2 for update', [id, userId])).rows[0];
    if (!e) throw forbidden('not_registered', 'register for the tournament first');
    const again = (await c.query<TBetRow>('select * from tournament_bets where tournament_id = $1 and user_id = $2 and idempotency_key = $3', [id, userId, i.idempotencyKey])).rows[0];
    if (again) return { row: again, tableId: r.table_id, replay: true };
    if (e.status === 'busted') throw conflict('entry_busted', 'your stack is gone: you are out of the tournament');
    if (e.bets_used >= t.bets_allowed) throw conflict('no_bets_left', 'you have used every bet');
    const stack = n(e.stack);
    if (i.stake < n(t.min_stake) || (t.max_stake != null && i.stake > n(t.max_stake))) {
      throw unprocessable('invalid_stake', `the stake is ${n(t.min_stake)}${t.max_stake != null ? `–${n(t.max_stake)}` : ' or more'} points`);
    }
    if (i.stake > stack) throw unprocessable('stake_too_high', 'the stake is above your stack');
    if ((await c.query('select 1 from tournament_bets where tournament_id = $1 and user_id = $2 and round_id = $3', [id, userId, i.roundId])).rowCount) {
      throw conflict('one_bet_per_flop', 'you already have a bet on this flop');
    }
    const betId = newId('tbet');
    const row = (await c.query<TBetRow>(
      `insert into tournament_bets (id, tournament_id, user_id, round_id, idempotency_key, selection_id, stake, odds_centi)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [betId, id, userId, i.roundId, i.idempotencyKey, i.selectionId, i.stake, p.oddsCenti])).rows[0]!;
    await c.query('update tournament_entries set stack = stack - $3, bets_used = bets_used + 1 where tournament_id = $1 and user_id = $2', [id, userId, i.stake]);
    await audit(c, { type: 'tournament.bet', tournamentId: id, betId, userId, roundId: i.roundId, selectionId: i.selectionId, stake: i.stake, oddsCenti: p.oddsCenti });
    return { row, tableId: r.table_id, replay: false };
  });
  if (!out.replay) changed(ev, id);
  return { ...out.row, table_id: out.tableId };
}

/** Live standings changed: subscribers of `tournament:<id>` refetch. */
function changed(ev: EventBatch, id: string): void {
  if (!ev.events.some((e) => e.type === 'tournament.standings' && e.data.tournament_id === id)) {
    ev.push({ type: 'tournament.standings', topic: `tournament:${id}`, data: { tournament_id: id } });
  }
}

/** After a flop settles or voids, an entry with nothing pending may be out or finished. */
async function refreshStatus(c: Tx, tournamentId: string, userId: string): Promise<void> {
  const pending = (await c.query('select 1 from tournament_bets where tournament_id = $1 and user_id = $2 and status = $3 limit 1', [tournamentId, userId, 'accepted'])).rowCount;
  if (pending) return;
  const e = (await c.query<{ stack: string; bets_used: number; status: string; min_stake: string; bets_allowed: number }>(
    `select e.stack, e.bets_used, e.status, t.min_stake, t.bets_allowed from tournament_entries e join tournaments t on t.id = e.tournament_id
      where e.tournament_id = $1 and e.user_id = $2`, [tournamentId, userId])).rows[0]!;
  const next = settledStatus(n(e.stack), e.bets_used, n(e.min_stake), e.bets_allowed);
  if (next !== e.status) {
    await c.query(`update tournament_entries set status = $3, out_at = case when $3 = 'playing' then null else clock_timestamp() end where tournament_id = $1 and user_id = $2`,
      [tournamentId, userId, next]);
  }
}

/** Called by settleRound, under the round lock, in the same transaction. */
export async function settleTournamentBets(c: Tx, roundId: string, flop: Flop, ev: EventBatch): Promise<void> {
  const bets = (await c.query<TBetRow>(`select * from tournament_bets where round_id = $1 and status = 'accepted' order by tournament_id, user_id`, [roundId])).rows;
  for (const b of bets) {
    await c.query('select 1 from tournament_entries where tournament_id = $1 and user_id = $2 for update', [b.tournament_id, b.user_id]);
    const s = settle({ betId: b.id, selectionId: b.selection_id, stakeMinor: n(b.stake), oddsCenti: b.odds_centi }, flop);
    const payout = s.status === 'won' ? s.payoutMinor : s.status === 'void' ? n(b.stake) : 0;
    await c.query(`update tournament_bets set status = $2, payout = $3, settled_at = clock_timestamp() where id = $1 and status = 'accepted'`, [b.id, s.status, payout]);
    // A void selection (engine rule) gives the stake and the bet back.
    await c.query(`update tournament_entries set stack = stack + $3, bets_used = bets_used - $4 where tournament_id = $1 and user_id = $2`,
      [b.tournament_id, b.user_id, payout, s.status === 'void' ? 1 : 0]);
    await refreshStatus(c, b.tournament_id, b.user_id);
    ev.push({ type: 'tournament.bet_settled', userId: b.user_id, data: { tournament_id: b.tournament_id, bet_id: b.id, status: s.status, payout } });
    changed(ev, b.tournament_id);
  }
}

/** Called by voidRound: the stake and the bet go back to the entrant. */
export async function voidTournamentBets(c: Tx, roundId: string, ev: EventBatch): Promise<void> {
  const bets = (await c.query<TBetRow>(`select * from tournament_bets where round_id = $1 and status = 'accepted' order by tournament_id, user_id`, [roundId])).rows;
  for (const b of bets) {
    await c.query('select 1 from tournament_entries where tournament_id = $1 and user_id = $2 for update', [b.tournament_id, b.user_id]);
    await c.query(`update tournament_bets set status = 'void', payout = stake, settled_at = clock_timestamp() where id = $1 and status = 'accepted'`, [b.id]);
    await c.query('update tournament_entries set stack = stack + $3, bets_used = bets_used - 1 where tournament_id = $1 and user_id = $2', [b.tournament_id, b.user_id, n(b.stake)]);
    await refreshStatus(c, b.tournament_id, b.user_id);
    ev.push({ type: 'tournament.bet_settled', userId: b.user_id, data: { tournament_id: b.tournament_id, bet_id: b.id, status: 'void', payout: n(b.stake) } });
    changed(ev, b.tournament_id);
  }
}

// ------------------------------------------------------------------ standings, completion, cancelling

export interface StandingRow { user_id: string; display_name: string; stack: number; bets_used: number; pending: number; status: EntryStatus; prize_minor: number | null; final_rank: number | null; created_at: Date }

export async function entriesOf(c: Pick<Db, 'query'>, id: string): Promise<StandingRow[]> {
  const rows = (await c.query<{ user_id: string; display_name: string; stack: string; bets_used: number; pending: string; status: EntryStatus; prize_minor: string | null; final_rank: number | null; created_at: Date }>(
    `select e.user_id, u.display_name, e.stack, e.bets_used, e.status, e.prize_minor, e.final_rank, e.created_at,
            (select count(*) from tournament_bets b where b.tournament_id = e.tournament_id and b.user_id = e.user_id and b.status = 'accepted') as pending
       from tournament_entries e join users u on u.id = e.user_id where e.tournament_id = $1`, [id])).rows;
  return rows.map((r) => ({ ...r, stack: n(r.stack), pending: n(r.pending), prize_minor: r.prize_minor === null ? null : n(r.prize_minor) }));
}

/**
 * Who may take a prize. Real money pays active, identity-verified players only: anyone else steps
 * aside and the prize ranks close up (their overall position stands). Other modes pay every entrant.
 */
export async function prizeEligible<T extends { user_id: string }>(c: Pick<Db, 'query'>, t: Pick<TournamentRow, 'mode'>, entries: T[]): Promise<T[]> {
  if (!REAL_MODES.has(t.mode)) return entries;
  const ok = new Set((await c.query<{ id: string }>(`select id from users where id = any($1) and status = 'active' and kyc_status = 'verified'`,
    [entries.map((e) => e.user_id)])).rows.map((r) => r.id));
  return entries.filter((e) => ok.has(e.user_id));
}

/** Buy-ins after the fee, plus the added prize. */
export function prizePoolOf(t: Pick<TournamentRow, 'fee_bps' | 'added_minor'>, buyIns: number): { fee: number; pool: number } {
  const fee = Math.floor((buyIns * t.fee_bps) / 10_000);
  return { fee, pool: buyIns - fee + n(t.added_minor) };
}

/**
 * Closes an ended tournament once every bet placed in time has settled: ranks, pays the prizes
 * and the fee, awards badges. Idempotent: a closed tournament is skipped.
 */
export async function complete(c: Tx, id: string, ev: EventBatch, now = new Date()): Promise<boolean> {
  const t = await lockTournament(c, id);
  if (t.status !== 'open' || now < t.ends_at) return false;
  // A real-money tournament waits while its mode is off; the team can cancel it to refund everyone.
  if (REAL_MODES.has(t.mode) && !(await modeEnabled(c, t.mode))) return false;
  if ((await c.query(`select 1 from tournament_bets where tournament_id = $1 and status = 'accepted' limit 1`, [id])).rowCount) return false;
  await c.query('select 1 from tournament_entries where tournament_id = $1 order by user_id for update', [id]);
  const entries = await entriesOf(c, id);
  if (entries.length < t.min_entries) { await cancelLocked(c, t, 'not enough players', 'system', ev); return true; }
  const buyIns = (await c.query<{ s: string }>('select coalesce(sum(buy_in_minor), 0) as s from tournament_entries where tournament_id = $1', [id])).rows[0]!.s;
  const { fee, pool } = prizePoolOf(t, n(buyIns));
  const ranked = rankEntries(entries);
  const prizes = allocatePrizes(pool, t.payout_bps, rankEntries(await prizeEligible(c, t, entries)));
  if (fee > 0) await post(c, 'tournament.fee', id, [{ from: poolAccount(t), to: feeAccount(t), amountMinor: fee }]);
  for (const e of ranked) {
    const prize = prizes.get(e.user_id) ?? 0;
    if (prize > 0) await post(c, 'tournament.payout', `${id}:${e.user_id}`, [{ from: poolAccount(t), to: walletFor(t, e.user_id), amountMinor: prize }]);
    await c.query(`update tournament_entries set final_rank = $3, prize_minor = $4,
                     status = case when status = 'playing' then 'finished' else status end where tournament_id = $1 and user_id = $2`, [id, e.user_id, e.rank, prize]);
    if (e.rank <= 3) {
      const kind = e.rank === 1 ? 'champion' : 'podium';
      await c.query('insert into badges (id, user_id, kind, tournament_id, label) values ($1, $2, $3, $4, $5) on conflict do nothing',
        [newId('bdg'), e.user_id, kind, id, `${kind === 'champion' ? 'Champion' : 'Podium'} · ${t.name}`]);
    }
  }
  const left = await balance(c, poolAccount(t));
  if (left !== 0) throw new Error(`tournament ${id}: pool left at ${left} after completion`);
  await c.query(`update tournaments set status = 'completed', completed_at = now() where id = $1`, [id]);
  await audit(c, { type: 'tournament.completed', tournamentId: id, entries: entries.length, pool, fee, winners: [...prizes.keys()].length });
  changed(ev, id);
  return true;
}

async function cancelLocked(c: Tx, t: TournamentRow, reason: string, by: string, ev: EventBatch): Promise<void> {
  const entries = (await c.query<{ user_id: string; buy_in_minor: string; buy_in_ref: string }>(
    'select user_id, buy_in_minor, buy_in_ref from tournament_entries where tournament_id = $1 order by user_id for update', [t.id])).rows;
  for (const e of entries) {
    if (n(e.buy_in_minor) > 0) await post(c, 'tournament.refund', e.buy_in_ref, [{ from: poolAccount(t), to: walletFor(t, e.user_id), amountMinor: n(e.buy_in_minor) }]);
  }
  if (n(t.added_minor) > 0 && t.added_from) await post(c, 'tournament.added_return', t.id, [{ from: poolAccount(t), to: t.added_from, amountMinor: n(t.added_minor) }]);
  // Points have no value: open bets simply stop counting.
  await c.query(`update tournament_bets set status = 'void', payout = stake, settled_at = clock_timestamp() where tournament_id = $1 and status = 'accepted'`, [t.id]);
  await c.query(`update tournaments set status = 'cancelled', cancel_reason = $2, completed_at = now() where id = $1`, [t.id, reason]);
  await audit(c, { type: 'tournament.cancelled', tournamentId: t.id, reason, refunds: entries.length, by });
  changed(ev, t.id);
}

export async function cancel(c: Tx, id: string, reason: string, by: string, ev: EventBatch): Promise<void> {
  const t = await lockTournament(c, id);
  if (t.status !== 'open') throw conflict('tournament_closed', `the tournament is ${t.status}`);
  await cancelLocked(c, t, reason, by, ev);
}

/** Worker: cancel tournaments that started short of players, complete those that ended and settled. */
export async function tournamentTick(db: Db, now = new Date()): Promise<{ completed: number; cancelled: number }> {
  let completed = 0, cancelled = 0;
  const open = (await db.query<{ id: string; started: boolean; ended: boolean; short: boolean }>(
    `select t.id, t.starts_at <= $1 as started, t.ends_at <= $1 as ended,
            (select count(*) from tournament_entries e where e.tournament_id = t.id) < t.min_entries as short
       from tournaments t where t.status = 'open' and t.starts_at <= $1 order by t.ends_at`, [now])).rows;
  for (const t of open) {
    const ev = new EventBatch();
    try {
      if (t.short && t.started && !t.ended) {
        await tx(db, async (c) => {
          const row = await lockTournament(c, t.id);
          if (row.status !== 'open') return;
          const count = Number((await c.query<{ n: string }>('select count(*) as n from tournament_entries where tournament_id = $1', [t.id])).rows[0]!.n);
          // Late registration may still fill it; past that window it is cancelled.
          if (count < row.min_entries && now >= lateRegUntil(row)) { await cancelLocked(c, row, 'not enough players', 'system', ev); cancelled++; }
        });
      } else if (t.ended && (await tx(db, (c) => complete(c, t.id, ev, now)))) completed++;
      publish(ev);
    } catch (e) {
      console.error('tournament worker', t.id, e);
    }
  }
  return { completed, cancelled };
}
