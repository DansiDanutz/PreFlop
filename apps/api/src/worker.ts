import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { pruneNonces } from './auth/envelope.ts';
import { pruneBetChanges } from './lib/statements.ts';
import { type Db, tx } from './lib/db.ts';
import { type MailTransport, deliverMail } from './lib/mailer.ts';
import { AGENT_HINT, ALERT_TRIAGE, APPLICATION_HINT, type Decider, DecisionError, PROMOTION_HINT, REVIEW_HINT, saveHint } from './lib/decisions.ts';
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
      } else if (job.kind === 'void_round_migrated') {
        // Migration 021: the hand of a free-chip manual table that became play money only.
        const r = await lockRound(c, job.ref);
        await voidRound(c, r, 'manual tables are play money only (migration 021)', 'system:migration', ev, ['OPEN', 'LOCKED']);
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

/**
 * How long to wait before the next pass: `everyMs` from the start of a pass that found work (more may
 * be waiting; the pass's own duration counts), `idleMs` after one that found none. A busy table keeps the one-second cadence; an idle platform
 * polls a few times a minute instead of every second, which is what used up the database quota on
 * the free plan (docs/18). idleMs stays under the readiness heartbeat limit (WORKER_HEARTBEAT_MAX_AGE_MS).
 */
export const nextDelayMs = (worked: boolean, everyMs: number, idleMs: number, elapsedMs = 0): number =>
  (worked ? Math.max(0, everyMs - elapsedMs) : Math.max(everyMs, idleMs));

/**
 * Decision hints (docs/20): asks the decision model about open alerts and rounds in review that have
 * no hint yet, a few at a time, and stores the answers for the console. Advice only: nothing here
 * changes a round, a table or a balance. An answer the service refuses (bad request) is stored as
 * an error and retried a few times, ten minutes apart (a key or the service may have been fixed), then
 * left alone; a rate limit or outage ends the pass and the rest waits for the next one. Returns the
 * number of hints stored.
 */
/** How often a question the service refused is asked again: a few more times, ten minutes apart, in case the key or the service was fixed. */
export const HINT_RETRY_MAX = 5;
export const HINT_RETRY_AFTER = '10 minutes';
/** SQL (on the joined decision_hints row `h`): no hint yet, or a failed one that is due for a bounded retry. */
const HINT_WANTED = `(h.ref is null or (h.error is not null and h.attempts < ${HINT_RETRY_MAX} and h.created_at < now() - interval '${HINT_RETRY_AFTER}'))`;

export async function decisionsOnce(db: Db, decider: Decider, limit = 10): Promise<number> {
  if (!decider.enabled) return 0;
  let stored = 0;
  const ask = async (kind: string, ref: string, state: unknown, questions: typeof ALERT_TRIAGE): Promise<boolean> => {
    try {
      const answers = await decider.decide(state, questions);
      await saveHint(db, kind, ref, decider.model, answers);
      stored++;
      return true;
    } catch (e) {
      if (e instanceof DecisionError && e.retryable) { console.error('decisions paused:', e.message); return false; }
      console.error(`decision hint ${kind}/${ref} failed:`, e instanceof Error ? e.message : e);
      await saveHint(db, kind, ref, decider.model, null, e instanceof Error ? e.message : String(e));
      return true;
    }
  };
  const alerts = (await db.query<{ id: number; table_id: string | null; round_id: string | null; kind: string; severity: string; details: unknown; created_at: Date; open_on_table: number }>(
    `select a.id, a.table_id, a.round_id, a.kind, a.severity, a.details, a.created_at,
            (select count(*)::int from alerts o where o.resolved_at is null and o.table_id is not distinct from a.table_id and o.id <> a.id) as open_on_table
       from alerts a left join decision_hints h on h.kind = 'alert' and h.ref = a.id::text
      where a.resolved_at is null and ${HINT_WANTED} order by a.created_at limit $1`, [limit])).rows;
  for (const a of alerts) {
    const state = { alert: { kind: a.kind, severity: a.severity, details: a.details, table_id: a.table_id, round_id: a.round_id, age_s: Math.round((Date.now() - a.created_at.getTime()) / 1000) }, other_open_alerts_on_table: a.open_on_table };
    if (!(await ask('alert', String(a.id), state, ALERT_TRIAGE))) return stored;
  }
  const reviews = (await db.query<{ id: string; state: string; mode: string; review_reasons: unknown; capture: unknown; entries: unknown }>(
    `select r.id, r.state, r.mode, r.review_reasons,
            (select c.capture from captures c where c.round_id = r.id) as capture,
            (select coalesce(jsonb_agg(jsonb_build_object('source', e.source, 'cards', e.cards) order by e.source), '[]'::jsonb) from flop_entries e where e.round_id = r.id) as entries
       from rounds r left join decision_hints h on h.kind = 'review' and h.ref = r.id
      where r.state in ('REVIEW','EVIDENCE_REJECTED') and ${HINT_WANTED} order by r.review_started_at nulls last, r.opened_at limit $1`, [limit])).rows;
  for (const r of reviews) {
    const state = { round: { state: r.state, mode: r.mode, review_reasons: r.review_reasons }, entries: r.entries, capture: r.capture };
    if (!(await ask('review', r.id, state, REVIEW_HINT))) return stored;
  }
  // Organization applications awaiting a decision. The applicant's name and email stay out of the
  // state; what goes is the kind, the details they typed (minus contact fields) and duplicate signals.
  const applications = (await db.query<{ id: string; kind: string; details: Record<string, unknown> | null; user_id: string | null; created_at: Date; same_email_orgs: number; same_email_open: number }>(
    `select a.id, a.kind, a.details, a.user_id, a.created_at,
            (select count(*)::int from organizations o where lower(o.settings->>'owner_email') = lower(a.email)) as same_email_orgs,
            (select count(*)::int from applications b where b.id <> a.id and b.status = 'new' and lower(b.email) = lower(a.email)) as same_email_open
       from applications a left join decision_hints h on h.kind = 'application' and h.ref = a.id
      where a.status = 'new' and ${HINT_WANTED} order by a.created_at limit $1`, [limit])).rows;
  for (const a of applications) {
    const details = Object.fromEntries(Object.entries(a.details ?? {}).filter(([k]) => !/email|phone|name|address/i.test(k)));
    const state = { application: { kind: a.kind, details, applicant_signed_in: a.user_id !== null, age_hours: Math.round((Date.now() - a.created_at.getTime()) / 3_600_000) }, organizations_with_same_contact: a.same_email_orgs, other_open_applications_same_contact: a.same_email_open };
    if (!(await ask('application', a.id, state, APPLICATION_HINT))) return stored;
  }
  // Promotions from organizations waiting for PreFlop's review.
  const promotions = (await db.query<{ id: string; kind: string; title: string; body: string; link: string | null; mode: string | null; currency: string | null; amount_minor: string | null; budget_minor: string | null; starts_at: Date; ends_at: Date; org_kind: string | null }>(
    `select p.id, p.kind, p.title, p.body, p.link, p.mode, p.currency, p.amount_minor, p.budget_minor, p.starts_at, p.ends_at, o.kind as org_kind
       from promotions p left join organizations o on o.id = p.owner_org left join decision_hints h on h.kind = 'promotion' and h.ref = p.id
      where p.status = 'pending_review' and ${HINT_WANTED} order by p.created_at limit $1`, [limit])).rows;
  for (const p of promotions) {
    const days = Math.round((p.ends_at.getTime() - p.starts_at.getTime()) / 86_400_000);
    const state = { promotion: { kind: p.kind, title: p.title, body: p.body, has_link: p.link !== null, mode: p.mode, currency: p.currency, amount_minor: p.amount_minor === null ? null : Number(p.amount_minor), budget_minor: p.budget_minor === null ? null : Number(p.budget_minor), runs_days: days, starts_in_days: Math.round((p.starts_at.getTime() - Date.now()) / 86_400_000), owner_kind: p.org_kind } };
    if (!(await ask('promotion', p.id, state, PROMOTION_HINT))) return stored;
  }
  // Agent applications. No names: the note, the account's age, the proposed parent and early referrals.
  const agents = (await db.query<{ user_id: string; note: string | null; created_at: Date; user_created_at: Date; parent_status: string | null; early_referrals: number }>(
    `select a.user_id, a.note, a.created_at, u.created_at as user_created_at, p.status as parent_status,
            (select count(*)::int from users r where r.referred_by_agent = a.user_id) as early_referrals
       from agents a join users u on u.id = a.user_id left join agents p on p.user_id = a.parent_agent_id left join decision_hints h on h.kind = 'agent' and h.ref = a.user_id
      where a.status = 'applied' and ${HINT_WANTED} order by a.created_at limit $1`, [limit])).rows;
  for (const a of agents) {
    const state = { agent_application: { note: a.note, account_age_days: Math.round((Date.now() - a.user_created_at.getTime()) / 86_400_000), applied_hours_ago: Math.round((Date.now() - a.created_at.getTime()) / 3_600_000), proposed_by_agent: a.parent_status, players_registered_with_code_before_approval: a.early_referrals } };
    if (!(await ask('agent', a.user_id, state, AGENT_HINT))) return stored;
  }
  return stored;
}

export function startWorker(db: Db, t: Timing, everyMs = 1000, mail?: WorkerMail, idleMs = 5000, decider?: Decider): () => Promise<void> {
  let stopped = false;
  let current: Promise<void> | null = null;
  const workerId = newWorkerId();
  let prunedAt = 0;
  /** One pass of everything; true when it found work to do. */
  const tick = async (): Promise<boolean> => {
    try {
      // A tick that hangs stops the beats, so readiness reports the stuck worker.
      await beat(db, workerId);
      const jobs = await runOutboxOnce(db, t);
      const swept = await sweepOnce(db, t);
      const delivered = await deliverDue(db);
      // Housekeeping once a minute: consumed request nonces past the replay window.
      if (Date.now() - prunedAt >= 60_000) {
        prunedAt = Date.now();
        await pruneNonces(db);
        await pruneBetChanges(db);
      }
      return jobs > 0 || swept.voided + swept.reenqueued + swept.opened > 0 || delivered > 0;
    } catch (e) {
      console.error('worker error', e);
      return true; // retry at the fast cadence
    }
  };
  let timer: NodeJS.Timeout | null = null;
  const schedule = (ms: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      const started = Date.now();
      current = tick().then((worked) => { current = null; schedule(nextDelayMs(worked, everyMs, idleMs, Date.now() - started)); });
    }, ms);
  };
  schedule(everyMs);
  // Email runs on its own loop: a slow provider or a backlog never holds up the game tick (settlement,
  // refunds, the heartbeat). One pass at a time, so a slow pass only delays the next email pass.
  let mailing: Promise<void> | null = null;
  let mailTimer: NodeJS.Timeout | null = null;
  const scheduleMail = (ms: number) => {
    if (stopped || !mail) return;
    mailTimer = setTimeout(() => {
      const started = Date.now();
      mailing = deliverMail(db, mail.transport, mail.from)
        .then((sent) => sent > 0, (e) => { console.error('mail worker error', e); return true; })
        .then((worked) => { mailing = null; scheduleMail(nextDelayMs(worked, everyMs, idleMs, Date.now() - started)); });
    }, ms);
  };
  scheduleMail(everyMs);
  // Decision hints (docs/20) run on their own loop too: a slow or rate-limited adviser must never hold
  // up a settlement, a refund or the heartbeat. Advice is the one job here that can wait.
  let hinting: Promise<void> | null = null;
  let hintTimer: NodeJS.Timeout | null = null;
  const scheduleHints = (ms: number) => {
    if (stopped || !decider?.enabled) return;
    hintTimer = setTimeout(() => {
      const started = Date.now();
      hinting = decisionsOnce(db, decider)
        .then((stored) => stored > 0, (e) => { console.error('decision hints error', e); return false; })
        .then((worked) => { hinting = null; scheduleHints(nextDelayMs(worked, everyMs, idleMs, Date.now() - started)); });
    }, ms);
  };
  scheduleHints(everyMs);
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (mailTimer) clearTimeout(mailTimer);
    if (hintTimer) clearTimeout(hintTimer);
    await Promise.all([current, mailing, hinting]);
    await db.query('delete from worker_heartbeats where worker_id = $1', [workerId]).catch(() => {});
  };
}
