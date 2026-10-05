import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type pg from 'pg';
import type { Db } from './db.ts';

/** A domain event published to WebSocket subscribers and webhooks AFTER its transaction commits. */
export interface DomainEvent {
  type: string;
  tableId?: string;
  roundId?: string;
  userId?: string;
  /** A named stream topic (e.g. `tournament:<id>`) for events that belong to neither a table nor a user. */
  topic?: string;
  data: Record<string, unknown>;
}

/** Collects events inside a transaction; flush() after commit. */
export class EventBatch {
  readonly events: DomainEvent[] = [];
  push(e: DomainEvent): void {
    this.events.push(e);
  }
}

export const bus = new EventEmitter();
bus.setMaxListeners(0);

/**
 * Cross-instance fan-out. The bus above is one process's; a WebSocket client on one API machine
 * must still see a round settled by the worker on another. Every process that publishes also sends
 * its events over PostgreSQL NOTIFY, and every process that serves the stream LISTENs and emits
 * what the others sent on its own bus (its own events are skipped by instance id, since they were
 * emitted locally already). Processes that never call startEventRelay (tests, scripts) keep the
 * in-process behaviour unchanged.
 */
export const INSTANCE_ID = randomBytes(8).toString('hex');
export const EVENTS_CHANNEL = 'preflop_events';
/** NOTIFY payloads are limited to 8000 bytes; a larger event is relayed without its data. */
const MAX_PAYLOAD_BYTES = 7900;

export const relayStats = { forwarded: 0, received: 0, truncated: 0, errors: 0, connected: false };

let relayDb: Db | null = null;

export function publish(batch: EventBatch): void {
  for (const e of batch.events) bus.emit('event', e);
  if (relayDb && batch.events.length) void forward(relayDb, batch.events);
}

/** The wire form of one event; the data is dropped when the event would not fit a NOTIFY payload. */
export function encodeRelayed(e: DomainEvent): string {
  const full = JSON.stringify({ i: INSTANCE_ID, e });
  if (Buffer.byteLength(full) <= MAX_PAYLOAD_BYTES) return full;
  relayStats.truncated++;
  return JSON.stringify({ i: INSTANCE_ID, e: { ...e, data: { truncated: true } } });
}

async function forward(db: Db, events: DomainEvent[]): Promise<void> {
  try {
    await db.query('select pg_notify($1, p) from unnest($2::text[]) as p', [EVENTS_CHANNEL, events.map(encodeRelayed)]);
    relayStats.forwarded += events.length;
  } catch (err) {
    relayStats.errors++;
    console.error('event relay: forwarding failed', err);
  }
}

/**
 * Starts relaying: events published here go out through NOTIFY, and events from other instances
 * come in through a dedicated LISTEN connection (taken from the pool and held; reconnected with
 * backoff when it drops). Returns a stop function.
 */
export async function startEventRelay(db: Db): Promise<() => Promise<void>> {
  relayDb = db;
  let stopped = false;
  let client: pg.PoolClient | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const onNotification = (msg: pg.Notification) => {
    if (msg.channel !== EVENTS_CHANNEL || !msg.payload) return;
    try {
      const { i, e } = JSON.parse(msg.payload) as { i: string; e: DomainEvent };
      if (i === INSTANCE_ID || !e || typeof e.type !== 'string') return;
      relayStats.received++;
      bus.emit('event', e);
    } catch {
      relayStats.errors++;
    }
  };

  const dropped = (c: pg.PoolClient) => {
    if (client !== c) return;
    client = null;
    relayStats.connected = false;
    try { c.release(true); } catch { /* already gone */ }
    if (!stopped) schedule(1);
  };
  const schedule = (attempt: number) => {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
    reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(attempt); }, delay);
  };
  const connect = async (attempt = 0): Promise<void> => {
    if (stopped) return;
    try {
      const c = await db.connect();
      c.on('notification', onNotification);
      c.on('error', () => dropped(c));
      c.on('end', () => dropped(c));
      await c.query(`listen ${EVENTS_CHANNEL}`);
      client = c;
      relayStats.connected = true;
    } catch (err) {
      relayStats.errors++;
      console.error('event relay: listen failed', err);
      schedule(attempt + 1);
    }
  };

  await connect();
  return async () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    relayDb = null;
    const c = client;
    client = null;
    relayStats.connected = false;
    if (c) {
      c.removeAllListeners('notification');
      try { await c.query(`unlisten ${EVENTS_CHANNEL}`); } catch { /* connection may be gone */ }
      c.release();
    }
  };
}
