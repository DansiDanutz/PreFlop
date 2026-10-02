import { type Db, tx } from './lib/db.ts';
import { deliverDue } from './routes/partner.ts';
import { EventBatch, publish } from './lib/events.ts';
import { type RoundRow, type Timing, ensureOpenRound, lockRound, resolve, voidRound } from './rounds/service.ts';

/**
 * Durable post-commit work (docs/13 §4):
 * - outbox jobs: resolve_round (idempotent) and void_round (rejected evidence → refund);
 * - the sweeper: result deadline for LOCKED/DEALT, review SLA for REVIEW, immediate void of
 *   EVIDENCE_REJECTED, re-enqueue of DEALT rounds, and reopening betting on healthy tables.
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
        await voidRound(c, r, 'table paused by outcome monitor', 'system:monitor', ev, ['OPEN', 'LOCKED']);
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

export function startWorker(db: Db, t: Timing, everyMs = 1000): () => void {
  let stopped = false;
  let running = false;
  const timer = setInterval(async () => {
    if (running || stopped) return;
    running = true;
    try {
      await runOutboxOnce(db, t);
      await sweepOnce(db, t);
      await deliverDue(db);
    } catch (e) {
      console.error('worker error', e);
    } finally {
      running = false;
    }
  }, everyMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
