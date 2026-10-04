import { audit } from '../lib/audit.ts';
import type { Tx } from '../lib/db.ts';
import { conflict } from '../lib/errors.ts';
import type { EventBatch } from '../lib/events.ts';
import { tableReadiness } from './readiness.ts';
import { type RoundRow, ensureOpenRound, event, getTable, parseThreeCards, settleRound } from './service.ts';

/**
 * Manual tables (migration 020): the PreFlop team closes betting and types the flop in the console,
 * instead of a Table Box capturing it. Free play only. The flop can be typed only once betting has
 * closed, so nobody can enter cards while bets are still coming in; an unentered flop is voided and
 * refunded by the result deadline like any other round.
 */
async function manualTable(c: Tx, r: RoundRow) {
  const t = await getTable(c, r.table_id);
  if (t.kind !== 'manual') throw conflict('not_manual_table', 'only a manual table takes a typed flop');
  return t;
}

/** Close betting: OPEN → LOCKED. */
export async function manualLock(c: Tx, r: RoundRow, userId: string, ev: EventBatch): Promise<{ state: 'LOCKED' }> {
  const t = await manualTable(c, r);
  if (r.state !== 'OPEN') throw conflict('invalid_round_state', `round is ${r.state}`);
  const ready = await tableReadiness(c, t);
  if (!ready.ok) throw conflict('table_not_ready', ready.problems.join('; '));
  await c.query(`update rounds set state = 'LOCKED', locked_at = clock_timestamp(), procedure_step = 'locked' where id = $1`, [r.id]);
  await event(c, r.id, 'lock', `user:${userId}`);
  await audit(c, { type: 'round.locked', roundId: r.id, by: `user:${userId}`, manual: true });
  ev.push({ type: 'round.locked', tableId: r.table_id, roundId: r.id, data: { handNo: r.hand_no } });
  return { state: 'LOCKED' };
}

/** Typed flop: LOCKED → DEALT → SETTLED in one transaction, then the next round opens. */
export async function manualFlop(c: Tx, r: RoundRow, cards: unknown, userId: string, ev: EventBatch): Promise<{ state: 'SETTLED'; cards: string[]; next_round_id: string | null }> {
  await manualTable(c, r);
  if (r.state !== 'LOCKED') throw conflict('invalid_round_state', r.state === 'OPEN' ? 'close betting before entering the flop' : `round is ${r.state}`);
  const valid = parseThreeCards(cards);
  await c.query(`update rounds set state = 'DEALT', deal_start_at = clock_timestamp(), procedure_step = 'dealing', flop_source = 'manual' where id = $1`, [r.id]);
  await event(c, r.id, 'manual_flop', `user:${userId}`);
  await audit(c, { type: 'round.manual_flop', roundId: r.id, cards: valid, by: `user:${userId}` });
  ev.push({ type: 'round.dealt', tableId: r.table_id, roundId: r.id, data: { handNo: r.hand_no, cards: valid } });
  const ok = await settleRound(c, { ...r, state: 'DEALT' }, valid, 'DEALT', `user:${userId}`, ev);
  if (!ok) throw conflict('invalid_round_state', 'the round changed while settling; reload');
  return { state: 'SETTLED', cards: valid, next_round_id: await ensureOpenRound(c, r.table_id, ev) };
}
