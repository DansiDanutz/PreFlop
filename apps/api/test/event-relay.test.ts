import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db.ts';
import { type DomainEvent, EVENTS_CHANNEL, EventBatch, INSTANCE_ID, bus, encodeRelayed, publish, relayStats, startEventRelay } from '../src/lib/events.ts';

/**
 * The cross-instance event relay (lib/events.ts) against a fake pool: a listener that fails to
 * LISTEN gives its connection back, a reconnect after a drop announces the gap, and the wire form
 * stays within NOTIFY's payload limit.
 */
class FakeClient extends EventEmitter {
  released: boolean[] = [];
  constructor(private readonly listenFails: boolean) { super(); }
  async query(sql: string, params?: unknown[]) {
    if (/^listen /.test(sql) && this.listenFails) throw new Error('LISTEN refused');
    if (sql.includes('pg_notify') && this.pool.notifyFailures > 0) { this.pool.notifyFailures--; throw new Error('pool exhausted'); }
    if (sql.includes('pg_notify')) {
      // Deliver to every listening client of the pool, as PostgreSQL would.
      for (const payload of (params![1] as string[])) for (const c of this.pool.listeners) c.emit('notification', { channel: EVENTS_CHANNEL, payload });
    }
    return { rows: [] };
  }
  release(destroy?: boolean) { this.released.push(!!destroy); this.pool.checkedOut--; }
  pool!: FakePool;
}
class FakePool {
  checkedOut = 0;
  clients: FakeClient[] = [];
  listeners: FakeClient[] = [];
  failNext = 0;
  /** How many NOTIFY queries fail before they succeed again. */
  notifyFailures = 0;
  async connect() {
    const c = new FakeClient(this.failNext > 0);
    this.failNext = Math.max(0, this.failNext - 1);
    c.pool = this;
    this.checkedOut++;
    this.clients.push(c);
    if (!c['listenFails']) this.listeners.push(c);
    return c;
  }
  async query(sql: string, params?: unknown[]) { return this.clients.at(-1)!.query(sql, params); }
}
const asDb = (p: FakePool) => p as unknown as Db;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('event relay', () => {
  it('releases the connection when LISTEN fails, then retries and connects', async () => {
    const pool = new FakePool();
    pool.failNext = 1;
    const stop = await startEventRelay(asDb(pool));
    try {
      expect(pool.clients).toHaveLength(1);
      expect(pool.clients[0]!.released).toEqual([true]); // destroyed, not kept checked out
      expect(pool.checkedOut).toBe(0);
      expect(relayStats.connected).toBe(false);
      await sleep(1200); // first retry after ~1 s
      expect(relayStats.connected).toBe(true);
      expect(pool.checkedOut).toBe(1);
    } finally { await stop(); }
    expect(pool.checkedOut).toBe(0);
  });

  it('announces a gap on the bus when the listener reconnects after a drop, and never doubles its own events', async () => {
    const pool = new FakePool();
    const seen: DomainEvent[] = [];
    const onEvent = (e: DomainEvent) => { seen.push(e); };
    bus.on('event', onEvent);
    const stop = await startEventRelay(asDb(pool));
    try {
      const batch = new EventBatch();
      batch.push({ type: 'round.locked', tableId: 't1', roundId: 'r1', data: {} });
      publish(batch);
      await sleep(20);
      // Emitted locally once; the notification carried our own instance id and was skipped.
      expect(seen.filter((e) => e.type === 'round.locked')).toHaveLength(1);
      // Another instance's notification is emitted.
      pool.listeners[0]!.emit('notification', { channel: EVENTS_CHANNEL, payload: JSON.stringify({ i: 'other', e: { type: 'round.settled', tableId: 't1', roundId: 'r1', data: {} } }) });
      expect(seen.filter((e) => e.type === 'round.settled')).toHaveLength(1);
      // The connection drops: the relay reconnects and announces the gap.
      const gaps = relayStats.gaps;
      pool.listeners[0]!.emit('end');
      expect(relayStats.connected).toBe(false);
      await sleep(1300);
      expect(relayStats.connected).toBe(true);
      expect(relayStats.gaps).toBe(gaps + 1);
      expect(seen.filter((e) => e.type === 'relay.gap')).toHaveLength(1);
    } finally { await stop(); bus.off('event', onEvent); }
  });

  it('retries a failed NOTIFY with backoff instead of dropping the event', async () => {
    const pool = new FakePool();
    const seen: DomainEvent[] = [];
    const onEvent = (e: DomainEvent) => { seen.push(e); };
    bus.on('event', onEvent);
    const stop = await startEventRelay(asDb(pool));
    try {
      pool.notifyFailures = 2;
      const forwarded = relayStats.forwarded;
      const batch = new EventBatch();
      batch.push({ type: 'round.settled', tableId: 't1', roundId: 'r9', data: {} });
      publish(batch);
      await sleep(50);
      expect(relayStats.forwarded).toBe(forwarded); // still retrying
      await sleep(600); // backoff: 100 ms then 200 ms, then the third attempt succeeds
      expect(relayStats.forwarded).toBe(forwarded + 1);
      expect(relayStats.queued).toBe(0);
      expect(pool.notifyFailures).toBe(0);
    } finally { await stop(); bus.off('event', onEvent); }
  });

  it('an overflow while a NOTIFY is in flight drops queued events, never the in-flight ones', async () => {
    const pool = new FakePool();
    const stop = await startEventRelay(asDb(pool));
    try {
      // Hold the first NOTIFY open, then flood the queue past its limit while it is in flight.
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const client = pool.listeners[0]!;
      const realQuery = client.query.bind(client);
      let held = 0;
      client.query = async (sql: string, params?: unknown[]) => {
        if (sql.includes('pg_notify') && held++ === 0) await gate;
        return realQuery(sql, params);
      };
      const first = new EventBatch();
      first.push({ type: 'round.locked', tableId: 'held', roundId: 'r1', data: {} });
      publish(first);
      await sleep(10);
      const flood = new EventBatch();
      for (let i = 0; i < 2500; i++) flood.push({ type: 'round.opened', tableId: 'flood', roundId: `r${i}`, data: {} });
      const forwardedBefore = relayStats.forwarded;
      const droppedBefore = relayStats.dropped;
      publish(flood);
      expect(relayStats.dropped - droppedBefore).toBe(501); // 1 in flight + 2500 queued - 2000 limit
      release();
      await sleep(100);
      // Everything still queued was sent, and the held event counted as forwarded, not dropped.
      expect(relayStats.forwarded - forwardedBefore).toBe(1 + 2500 - 501);
      expect(relayStats.queued).toBe(0);
    } finally { await stop(); }
  });

  it('keeps every relayed payload under the NOTIFY limit by dropping oversized data', () => {
    const small = encodeRelayed({ type: 'round.dealt', tableId: 't', roundId: 'r', data: { cards: ['Ah', 'Kd', '7c'] } });
    expect(JSON.parse(small)).toMatchObject({ i: INSTANCE_ID, e: { type: 'round.dealt', data: { cards: ['Ah', 'Kd', '7c'] } } });
    const big = encodeRelayed({ type: 'tournament.standings', topic: 'tournament:x', data: { rows: 'x'.repeat(9000) } });
    expect(Buffer.byteLength(big)).toBeLessThan(8000);
    expect(JSON.parse(big).e.data).toEqual({ truncated: true });
  });
});
