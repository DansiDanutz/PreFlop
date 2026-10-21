import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { OUTBOX_MAX_ATTEMPTS, runOutboxOnce } from '../src/worker.ts';
import { type Harness, harness } from './helpers.ts';

let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await harness('worker');
  await tx(h.db, (c) => seedAdmin(c, 'ops@test.dev', 'Ops-Pass-2026!'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'ops@test.dev', password: 'Ops-Pass-2026!' })).body.token;
});
afterAll(async () => h?.close());

describe('outbox jobs whose handler fails', () => {
  it('are retried with backoff, never block the jobs behind them, and are parked with an alert after the last attempt', async () => {
    const timing = { resultSlaMs: h.config.resultSlaMs, reviewSlaMs: h.config.reviewSlaMs, maxCaptureDelayMs: h.config.maxCaptureDelayMs, openSlaMs: h.config.openSlaMs };
    const job = async (ref: string) => (await h.db.query<{ attempts: number; done_at: Date | null; failed_at: Date | null; last_error: string | null; due_later: boolean }>(
      `select attempts, done_at, failed_at, last_error, next_attempt_at > now() as due_later from outbox where ref = $1`, [ref])).rows[0]!;
    // The poisoned job comes first: its handler throws (no such round).
    await h.db.query(`insert into outbox (kind, ref) values ('resolve_round', 'nowhere')`);
    await h.sim.heartbeat();
    const n = await h.sim.openHand();
    const rid = `sim-1:h${n}`;
    await h.db.query(`insert into outbox (kind, ref) values ('resolve_round', $1)`, [rid]);

    expect(await runOutboxOnce(h.db, timing)).toBe(1);
    expect((await job(rid)).done_at).not.toBeNull();
    expect(await job('nowhere')).toMatchObject({ attempts: 1, done_at: null, failed_at: null, due_later: true });
    expect((await job('nowhere')).last_error).toContain('round not found');
    // Not taken again while it backs off.
    expect(await runOutboxOnce(h.db, timing)).toBe(0);
    expect((await job('nowhere')).attempts).toBe(1);

    for (let i = 1; i < OUTBOX_MAX_ATTEMPTS; i++) {
      await h.db.query(`update outbox set next_attempt_at = now() where ref = 'nowhere'`);
      await runOutboxOnce(h.db, timing);
    }
    expect(await job('nowhere')).toMatchObject({ attempts: OUTBOX_MAX_ATTEMPTS, done_at: null });
    expect((await job('nowhere')).failed_at).not.toBeNull();
    const alert = (await h.db.query(`select severity, details from alerts where kind = 'outbox_job_failed'`)).rows;
    expect(alert).toHaveLength(1);
    expect(alert[0]).toMatchObject({ severity: 'critical', details: { kind: 'resolve_round', ref: 'nowhere', attempts: OUTBOX_MAX_ATTEMPTS } });
    // Parked: never picked up again, and visible in the metrics.
    await h.db.query(`update outbox set next_attempt_at = now() where ref = 'nowhere'`);
    expect(await runOutboxOnce(h.db, timing)).toBe(0);
    expect((await job('nowhere')).attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    const m = await h.api('GET', '/v1/admin/metrics', admin);
    expect(m.status).toBe(200);
    expect(m.body.outbox).toMatchObject({ pending: 0, parked: 1 });
  });
});
