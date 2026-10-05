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

export const relayStats = { forwarded: 0, received: 0, truncated: 0, errors: 0, connected: false, gaps: 0, dropped: 0, queued: 0 };
/** Outbound events waiting for NOTIFY to succeed; bounded, oldest dropped first (and counted). */
const MAX_OUTBOUND = 2000;
const MAX_ATTEMPTS = 8;

/**
 * Emitted on this process's bus when its listener reconnects after a drop: notifications sent by
 * other instances while it was down are gone, so the stream closes its sockets (code 1012) and the
 * clients reconnect and refetch what the events would have patched, exactly as they do after a
 * socket drop of their own. A gap is never silent.
 */
export const RELAY_GAP: DomainEvent = { type: 'relay.gap', data: {} };

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

const outbound: string[] = [];
let draining = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Queues the events and drains the queue in order. A failed NOTIFY (pool exhausted, connection
 * lost) is retried with backoff rather than dropped: the other instances' listeners are healthy and
 * would otherwise never hear of these events. Only after MAX_ATTEMPTS, or when the queue overflows,
 * are events dropped, and then counted in relayStats.dropped and logged.
 */
async function forward(db: Db, events: DomainEvent[]): Promise<void> {
  for (const e of events) outbound.push(encodeRelayed(e));
  if (outbound.length > MAX_OUTBOUND) {
    const n = outbound.length - MAX_OUTBOUND;
    outbound.splice(0, n);
    relayStats.dropped += n;
    console.error(`event relay: outbound queue full, dropped ${n} oldest events`);
  }
  relayStats.queued = outbound.length;
  if (draining) return;
  draining = true;
  let attempt = 0;
  try {
    while (outbound.length && relayDb === db) {
      const batch = outbound.slice(0, 200);
      try {
        await db.query('select pg_notify($1, p) from unnest($2::text[]) as p', [EVENTS_CHANNEL, batch]);
        outbound.splice(0, batch.length);
        relayStats.forwarded += batch.length;
        attempt = 0;
      } catch (err) {
        relayStats.errors++;
        attempt++;
        if (attempt >= MAX_ATTEMPTS) {
          outbound.splice(0, batch.length);
          relayStats.dropped += batch.length;
          console.error(`event relay: forwarding failed ${attempt} times, dropped ${batch.length} events`, err);
          attempt = 0;
        } else {
          await sleep(Math.min(5000, 50 * 2 ** attempt));
        }
      }
      relayStats.queued = outbound.length;
    }
  } finally {
    draining = false;
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
  let wasConnected = false;

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
    let c: pg.PoolClient | null = null;
    try {
      c = await db.connect();
      await c.query(`listen ${EVENTS_CHANNEL}`);
      c.on('notification', onNotification);
      c.on('error', () => dropped(c!));
      c.on('end', () => dropped(c!));
      client = c;
      relayStats.connected = true;
      if (wasConnected) {
        // Back after a drop: whatever the other instances sent meanwhile is lost; tell the stream.
        relayStats.gaps++;
        bus.emit('event', RELAY_GAP);
      }
      wasConnected = true;
    } catch (err) {
      // A client acquired but not listening goes back to the pool; a leak here would starve the API.
      if (c) { try { c.release(true); } catch { /* already gone */ } }
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
