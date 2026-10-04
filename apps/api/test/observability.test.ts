import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createPool, retryStats, tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { beat, nextDelayMs, startWorker, sweepOnce } from '../src/worker.ts';
import { type Harness, harness } from './helpers.ts';

let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await harness('observability');
  await tx(h.db, (c) => seedAdmin(c, 'ops@test.dev', 'Ops-Pass-2026!'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'ops@test.dev', password: 'Ops-Pass-2026!' })).body.token;
});
afterAll(async () => h?.close());

const metrics = async () => {
  const r = await h.api('GET', '/v1/admin/metrics', admin);
  expect(r.status).toBe(200);
  return r.body;
};

describe('request id', () => {
  it('is generated when absent and echoed back', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/v1/health' });
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const r2 = await h.app.inject({ method: 'GET', url: '/v1/health' });
    expect(r2.headers['x-request-id']).not.toBe(r.headers['x-request-id']);
  });

  it("keeps the caller's id, on errors too, but replaces an unsafe one", async () => {
    const ok = await h.app.inject({ method: 'GET', url: '/v1/health', headers: { 'x-request-id': 'lb-7f3a.42' } });
    expect(ok.headers['x-request-id']).toBe('lb-7f3a.42');
    const err = await h.app.inject({ method: 'GET', url: '/v1/me', headers: { 'x-request-id': 'trace-401' } });
    expect(err.statusCode).toBe(401);
    expect(err.headers['x-request-id']).toBe('trace-401');
    const bad = await h.app.inject({ method: 'GET', url: '/v1/health', headers: { 'x-request-id': 'x\ny injected log line' } });
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is on every log line of the request', async () => {
    const stream = new PassThrough();
    const lines: any[] = [];
    stream.on('data', (b: Buffer) => { for (const l of b.toString().split('\n').filter(Boolean)) lines.push(JSON.parse(l)); });
    const app = await buildApp(h.db, h.config, { logStream: stream });
    await app.inject({ method: 'GET', url: '/v1/health', headers: { 'x-request-id': 'log-check-1' } });
    await app.close();
    const mine = lines.filter((l) => l.request_id === 'log-check-1');
    expect(mine.map((l) => l.msg)).toEqual(['incoming request', 'request completed']);
  });
});

describe('health', () => {
  it('liveness never depends on the database or the worker', async () => {
    expect((await h.api('GET', '/v1/health')).status).toBe(200);
  });

  it('readiness is 503 without a fresh worker heartbeat, 200 with one', async () => {
    await h.db.query('delete from worker_heartbeats');
    const r = await h.app.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(r.statusCode).toBe(503);
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(r.json()).toMatchObject({ type: 'not_ready', status: 503, checks: { database: { ok: true }, worker: { ok: false, last_beat_age_ms: null } } });

    await beat(h.db, 'test-worker');
    const ok = await h.api('GET', '/v1/health/ready');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ready: true, checks: { database: { ok: true }, worker: { ok: true } } });

    await h.db.query(`update worker_heartbeats set beat_at = now() - interval '1 minute'`);
    const stale = await h.api('GET', '/v1/health/ready');
    expect(stale.status).toBe(503);
    expect(stale.body.title).toMatch(/no fresh worker heartbeat/);
    expect(stale.body.checks.worker.last_beat_age_ms).toBeGreaterThan(59_000);
  });

  it('readiness is 503 when the database is unreachable', async () => {
    const dead = createPool('postgres://postgres@127.0.0.1:1/none', 1);
    const app = await buildApp(dead, h.config);
    const r = await app.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ type: 'not_ready', checks: { database: { ok: false } } });
    expect(r.json().title).toMatch(/database unreachable/);
    expect((await app.inject({ method: 'GET', url: '/v1/health' })).statusCode).toBe(200);
    await app.close();
    await dead.end();
  });

  it('an idle worker backs off to the idle cadence and returns to the fast one on the next error or job', async () => {
    expect(nextDelayMs(true, 1000, 5000)).toBe(1000);
    expect(nextDelayMs(false, 1000, 5000)).toBe(5000);
    expect(nextDelayMs(false, 1000, 10)).toBe(1000); // the idle wait is never shorter than the fast one
    // Nothing to do here (no bets, the simulated table is idle): with a 20 ms fast tick and a 200 ms
    // idle tick, 700 ms holds a handful of passes, not thirty-odd.
    await h.db.query('delete from worker_heartbeats');
    const stop = startWorker(h.db, { resultSlaMs: 300_000, reviewSlaMs: 1_800_000, maxCaptureDelayMs: 180_000 }, 20, undefined, 200);
    await new Promise((r) => setTimeout(r, 700));
    const ticks = (await h.db.query<{ ticks: number }>('select ticks from worker_heartbeats')).rows[0]?.ticks ?? 0;
    expect(ticks).toBeGreaterThanOrEqual(2);
    expect(ticks).toBeLessThanOrEqual(8);
    await stop();
  });

  it('the worker loop beats every tick and removes its row when stopped', async () => {
    await h.db.query('delete from worker_heartbeats');
    const stop = startWorker(h.db, { resultSlaMs: 300_000, reviewSlaMs: 1_800_000, maxCaptureDelayMs: 180_000 }, 30, undefined, 30);
    await new Promise((r) => setTimeout(r, 300));
    const rows = (await h.db.query<{ ticks: number }>('select ticks from worker_heartbeats')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ticks).toBeGreaterThan(0);
    expect((await h.api('GET', '/v1/health/ready')).status).toBe(200);
    await stop();
    expect((await h.db.query('select count(*)::int as n from worker_heartbeats')).rows[0].n).toBe(0);
  });
});

describe('GET /v1/admin/metrics', () => {
  it('is for the PreFlop team only', async () => {
    const p = await h.register();
    expect((await h.api('GET', '/v1/admin/metrics', p.token)).status).toBe(403);
    expect((await h.api('GET', '/v1/admin/metrics')).status).toBe(401);
  });

  it('reports outbox lag, webhook backlog, open alerts, rounds by state and sweeper voids', async () => {
    const before = await metrics();
    expect(before).toMatchObject({ outbox: { pending: 0, oldest_pending_age_s: null }, webhook_deliveries: { pending: 0 }, sweeper_voids_last_hour: 0 });

    await h.db.query(`insert into organizations (id, kind, name) values ('obs-partner', 'partner', 'Obs') on conflict do nothing`);
    await h.db.query(`insert into webhooks (id, org_id, url, secret, events) values ('wh_obs', 'obs-partner', 'https://example.com/h', 's', '{bet.settled}')`);
    await h.db.query(`insert into webhook_deliveries (id, webhook_id, event_id, event_type, payload) values ('whd_obs', 'wh_obs', 'e1', 'bet.settled', '{}')`);
    await h.db.query(`insert into alerts (kind, severity) values ('test_alert', 'critical')`);

    // a round whose result deadline passes is voided by the sweeper
    await h.sim.heartbeat();
    await h.work();
    const n = await h.sim.openHand();
    await h.sim.call('dealer', 'POST', `/v1/provider/tables/sim-1/hands/${n}/start`, {});
    await sweepOnce(h.db, { resultSlaMs: 1, reviewSlaMs: 1_800_000, maxCaptureDelayMs: 180_000 });
    // a job nobody has taken for 90 s (inserted after the worker ran, so it stays pending)
    await h.db.query(`insert into outbox (kind, ref, created_at) values ('resolve_round', 'nowhere', now() - interval '90 seconds')`);

    const m = await metrics();
    expect(m.outbox.pending).toBe(1);
    expect(m.outbox.oldest_pending_age_s).toBeGreaterThanOrEqual(89);
    expect(m.webhook_deliveries.pending).toBe(1);
    expect(m.alerts.open).toBe(before.alerts.open + 1);
    expect(m.alerts.open_critical).toBeGreaterThanOrEqual(1);
    expect(m.rounds_by_state.VOID).toBe((before.rounds_by_state.VOID ?? 0) + 1);
    expect(m.sweeper_voids_last_hour).toBe(1);
    expect(m.instance).toMatchObject({ pid: process.pid, ws_clients: 0 });
    await h.db.query(`delete from outbox where ref = 'nowhere'`);
  });

  it('counts deadlock retries of the tx() helper', async () => {
    await h.db.query('create table if not exists dl_probe (id int primary key, v int not null default 0)');
    await h.db.query('insert into dl_probe (id) values (1), (2) on conflict do nothing');
    const before = (await metrics()).instance.db_retries;
    let arrive!: () => void;
    const both = new Promise<void>((r) => { let k = 0; arrive = () => { if (++k === 2) r(); }; });
    let first = true;
    const cross = (a: number, b: number) => tx(h.db, async (c) => {
      await c.query('update dl_probe set v = v + 1 where id = $1', [a]);
      if (first) { arrive(); await both; } // only the first attempts meet: the retry runs alone
      await c.query('update dl_probe set v = v + 1 where id = $1', [b]);
    });
    const p1 = cross(1, 2);
    const p2 = cross(2, 1);
    await both;
    first = false;
    await Promise.all([p1, p2]);
    const after = (await metrics()).instance.db_retries;
    expect(after.deadlocks).toBe(before.deadlocks + 1);
    expect(after.total).toBe(before.total + 1);
    expect(retryStats.exhausted).toBe(0);
  });

  it('counts connected WebSocket clients of this instance', async () => {
    const ws = await (h.app as FastifyInstance & { injectWS: (path: string) => Promise<import('ws').WebSocket> }).injectWS('/v1/stream');
    await new Promise((r) => setTimeout(r, 50));
    expect((await metrics()).instance.ws_clients).toBe(1);
    ws.terminate();
    await new Promise((r) => setTimeout(r, 100));
    expect((await metrics()).instance.ws_clients).toBe(0);
  });
});
