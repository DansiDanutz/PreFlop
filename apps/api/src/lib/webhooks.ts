import type { Tx } from './db.ts';
import type { DomainEvent, EventBatch } from './events.ts';
import { newId } from './ids.ts';

/** Event types a partner can subscribe a webhook to (docs/02 §2). */
export const WEBHOOK_EVENTS = ['bet.settled', 'bet.voided', 'round.voided', 'event.finished', 'fee.statement.ready'] as const;
const SUBSCRIBABLE: ReadonlySet<string> = new Set(WEBHOOK_EVENTS);

/**
 * Durable webhook fan-out: queues one webhook_deliveries row per active, subscribed partner
 * webhook, INSIDE the caller's transaction. The delivery commits (or rolls back) atomically with
 * the settlement or void that produced the event, so a crash between commit and fan-out can no
 * longer lose it. deliverDue() (worker) sends the rows later.
 *
 * - round.voided goes to every partner subscribed to it;
 * - bet events go only to the partner whose player placed the bet (data.partnerId).
 *
 * event_id is deterministic (type:round:bet) and (webhook_id, event_id) is unique, so a retried
 * transaction or a repeated call queues nothing twice. Reads only: no row locks are taken, so the
 * global lock order (round → device → user → table → wallets) is unaffected.
 */
export async function enqueueWebhooks(c: Tx, e: DomainEvent): Promise<number> {
  if (!SUBSCRIBABLE.has(e.type)) return 0;
  const broadcast = e.type === 'round.voided';
  const partnerId = (e.data as { partnerId?: string | null }).partnerId ?? null;
  if (!broadcast && !partnerId) return 0; // a direct player's bet: no partner to tell
  // FOR SHARE on each hook until this transaction commits: disabling a hook (an UPDATE of that row)
  // waits for us, then cancels the delivery we queued; or it committed first, and the re-checked
  // `w.active` drops the hook. A delivery is never queued behind a disable's back.
  const hooks = (await c.query<{ id: string }>(
    `select w.id from webhooks w join organizations o on o.id = w.org_id
      where w.active and o.kind = 'partner' and $1 = any(w.events) and ($2::text is null or w.org_id = $2)
      for share of w`,
    [e.type, broadcast ? null : partnerId])).rows;
  if (!hooks.length) return 0;
  const eventId = `${e.type}:${e.roundId ?? ''}:${(e.data as { betId?: string }).betId ?? ''}`;
  const payload = JSON.stringify({ event_id: eventId, type: e.type, round_id: e.roundId ?? null, table_id: e.tableId ?? null, data: e.data, at: new Date().toISOString() });
  let queued = 0;
  for (const h of hooks) {
    const r = await c.query(`insert into webhook_deliveries (id, webhook_id, event_id, event_type, payload) values ($1, $2, $3, $4, $5) on conflict do nothing`,
      [newId('whd'), h.id, eventId, e.type, payload]);
    queued += r.rowCount ?? 0;
  }
  return queued;
}

/** Pushes a domain event for post-commit WebSocket publishing AND queues its webhooks in this transaction. */
export async function emit(c: Tx, ev: EventBatch, e: DomainEvent): Promise<void> {
  ev.push(e);
  await enqueueWebhooks(c, e);
}
