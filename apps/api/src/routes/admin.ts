import { type PlayMode, RoundExposure } from '@preflop/odds-engine';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { statsOf } from '../bets/service.ts';
import { audit, verifyAuditChain } from '../lib/audit.ts';
import { type Tx, retryCount, retryStats, tx } from '../lib/db.ts';
import { defaultRoundLossMinor } from '../lib/limits.ts';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.ts';
import { EventBatch, publish } from '../lib/events.ts';
import { newId } from '../lib/ids.ts';
import { mailStats } from '../lib/mailer.ts';
import { issueOwnerClaim } from '../lib/ownerClaims.ts';
import { Territories } from '../lib/accounts.ts';
import { limitParam } from '../lib/query.ts';
import { platformStatements } from '../lib/statements.ts';
import { manualFlop, manualLock } from '../rounds/manual.ts';
import { MONITOR } from '../rounds/monitor.ts';
import { manualTablesEnabled } from '../rounds/readiness.ts';
import { ensureOpenRound, lockRound, resolveReviewByPlatform, voidRound, withReviewDeadline } from '../rounds/service.ts';
import { upsertClub } from '../seed.ts';
import { readinessChecks, tableSummaries } from './public.ts';
import { RESERVED_SETTINGS } from './org.ts';
import { endPartnerSessions } from './partner.ts';

/** The club every manual table belongs to: the PreFlop team itself, not a partner club. */
export const MANUAL_CLUB = 'club_preflop_manual';

export async function requirePlatform(ctx: AppContext, req: FastifyRequest, ...roles: string[]) {
  const u = await ctx.user(req);
  if (!u.platform_role || (roles.length && !roles.includes(u.platform_role) && u.platform_role !== 'admin')) throw forbidden('forbidden_role', 'PreFlop team only');
  return u;
}

const Setting = z.object({ value: z.unknown(), note: z.string().max(500).optional() });

/** Evidence of one round for reviewers: capture record, image, entries and procedure ordinals. */
export async function evidenceOf(ctx: AppContext, roundId: string) {
  const round = (await ctx.db.query(
    `select id, table_id, hand_no, state, procedure_step as step, mode, currency, opened_at, locked_at, settled_at, voided_at, void_reason, flop, review_reasons, review_started_at
       from rounds where id = $1`, [roundId])).rows[0];
  if (!round) throw notFound('round');
  const cap = (await ctx.db.query<{ capture: Record<string, unknown>; image: Buffer | null }>('select capture, image from captures where round_id = $1', [roundId])).rows[0];
  const entries = (await ctx.db.query('select source, person_id, cards from flop_entries where round_id = $1 order by source', [roundId])).rows;
  const events = (await ctx.db.query('select ord, step, at from round_events where round_id = $1 order by ord', [roundId])).rows;
  let image: string | null = null;
  if (cap?.image) {
    const text = cap.image.subarray(0, 5).toString();
    const mime = text.startsWith('<svg') ? 'image/svg+xml' : cap.image[0] === 0x89 ? 'image/png' : 'image/jpeg';
    image = `data:${mime};base64,${cap.image.toString('base64')}`;
  }
  return { round: withReviewDeadline(round, ctx.config.reviewSlaMs), capture: cap?.capture ?? null, image_data_url: image, entries, events };
}

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/v1/admin/overview', async (req) => {
    await requirePlatform(ctx, req);
    const q = async (sql: string) => (await ctx.db.query(sql)).rows[0];
    // Stakes per (mode, currency): a CHIP, a euro cent and a micro-USDT are never added together.
    const staked = (await ctx.db.query<{ currency: string; mode: string; amount_minor: number }>(
      `select currency, mode, sum(stake_minor)::bigint as amount_minor from bets where placed_at > now() - interval '24 hours' group by currency, mode order by currency, mode`)).rows;
    return {
      users: await q('select count(*)::int as n from users'),
      bets_24h: { ...(await q(`select count(*)::int as n from bets where placed_at > now() - interval '24 hours'`)), staked_by_currency: staked },
      rounds_24h: await q(`select count(*) filter (where state='SETTLED')::int as settled, count(*) filter (where state='VOID')::int as voided from rounds where opened_at > now() - interval '24 hours'`),
      open_alerts: await q('select count(*)::int as n from alerts where resolved_at is null'),
      tables: await tableSummaries(ctx),
    };
  });

  /**
   * Operational counters (JSON). Database counters are global; deadlock retries and WebSocket
   * clients are per API instance (this process, since it started).
   */
  app.get('/v1/admin/metrics', async (req) => {
    await requirePlatform(ctx, req);
    const one = async <T>(sql: string) => (await ctx.db.query(sql)).rows[0] as T;
    const outbox = await one<{ pending: number; oldest_age_s: number | null }>(
      `select count(*)::int as pending, extract(epoch from (now() - min(created_at)))::float8 as oldest_age_s from outbox where done_at is null`);
    const webhooks = await one<{ pending: number; failed: number; oldest_pending_age_s: number | null }>(
      `select count(*) filter (where status in ('pending','sending'))::int as pending, count(*) filter (where status = 'failed')::int as failed,
              extract(epoch from (now() - min(created_at) filter (where status in ('pending','sending'))))::float8 as oldest_pending_age_s
         from webhook_deliveries where status in ('pending','sending','failed')`);
    const mail = await one<{ pending: number; failed: number; retrying: number; oldest_pending_age_s: number | null }>(
      `select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'failed')::int as failed,
              count(*) filter (where status = 'pending' and attempts > 0)::int as retrying,
              extract(epoch from (now() - min(created_at) filter (where status = 'pending')))::float8 as oldest_pending_age_s
         from email_outbox where status in ('pending','failed')`);
    const alerts = await one<{ open: number; critical: number }>(
      `select count(*)::int as open, count(*) filter (where severity = 'critical')::int as critical from alerts where resolved_at is null`);
    const states = (await ctx.db.query<{ state: string; n: number }>('select state, count(*)::int as n from rounds group by state order by state')).rows;
    const sweeper = await one<{ n: number }>(
      `select count(*)::int as n from rounds where state = 'VOID' and voided_by like 'system:sweeper%' and voided_at > now() - interval '1 hour'`);
    const ready = await readinessChecks(ctx);
    return {
      at: new Date().toISOString(),
      outbox: { pending: outbox.pending, oldest_pending_age_s: outbox.oldest_age_s === null ? null : Math.round(outbox.oldest_age_s * 10) / 10 },
      webhook_deliveries: { pending: webhooks.pending, failed: webhooks.failed, oldest_pending_age_s: webhooks.oldest_pending_age_s === null ? null : Math.round(webhooks.oldest_pending_age_s * 10) / 10 },
      email_outbox: {
        pending: mail.pending, retrying: mail.retrying, failed: mail.failed,
        oldest_pending_age_s: mail.oldest_pending_age_s === null ? null : Math.round(mail.oldest_pending_age_s * 10) / 10,
      },
      alerts: { open: alerts.open, open_critical: alerts.critical },
      rounds_by_state: Object.fromEntries(states.map((r) => [r.state, r.n])),
      sweeper_voids_last_hour: sweeper.n,
      worker: ready.worker,
      instance: {
        pid: process.pid,
        started_at: ctx.stats.startedAt.toISOString(),
        uptime_s: Math.round((Date.now() - ctx.stats.startedAt.getTime()) / 1000),
        db_retries: { total: retryCount.value, deadlocks: retryStats.deadlocks, serialization_failures: retryStats.serializationFailures, exhausted: retryStats.exhausted },
        ws_clients: ctx.stats.wsClients,
        mail: { sent: mailStats.sent, failed_attempts: mailStats.failedAttempts, gave_up: mailStats.gaveUp, expired: mailStats.expired },
      },
    };
  });

  // ---------------------------------------------------------------- settings
  app.get('/v1/admin/settings', async (req) => {
    await requirePlatform(ctx, req);
    return { settings: (await ctx.db.query('select key, value, updated_at, updated_by from settings order by key')).rows };
  });
  app.put('/v1/admin/settings/:key', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin');
    const { key } = req.params as { key: string };
    const { value, note } = Setting.parse(req.body);
    if (key === 'physical_play_enabled' && value !== false && value !== true) throw unprocessable('invalid_value', 'physical_play_enabled is true or false');
    if (key === 'modes_enabled' && (typeof value !== 'object' || value === null)) throw unprocessable('invalid_value', 'modes_enabled is an object of mode → boolean');
    if (key === 'manual_tables_enabled' && value !== false && value !== true) throw unprocessable('invalid_value', 'manual_tables_enabled is true or false');
    if (key === 'require_staff_mfa' && value !== false && value !== true) throw unprocessable('invalid_value', 'require_staff_mfa is true or false');
    let stored = value;
    if (key === 'territories') {
      // {"blocked": ["US"], "real_money_allowed": ["MT"]}: ISO 3166-1 alpha-2 codes, upper case, no overlap.
      const t = Territories.safeParse(value);
      if (!t.success) throw unprocessable('invalid_value', `territories: ${t.error.issues.map((i) => `${i.path.join('.') || 'value'} ${i.message}`).join('; ')}`);
      stored = { blocked: [...new Set(t.data.blocked)].sort(), real_money_allowed: [...new Set(t.data.real_money_allowed)].sort() };
    }
    const ev = new EventBatch();
    const out = await tx(ctx.db, async (c) => {
      const r = await c.query('update settings set value = $2, updated_at = now(), updated_by = $3 where key = $1 returning key', [key, JSON.stringify(stored), u.id]);
      if (!r.rowCount) throw notFound('setting');
      await audit(c, { type: 'settings.changed', key, value: stored as never, note: note ?? null, by: u.id });
      // Manual tables off: no hand can be closed or typed any more, so open hands are refunded now
      // rather than left with bets nobody can settle (locked hands still reach the result deadline).
      if (key === 'manual_tables_enabled' && stored === false) {
        // Lock the manual tables first: a hand settling right now (ensureOpenRound holds the table row
        // shared) either commits its next hand before this list is taken, or waits and sees the switch off.
        await c.query(`select id from poker_tables where kind = 'manual' order by id for update`);
        const open = (await c.query<{ id: string }>(`select r.id from rounds r join poker_tables t on t.id = r.table_id where t.kind = 'manual' and r.state = 'OPEN' order by r.id`)).rows;
        for (const o of open) await voidRound(c, await lockRound(c, o.id), 'manual tables switched off', `user:${u.id}`, ev, ['OPEN']);
      }
      return { key, value: stored };
    });
    publish(ev);
    return out;
  });

  // ---------------------------------------------------------------- alerts
  app.get('/v1/admin/alerts', async (req) => {
    await requirePlatform(ctx, req);
    return { alerts: (await ctx.db.query('select * from alerts order by resolved_at nulls first, created_at desc limit 300')).rows };
  });
  app.post('/v1/admin/alerts/:id/resolve', async (req) => {
    const u = await requirePlatform(ctx, req);
    const { id } = req.params as { id: string };
    await ctx.db.query('update alerts set resolved_at = now(), resolved_by = $2 where id = $1 and resolved_at is null', [id, u.id]);
    return { ok: true };
  });

  // ---------------------------------------------------------------- rounds, review, evidence
  app.get('/v1/admin/review-queue', async (req) => {
    await requirePlatform(ctx, req);
    return { rounds: (await ctx.db.query(
      `select r.id, r.table_id, r.hand_no, r.state, r.procedure_step as step, r.mode, r.currency, r.opened_at, r.locked_at, r.settled_at, r.voided_at, r.void_reason,
              r.flop, r.review_reasons, r.review_started_at, t.name as table_name
         from rounds r join poker_tables t on t.id = r.table_id where r.state in ('REVIEW','EVIDENCE_REJECTED') order by r.review_started_at nulls last, r.opened_at`))
      .rows.map((r) => withReviewDeadline(r, ctx.config.reviewSlaMs)) };
  });
  app.get('/v1/admin/rounds/:id/evidence', async (req) => {
    await requirePlatform(ctx, req);
    return evidenceOf(ctx, (req.params as { id: string }).id);
  });
  /**
   * Review of a REAL-MONEY round (docs/13 §4): the club running the table may not settle its own
   * real-money rounds, so admin/ops decide here after viewing the evidence. Same rules as the floor
   * manager's decision: review deadline first, then one terminal transition from REVIEW. Rounds of
   * other modes are refused (403 club_review_required): their review stays with the club.
   */
  app.post('/v1/admin/rounds/:id/review', async (req, reply) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const { id } = req.params as { id: string };
    const decision = z.discriminatedUnion('action', [
      z.object({ action: z.literal('settle'), cards: z.array(z.string()).length(3) }),
      z.object({ action: z.literal('void'), reason: z.string().min(3).max(200) }),
    ]).parse(req.body);
    const ev = new EventBatch();
    const out = await tx(ctx.db, async (c) => {
      const r = await lockRound(c, id);
      const res = await resolveReviewByPlatform(c, r, u.id, decision, ctx.timing, ev);
      await ensureOpenRound(c, r.table_id, ev);
      return res;
    });
    publish(ev);
    return reply.code(out.status).send(out.body);
  });
  /** The PreFlop team may VOID (refund) any round; it settles by hand only real-money reviews (above). */
  app.post('/v1/admin/rounds/:id/void', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'risk', 'ops');
    const { id } = req.params as { id: string };
    const { reason } = z.object({ reason: z.string().min(3).max(200) }).parse(req.body);
    const ev = new EventBatch();
    const ok = await tx(ctx.db, async (c) => {
      const r = await lockRound(c, id);
      const done = await voidRound(c, r, `PreFlop team: ${reason}`, `user:${u.id}`, ev);
      if (done) await ensureOpenRound(c, r.table_id, ev);
      return done;
    });
    publish(ev);
    if (!ok) throw conflict('invalid_round_state', 'round is already settled or voided');
    return { state: 'VOID' };
  });
  app.get('/v1/admin/rounds', async (req) => {
    await requirePlatform(ctx, req);
    const q = req.query as { table_id?: string; state?: string; limit?: string };
    return { rounds: (await ctx.db.query(
      `select r.id, r.table_id, r.hand_no, r.state, r.procedure_step as step, r.mode, r.currency, r.opened_at, r.locked_at, r.settled_at, r.voided_at, r.void_reason, r.flop,
              r.review_started_at, t.name as table_name, count(b.id)::int as bets, coalesce(sum(b.stake_minor), 0)::bigint as staked_minor,
              coalesce(sum(b.payout_minor) filter (where b.status = 'won'), 0)::bigint as paid_minor
         from rounds r join poker_tables t on t.id = r.table_id left join bets b on b.round_id = r.id
        where ($1::text is null or r.table_id = $1) and ($2::text is null or r.state = $2)
        group by r.id, t.name order by r.opened_at desc limit $3`, [q.table_id ?? null, q.state ?? null, limitParam(q, 500, 100)]))
      .rows.map((r) => withReviewDeadline(r, ctx.config.reviewSlaMs)) };
  });

  // ---------------------------------------------------------------- risk
  app.get('/v1/admin/risk', async (req) => {
    await requirePlatform(ctx, req);
    const open = (await ctx.db.query<{ round_id: string; table_name: string; currency: string; limit_minor: number }>(
      `select r.id as round_id, t.name as table_name, r.currency, t.max_round_loss_minor as limit_minor
         from rounds r join poker_tables t on t.id = r.table_id where r.state in ('OPEN','LOCKED','DEALT','REVIEW') order by r.opened_at`)).rows;
    const rounds = [];
    for (const o of open) {
      const bets = (await ctx.db.query<{ selection_id: string; stake_minor: number; odds_centi: number }>(
        `select selection_id, stake_minor, odds_centi from bets where round_id = $1 and status = 'accepted' and house_kind = 'preflop'`, [o.round_id])).rows;
      const e = new RoundExposure(Number.MAX_SAFE_INTEGER);
      for (const b of bets) e.tryAdd(statsOf(b.selection_id), b.stake_minor, b.odds_centi);
      rounds.push({ ...o, bets: bets.length, staked_minor: e.totalStakesMinor, worst_case_loss_minor: e.worstCase().lossMinor });
    }
    const monitor = (await ctx.db.query<{ id: string; name: string; monitor: Record<string, number>; monitor_hands: number }>('select id, name, monitor, monitor_hands from poker_tables order by name')).rows.map((t) => ({
      table_id: t.id, table_name: t.name, hands: t.monitor_hands, threshold: MONITOR.threshold,
      top: Object.entries(t.monitor ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([selection_id, statistic]) => ({ selection_id, statistic })),
    }));
    return { rounds, monitor };
  });

  // ---------------------------------------------------------------- users
  app.get('/v1/admin/users', async (req) => {
    await requirePlatform(ctx, req);
    const q = req.query as { q?: string; limit?: string };
    return { users: (await ctx.db.query(
      `select u.id, u.email, u.display_name, u.status, u.kyc_status, u.platform_role, u.country, u.partner_id, u.created_at,
              (select count(*)::int from bets b where b.user_id = u.id) as bets
         from users u where ($1::text is null or u.email ilike '%' || $1 || '%' or u.display_name ilike '%' || $1 || '%')
        order by u.created_at desc limit $2`, [q.q ?? null, limitParam(q, 500, 100)])).rows };
  });
  app.put('/v1/admin/users/:id', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'support', 'risk');
    const { id } = req.params as { id: string };
    const b = z.object({ status: z.enum(['active', 'suspended', 'self_excluded', 'closed']).optional(), kyc_status: z.enum(['none', 'pending', 'verified', 'rejected']).optional(), platform_role: z.enum(['admin', 'ops', 'risk', 'support']).nullable().optional() }).parse(req.body);
    if (b.platform_role !== undefined && u.platform_role !== 'admin') throw forbidden('forbidden_role', 'only admins change platform roles');
    return tx(ctx.db, async (c) => {
      const cur = (await c.query('select status, self_excluded_until, platform_role from users where id = $1 for update', [id])).rows[0];
      if (!cur) throw notFound('user');
      // Support and risk manage players, not the team: no changes to staff accounts or to themselves.
      if (u.platform_role !== 'admin' && (id === u.id || cur.platform_role !== null)) throw forbidden('forbidden_target', 'only an admin can change a PreFlop team account');
      // Whatever the current status (self_excluded, or suspended in between), an account under a
      // self-exclusion that has not ended cannot be made active; migration 016 enforces it in SQL too.
      if (b.status === 'active' && cur.self_excluded_until && new Date(cur.self_excluded_until) > new Date())
        throw conflict('self_excluded', 'a self-exclusion cannot be lifted before it ends');
      const r = (await c.query(
        `update users set status = coalesce($2, status), kyc_status = coalesce($3, kyc_status), platform_role = case when $5 then $4 else platform_role end
          where id = $1 returning id, email, display_name, status, kyc_status, platform_role, country, partner_id`,
        [id, b.status ?? null, b.kyc_status ?? null, b.platform_role ?? null, b.platform_role !== undefined])).rows[0];
      if (b.status && b.status !== 'active') await c.query('delete from sessions where user_id = $1', [id]);
      await audit(c, { type: 'user.updated', userId: id, change: b as never, by: u.id });
      return r;
    });
  });

  // ---------------------------------------------------------------- organizations & applications
  app.get('/v1/admin/orgs', async (req) => {
    await requirePlatform(ctx, req);
    return { orgs: (await ctx.db.query(`select o.*, (select count(*)::int from memberships m where m.org_id = o.id) as members from organizations o order by o.kind, o.name`)).rows };
  });
  /**
   * Creates an organization. Its owner is either a known, signed-in account (an application made
   * while logged in) or whoever redeems the single-use claim link returned here. An email address
   * alone never grants ownership: nobody has proven they control it.
   */
  const createOrg = async (c: Parameters<Parameters<typeof tx>[1]>[0], kind: 'club' | 'partner' | 'organizer', name: string, ownerEmail: string,
    settings: Record<string, unknown>, by: string, ownerUserId: string | null = null) => {
    const id = newId(kind === 'club' ? 'club' : kind === 'partner' ? 'ptn' : 'org').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16);
    const clean = Object.fromEntries(Object.entries(settings).filter(([k]) => !RESERVED_SETTINGS.has(k) || k === 'application_id'));
    if (kind === 'club') await upsertClub(c, id, name, clean);
    else await c.query('insert into organizations (id, kind, name, settings) values ($1, $2, $3, $4)', [id, kind, name, JSON.stringify(clean)]);
    let owner_claim = null;
    if (ownerUserId) await c.query(`insert into memberships (user_id, org_id, role) values ($1, $2, 'owner') on conflict do nothing`, [ownerUserId, id]);
    else owner_claim = await issueOwnerClaim(c, id, ownerEmail.toLowerCase(), by);
    await audit(c, { type: 'org.created', orgId: id, kind, name, ownerEmail: ownerEmail.toLowerCase(), ownerUserId, by });
    return { id, owner_user_id: ownerUserId, owner_claim };
  };
  app.post('/v1/admin/orgs', async (req, reply) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const b = z.object({ kind: z.enum(['club', 'partner', 'organizer']), name: z.string().min(2).max(120), owner_email: z.string().email(), settings: z.record(z.unknown()).optional() }).parse(req.body);
    return reply.code(201).send(await tx(ctx.db, (c) => createOrg(c, b.kind, b.name, b.owner_email, b.settings ?? {}, u.id)));
  });
  /** A new single-use owner link for an organization (earlier unclaimed links stop working). */
  app.post('/v1/admin/orgs/:id/owner-claim', async (req, reply) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const { id } = req.params as { id: string };
    const b = z.object({ email: z.string().email().optional() }).parse(req.body ?? {});
    return reply.code(201).send(await tx(ctx.db, async (c) => {
      if (!(await c.query('select 1 from organizations where id = $1', [id])).rowCount) throw notFound('organization');
      return { owner_claim: await issueOwnerClaim(c, id, b.email?.toLowerCase() ?? null, u.id) };
    }));
  });
  app.put('/v1/admin/orgs/:id/status', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const { id } = req.params as { id: string };
    const { status } = z.object({ status: z.enum(['active', 'suspended']) }).parse(req.body);
    await tx(ctx.db, async (c) => {
      const r = await c.query('update organizations set status = $2 where id = $1', [id, status]);
      if (!r.rowCount) throw notFound('organization');
      // A suspended partner's players are signed out at once; they cannot sign back in or bet
      // (403 partner_suspended) until the partner is active again.
      const ended = status === 'suspended' ? await endPartnerSessions(c, id) : 0;
      await audit(c, { type: 'org.status', orgId: id, status, partnerSessionsEnded: ended, by: u.id });
    });
    return { ok: true };
  });
  app.get('/v1/admin/applications', async (req) => {
    await requirePlatform(ctx, req);
    return { applications: (await ctx.db.query('select * from applications order by (status = \'new\') desc, created_at desc limit 300')).rows };
  });
  app.post('/v1/admin/applications/:id/decision', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const { id } = req.params as { id: string };
    const { decision } = z.object({ decision: z.enum(['approved', 'rejected']) }).parse(req.body);
    return tx(ctx.db, async (c) => {
      const a = (await c.query('select * from applications where id = $1 for update', [id])).rows[0];
      if (!a) throw notFound('application');
      if (a.status !== 'new') throw conflict('already_decided', `application is ${a.status}`);
      await c.query('update applications set status = $2, decided_by = $3 where id = $1', [id, decision, u.id]);
      if (decision === 'rejected') {
        await audit(c, { type: 'application.decided', applicationId: id, decision, orgId: null, by: u.id });
        return { ok: true };
      }
      // An application sent while signed in names its owner; otherwise the owner gets a claim link.
      const org = await createOrg(c, a.kind, a.name, a.email, { ...(a.details ?? {}), application_id: id }, u.id, a.user_id ?? null);
      await audit(c, { type: 'application.decided', applicationId: id, decision, orgId: org.id, by: u.id });
      return { ok: true, org_id: org.id, owner_user_id: org.owner_user_id, owner_claim: org.owner_claim };
    });
  });

  // ---------------------------------------------------------------- tables
  app.get('/v1/admin/tables', async (req) => {
    await requirePlatform(ctx, req);
    const summaries = await tableSummaries(ctx);
    const raw = new Map((await ctx.db.query(
      `select id, certification, max_round_loss_minor, max_user_round_payout_minor, link, link_at, monitor_hands, real_money_approved_at, real_money_approved_by
         from poker_tables`)).rows.map((r) => [r.id, r]));
    return { tables: summaries.map((t) => ({ ...t, ...raw.get(t.id) })) };
  });
  /**
   * Real-money approval of one table (docs/14). A club's own certification is self-attested, so a
   * real-fiat or real-crypto table takes real-money bets only after the PreFlop team approves it
   * here. Revoking stops new real-money bets at once (bets take the table row lock); a club change
   * of mode, currency or certification clears the approval too.
   */
  app.put('/v1/admin/tables/:id/real-money', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const { id } = req.params as { id: string };
    const b = z.object({ approved: z.boolean(), note: z.string().max(500).optional() }).parse(req.body);
    return tx(ctx.db, async (c) => {
      const t = (await c.query<{ mode: PlayMode; kind: string }>('select mode, kind from poker_tables where id = $1 for update', [id])).rows[0];
      if (!t) throw notFound('table');
      // A typed flop has no capture or review: a manual table never carries real money, not even a
      // real-money tournament's bets (docs/19).
      if (b.approved && t.kind === 'manual') throw unprocessable('manual_table', 'a manual table cannot be approved for real money');
      const r = (await c.query<{ real_money_approved_at: Date | null; real_money_approved_by: string | null }>(
        `update poker_tables set real_money_approved_at = case when $2 then now() end, real_money_approved_by = case when $2 then $3 end
          where id = $1 returning real_money_approved_at, real_money_approved_by`, [id, b.approved, u.id])).rows[0]!;
      await audit(c, { type: b.approved ? 'table.real_money_approved' : 'table.real_money_revoked', tableId: id, mode: t.mode, note: b.note ?? null, by: u.id });
      return { id, ...r };
    });
  });
  app.put('/v1/admin/tables/:id/status', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops', 'risk');
    const { id } = req.params as { id: string };
    const b = z.object({ status: z.enum(['active', 'paused']), reason: z.string().max(200).optional() }).parse(req.body);
    const ev = new EventBatch();
    await tx(ctx.db, async (c) => {
      if (b.status === 'paused') {
        // Lock order: open round first, then the table; accepted bets on the open flop are refunded.
        const open = (await c.query<{ id: string }>(`select id from rounds where table_id = $1 and state = 'OPEN'`, [id])).rows[0];
        if (open) await voidRound(c, await lockRound(c, open.id), 'table paused by PreFlop', `user:${u.id}`, ev, ['OPEN']);
      }
      // The PreFlop team lifts any hold (monitor, evidence, platform, floor); the audit keeps which one.
      const prev = (await c.query<{ pause_kind: string | null }>('select pause_kind from poker_tables where id = $1 for update', [id])).rows[0];
      if (!prev) throw notFound('table');
      const r = await c.query(`update poker_tables set status = $2, pause_reason = $3, pause_kind = case when $2 = 'paused' then 'platform' end,
                               monitor = case when $2 = 'active' then '{}'::jsonb else monitor end where id = $1`, [id, b.status, b.status === 'paused' ? b.reason ?? 'paused by PreFlop' : null]);
      if (!r.rowCount) throw notFound('table');
      await audit(c, { type: `table.${b.status === 'paused' ? 'paused' : 'resumed'}`, tableId: id, reason: b.reason ?? null, previousPauseKind: prev.pause_kind, by: u.id });
      if (b.status === 'active') await ensureOpenRound(c, id, ev);
    });
    publish(ev);
    return { ok: true };
  });

  // ---------------------------------------------------------------- manual tables (migration 020)
  // The PreFlop team closes betting and types the flop; free play only (rounds/manual.ts).
  app.post('/v1/admin/tables/manual', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    // Play money only (migration 021): every player has a play wallet; nothing funds a direct chip wallet.
    const b = z.object({ name: z.string().trim().min(2).max(60) }).parse(req.body);
    const mode = 'play', currency = 'PLAY';
    const id = newId('manual');
    const ev = new EventBatch();
    await tx(ctx.db, async (c) => {
      await upsertClub(c, MANUAL_CLUB, 'PreFlop test tables');
      await c.query(
        `insert into poker_tables (id, club_id, name, mode, currency, kind, max_round_loss_minor) values ($1, $2, $3, $4, $5, 'manual', $6)`,
        [id, MANUAL_CLUB, b.name, mode, currency, defaultRoundLossMinor(currency)]);
      await audit(c, { type: 'table.created', tableId: id, kind: 'manual', mode, by: u.id });
      await ensureOpenRound(c, id, ev);
    });
    publish(ev);
    return { id, name: b.name, kind: 'manual', mode, currency };
  });
  app.get('/v1/admin/tables/manual', async (req) => {
    await requirePlatform(ctx, req, 'admin', 'ops');
    const tables = (await ctx.db.query<{ id: string; name: string; mode: string; currency: string; status: string; pause_reason: string | null }>(
      `select id, name, mode, currency, status, pause_reason from poker_tables where kind = 'manual' order by name`)).rows;
    const rounds = (await ctx.db.query<{ id: string; table_id: string; hand_no: number; state: string; opened_at: Date; locked_at: Date | null; settled_at: Date | null; flop: string[] | null; void_reason: string | null; bets: number; staked_minor: number }>(
      `select distinct on (r.table_id) r.id, r.table_id, r.hand_no, r.state, r.opened_at, r.locked_at, r.settled_at, r.flop, r.void_reason,
              (select count(*)::int from bets b where b.round_id = r.id) as bets,
              (select coalesce(sum(stake_minor), 0)::bigint from bets b where b.round_id = r.id) as staked_minor
         from rounds r join poker_tables t on t.id = r.table_id
        where t.kind = 'manual' order by r.table_id, r.hand_no desc`)).rows;
    const last = (await ctx.db.query<{ table_id: string; hand_no: number; flop: string[]; settled_at: Date }>(
      `select distinct on (r.table_id) r.table_id, r.hand_no, r.flop, r.settled_at from rounds r join poker_tables t on t.id = r.table_id
        where t.kind = 'manual' and r.state = 'SETTLED' order by r.table_id, r.hand_no desc`)).rows;
    return {
      enabled: await manualTablesEnabled(ctx.db),
      result_sla_ms: ctx.config.resultSlaMs,
      tables: tables.map((t) => ({ ...t, round: rounds.find((r) => r.table_id === t.id) ?? null, last_settled: last.find((r) => r.table_id === t.id) ?? null })),
    };
  });
  const manualRound = async (c: Tx, tableId: string, handNo: number) => {
    const r = (await c.query<{ id: string }>('select id from rounds where table_id = $1 and hand_no = $2', [tableId, handNo])).rows[0];
    if (!r) throw notFound('round');
    return lockRound(c, r.id);
  };
  app.post('/v1/admin/tables/:id/manual/lock', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const { id } = req.params as { id: string };
    const b = z.object({ hand_no: z.number().int().positive() }).parse(req.body);
    const ev = new EventBatch();
    const out = await tx(ctx.db, async (c) => manualLock(c, await manualRound(c, id, b.hand_no), u.id, ev));
    publish(ev);
    return out;
  });
  app.post('/v1/admin/tables/:id/manual/flop', async (req, reply) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const { id } = req.params as { id: string };
    const b = z.object({ hand_no: z.number().int().positive(), cards: z.array(z.string()).length(3) }).parse(req.body);
    const ev = new EventBatch();
    const out = await tx(ctx.db, async (c) => manualFlop(c, await manualRound(c, id, b.hand_no), b.cards, u.id, ctx.timing, ev));
    publish(ev);
    // The void above is committed; the answer still says the flop was not accepted.
    if (out.state === 'VOID') return reply.code(409).type('application/problem+json').send({ type: 'round_expired', title: out.reason, status: 409, next_round_id: out.next_round_id });
    return out;
  });

  // ---------------------------------------------------------------- ledger & audit
  app.get('/v1/admin/ledger', async (req) => {
    await requirePlatform(ctx, req, 'admin', 'risk', 'ops');
    const q = req.query as { account?: string; kind?: string; limit?: string };
    const accounts = (await ctx.db.query(
      `select a.id as account_id, a.currency, coalesce(sum(e.amount_minor), 0)::bigint as balance_minor
         from ledger_accounts a left join ledger_entries e on e.account_id = a.id
        where ($1::text is null or a.id ilike '%' || $1 || '%') group by a.id order by a.id limit 500`, [q.account ?? null])).rows;
    const entries = (await ctx.db.query(
      `select t.id as tx_id, t.kind, t.ref, t.created_at, e.account_id, e.amount_minor, e.currency
         from ledger_entries e join ledger_tx t on t.id = e.tx_id
        where ($1::text is null or e.account_id ilike '%' || $1 || '%') and ($2::text is null or t.kind = $2)
        order by e.id desc limit $3`, [q.account ?? null, q.kind ?? null, limitParam(q, 1000, 200)])).rows;
    return { accounts, entries };
  });
  app.get('/v1/admin/audit', async (req) => {
    await requirePlatform(ctx, req, 'admin', 'risk');
    const limit = limitParam(req.query, 500, 100);
    return { chain: await verifyAuditChain(ctx.db), events: (await ctx.db.query('select seq, at, hash, event from audit_log order by seq desc limit $1', [limit])).rows };
  });
  app.get('/v1/admin/statements', async (req) => {
    await requirePlatform(ctx, req);
    return { statements: await platformStatements(ctx.db, (req.query as { period?: string }).period) };
  });
  app.get('/v1/admin/payments', async (req) => {
    await requirePlatform(ctx, req);
    return { payments: (await ctx.db.query(
      `select p.id, p.kind, p.method, p.mode, p.currency, p.amount_minor, p.status, p.created_at, p.address, u.email as user_email, p.org_id
         from payments p left join users u on u.id = p.user_id order by p.created_at desc limit 300`)).rows };
  });
}
