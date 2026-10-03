import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { pruneNonces } from './auth/envelope.ts';
import { pruneBetChanges } from './lib/statements.ts';
import { type Db, tx } from './lib/db.ts';
import { type MailTransport, deliverMail } from './lib/mailer.ts';
import { deliverDue } from './routes/partner.ts';
import { EventBatch, publish } from './lib/events.ts';
import { type RoundRow, type Timing, ensureOpenRound, lockRound, resolve, voidRound } from './rounds/service.ts';

/**
 * Durable post-commit work (docs/13 §4):
 * - outbox jobs: resolve_round (idempotent) and void_round (rejected evidence → refund);
 * - the sweeper: result deadline for LOCKED/DEALT, review SLA for REVIEW, immediate void of
 *   EVIDENCE_REJECTED, re-enqueue of DEALT rounds, and reopening betting on healthy tables;
 * - webhook delivery (claimed rows, safe with several workers) and nonce pruning.
 */

export async function runOutboxOnce(db: Db, t: Timing, limit = 50): Promise<number> {
  let done = 0;
  for (let i = 0; i < limit; i++) {
    const ev = new EventBatch();
    const did = await tx(db, async (c) => {
      const job = (await c.query<{ id: number; kind: string; ref: string }>(
        'select id, kind, ref from outbox where done_at is null order by id limit 1 for update skip locked')).rows[0];
      if (!job) return false;
      if (job.kind === 'resolve_round') await resolve(c, job.ref, t, ev);
      else if (job.kind === 'void_round') {
        const r = await lockRound(c, job.ref);
        await voidRound(c, r, 'evidence rejected', 'system:evidence', ev, ['EVIDENCE_REJECTED']);
      } else if (job.kind === 'void_paused') {
        const r = await lockRound(c, job.ref);
        await voidRound(c, r, 'table paused by outcome monitor', 'system:monitor', ev, ['OPEN', 'LOCKED', 'DEALT', 'REVIEW']);
      }
      await c.query('update outbox set done_at = now() where id = $1', [job.id]);
      return true;
    });
    publish(ev);
    if (!did) break;
    done++;
  }
  return done;
}

export async function sweepOnce(db: Db, t: Timing): Promise<{ voided: number; reenqueued: number; opened: number }> {
  let voided = 0, reenqueued = 0, opened = 0;
  const due = (await db.query<{ id: string; why: string }>(
    `select id, 'deadline' as why from rounds where state in ('LOCKED','DEALT') and locked_at + ($1 || ' milliseconds')::interval <= clock_timestamp()
     union all
     select id, 'review' from rounds where state = 'REVIEW' and review_started_at + ($2 || ' milliseconds')::interval <= clock_timestamp()
     union all
     select id, 'rejected' from rounds where state = 'EVIDENCE_REJECTED'`, [String(t.resultSlaMs), String(t.reviewSlaMs)])).rows;
  for (const d of due) {
    const ev = new EventBatch();
    const ok = await tx(db, async (c) => {
      const r: RoundRow = await lockRound(c, d.id);
      if (d.why === 'deadline') return voidRound(c, r, 'result deadline passed', 'system:sweeper', ev, ['LOCKED', 'DEALT']);
      if (d.why === 'review') return voidRound(c, r, 'review deadline passed', 'system:sweeper', ev, ['REVIEW']);
      return voidRound(c, r, 'evidence rejected', 'system:sweeper', ev, ['EVIDENCE_REJECTED']);
    });
    publish(ev);
    if (ok) voided++;
  }
  const dealt = await db.query(`insert into outbox (kind, ref)
     select 'resolve_round', r.id from rounds r join captures c on c.round_id = r.id and c.image is not null
      where r.state = 'DEALT' and (select count(*) from flop_entries e where e.round_id = r.id) = 2
     on conflict do nothing`);
  reenqueued = dealt.rowCount ?? 0;
  const tables = (await db.query<{ id: string }>(`select id from poker_tables where status = 'active'`)).rows;
  for (const tb of tables) {
    const ev = new EventBatch();
    const id = await tx(db, (c) => ensureOpenRound(c, tb.id, ev));
    publish(ev);
    if (id) opened++;
  }
  return { voided, reenqueued, opened };
}

/** Records that this worker loop is alive (GET /v1/health/ready checks the freshest beat). */
export async function beat(db: Db, workerId: string): Promise<void> {
  await db.query(`insert into worker_heartbeats (worker_id) values ($1)
    on conflict (worker_id) do update set beat_at = now(), ticks = worker_heartbeats.ticks + 1`, [workerId]);
}

export const newWorkerId = () => `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;

/** Starts the worker loop. The returned stop() waits for a running tick, then removes the heartbeat. */
export interface WorkerMail { transport: MailTransport | null; from: string }

export function startWorker(db: Db, t: Timing, everyMs = 1000, mail?: WorkerMail): () => Promise<void> {
  let stopped = false;
  let current: Promise<void> | null = null;
  const workerId = newWorkerId();
  let prunedAt = 0;
  const tick = async () => {
    try {
      // A tick that hangs stops the beats, so readiness reports the stuck worker.
      await beat(db, workerId);
      await runOutboxOnce(db, t);
      await sweepOnce(db, t);
      await deliverDue(db);
      // Housekeeping once a minute: consumed request nonces past the replay window.
      if (Date.now() - prunedAt >= 60_000) {
        prunedAt = Date.now();
        await pruneNonces(db);
        await pruneBetChanges(db);
      }
    } catch (e) {
      console.error('worker error', e);
    }
  };
  const timer = setInterval(() => {
    if (current || stopped) return;
    current = tick().finally(() => { current = null; });
  }, everyMs);
  // Email runs on its own loop: a slow provider or a backlog never holds up the game tick (settlement,
  // refunds, the heartbeat). One pass at a time, so a slow pass only delays the next email pass.
  let mailing: Promise<void> | null = null;
  const mailTimer = mail ? setInterval(() => {
    if (mailing || stopped) return;
    mailing = deliverMail(db, mail.transport, mail.from)
      .then(() => {}, (e) => { console.error('mail worker error', e); })
      .finally(() => { mailing = null; });
  }, everyMs) : null;
  return async () => {
    stopped = true;
    clearInterval(timer);
    if (mailTimer) clearInterval(mailTimer);
    await Promise.all([current, mailing]);
    await db.query('delete from worker_heartbeats where worker_id = $1', [workerId]).catch(() => {});
  };
}
