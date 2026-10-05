import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { tx } from '../src/lib/db.ts';
import { RELAY_GAP, bus } from '../src/lib/events.ts';
import { STREAM_MAX_PAYLOAD, streamTuning } from '../src/routes/stream.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness } from './helpers.ts';

/** WS /v1/stream connection health: frame size limit, ping/pong liveness, slow-client cut-off. */
let h: Harness;
let url: string;
let admin: string;
const defaults = { ...streamTuning };

beforeAll(async () => {
  h = await harness('stream_health');
  await tx(h.db, (c) => seedAdmin(c, 'admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'admin@test.dev', password: 'admin-pass-1' })).body.token;
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  url = `ws://127.0.0.1:${(h.app.server.address() as AddressInfo).port}/v1/stream`;
});
afterEach(() => Object.assign(streamTuning, defaults));
afterAll(async () => h?.close());

type Frame = { type: string; [k: string]: unknown };
function connect(opts: { autoPong?: boolean } = {}) {
  const ws = new WebSocket(url, { autoPong: opts.autoPong ?? true });
  const frames: Frame[] = [];
  ws.on('message', (b: Buffer) => frames.push(JSON.parse(b.toString()) as Frame));
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  const opened = new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
  return { ws, frames, closed, opened };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('WS /v1/stream connection health', () => {
  it('closes a socket that sends a frame larger than 4 KB (1009) and keeps normal frames working', async () => {
    expect(STREAM_MAX_PAYLOAD).toBe(4096);
    const ok = connect();
    await ok.opened;
    ok.ws.send(JSON.stringify({ subscribe: ['lobby'] }));
    await sleep(100);
    expect(ok.frames.some((f) => f.type === 'subscribed')).toBe(true);
    ok.ws.close();

    const big = connect();
    await big.opened;
    big.ws.send(JSON.stringify({ subscribe: ['x'.repeat(5000)] }));
    expect(await big.closed).toBe(1009);
  });

  it('follows at most 50 well-formed topics per socket; anything else is ignored', async () => {
    const s = connect();
    await s.opened;
    s.ws.send(JSON.stringify({ subscribe: ['lobby', 'drop table rounds', 'table:', 'x'.repeat(200), 123, ...Array.from({ length: 60 }, (_, i) => `table:t-${i}`)] }));
    await sleep(100);
    const sub = s.frames.find((f) => f.type === 'subscribed') as { topics: string[] } | undefined;
    expect(sub?.topics).toHaveLength(50);
    expect(sub?.topics).toContain('lobby');
    expect(sub?.topics.every((t) => /^(lobby|table:t-\d+)$/.test(t))).toBe(true);
    s.ws.close();
  });

  it('a relay gap closes every socket with 1012 so clients reconnect and refetch', async () => {
    const a = connect();
    const b = connect();
    await Promise.all([a.opened, b.opened]);
    a.ws.send(JSON.stringify({ subscribe: ['lobby'] }));
    await sleep(50);
    bus.emit('event', RELAY_GAP);
    expect(await a.closed).toBe(1012);
    expect(await b.closed).toBe(1012);
    // Nothing was sent as an event frame.
    expect(a.frames.some((f) => f.type === 'relay.gap')).toBe(false);
  });

  it('pings every interval and terminates a socket that misses a pong', async () => {
    streamTuning.pingMs = 60;
    const healthy = connect();
    const silent = connect({ autoPong: false });
    await Promise.all([healthy.opened, silent.opened]);
    let pings = 0;
    healthy.ws.on('ping', () => { pings++; });
    // A missed pong is noticed at the next ping: two intervals and a bit.
    const code = await Promise.race([silent.closed, sleep(1000).then(() => -1)]);
    expect(code).toBe(1006); // terminated, no close handshake
    await sleep(200);
    expect(pings).toBeGreaterThanOrEqual(2);
    expect(healthy.ws.readyState).toBe(WebSocket.OPEN);
    healthy.ws.close();
  });

  it('cuts off a client whose send buffer is over the limit instead of buffering without bound', async () => {
    streamTuning.maxBufferedBytes = -1; // every send sees a "full" buffer
    const slow = connect();
    await slow.opened;
    const code = await Promise.race([slow.closed, sleep(1000).then(() => -1)]);
    expect(code).toBe(1006);
    expect(slow.frames).toHaveLength(0); // not even "hello" was queued
  });

  it('counts the cut-off sockets out of ws_clients', async () => {
    await sleep(100);
    const m = await h.api('GET', '/v1/admin/metrics', admin);
    expect(m.status).toBe(200);
    expect(m.body.instance.ws_clients).toBe(0);
  });
});
