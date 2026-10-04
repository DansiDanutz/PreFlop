import { MODES, type PlayMode } from '@preflop/odds-engine';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import type { SessionUser } from '../auth/players.ts';
import {
  CLOSED_LOOP_MODES, DEFAULT_MIN_ROUNDS, REAL_MODES, type LeaderboardRow, type Metric, assertBoardModeAllowed, cancel, fund, lockBoard, poolBalance, settle, standingOf, standings,
} from '../growth/leaderboards.ts';
import { type PromotionRow, claim, isLive } from '../growth/promotions.ts';
import { audit } from '../lib/audit.ts';
import { type Tx, tx } from '../lib/db.ts';
import { forbidden, notFound, unprocessable } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { acct, balance } from '../lib/ledger.ts';
import { requirePlatform } from './admin.ts';
import { requireOrg } from './org.ts';

/** Leaderboards, prize pools and promotions (docs/16). */

const MODE = z.enum(['play', 'virtual-chips', 'diamonds', 'real-fiat', 'real-crypto']);
const DAY = 86_400_000;

const BoardBody = z.object({
  name: z.string().trim().min(3).max(80),
  mode: MODE,
  currency: z.string().min(3).max(8),
  scope: z.enum(['global', 'org', 'table', 'room']).default('global'),
  scope_ref: z.string().max(80).nullable().optional(),
  metric: z.enum(['net', 'volume', 'roi', 'points']),
  min_rounds: z.number().int().min(1).max(10_000).optional(),
  prize_split_bps: z.array(z.number().int().positive()).min(1).max(20),
  starts_at: z.coerce.date(),
  ends_at: z.coerce.date(),
  margin_bps: z.number().int().min(0).max(5000).default(0),
  contribution_bps: z.number().int().min(0).max(500).default(0),
  fund_minor: z.number().int().positive().optional(),
});
type BoardInput = z.infer<typeof BoardBody>;

const PromoBody = z.object({
  kind: z.enum(['announcement', 'leaderboard', 'free-chips', 'org-drop']),
  title: z.string().trim().min(3).max(80),
  body: z.string().trim().max(600).default(''),
  link: z.string().trim().max(300).regex(/^(\/|https:\/\/)/, 'links are site paths or https URLs').nullable().optional(),
  leaderboard_id: z.string().nullable().optional(),
  mode: MODE.nullable().optional(),
  currency: z.string().nullable().optional(),
  amount_minor: z.number().int().positive().nullable().optional(),
  budget_minor: z.number().int().positive().nullable().optional(),
  starts_at: z.coerce.date(),
  ends_at: z.coerce.date(),
  draft: z.boolean().optional(),
});

async function optionalUser(ctx: AppContext, req: FastifyRequest): Promise<SessionUser | null> {
  if (!req.headers.authorization) return null;
  return ctx.user(req).catch(() => null);
}

function validateBoard(b: BoardInput): void {
  if (!MODES[b.mode as PlayMode].currencies.includes(b.currency)) throw unprocessable('invalid_currency', `${b.currency} is not a ${b.mode} currency`);
  if (b.prize_split_bps.reduce((a, x) => a + x, 0) !== 10_000) throw unprocessable('invalid_prize_split', 'prize shares must add up to 100% (10,000 bps)');
  if (b.ends_at <= b.starts_at) throw unprocessable('invalid_period', 'the board must end after it starts');
  if (b.ends_at.getTime() - b.starts_at.getTime() > 92 * DAY) throw unprocessable('invalid_period', 'a board runs at most 92 days');
  if (b.ends_at.getTime() <= Date.now()) throw unprocessable('invalid_period', 'the board must end in the future');
  if ((b.scope === 'global') !== !b.scope_ref) throw unprocessable('invalid_scope', 'a global board has no scope reference; other scopes need one');
  if (b.contribution_bps > 0 && b.mode !== 'real-fiat' && b.mode !== 'real-crypto') throw unprocessable('contribution_real_only', 'player contribution applies to real-money boards only');
}

/** An organization may only rank its own tables and rooms. */
async function assertOrgScope(ctx: AppContext, orgId: string, kind: string, b: BoardInput): Promise<void> {
  if (b.scope === 'global') throw forbidden('scope_not_allowed', 'organization boards cover your own tables or rooms');
  if (b.scope === 'org' && b.scope_ref !== orgId) throw forbidden('scope_not_allowed', 'that is another organization');
  if (b.scope === 'table') {
    if (kind !== 'club') throw forbidden('scope_not_allowed', 'only clubs rank a table');
    const t = (await ctx.db.query('select 1 from poker_tables where id = $1 and club_id = $2', [b.scope_ref, orgId])).rowCount;
    if (!t) throw forbidden('scope_not_allowed', 'that table is not yours');
  }
  if (b.scope === 'room') {
    const r = (await ctx.db.query('select 1 from rooms where id = $1 and org_id = $2', [b.scope_ref, orgId])).rowCount;
    if (!r) throw forbidden('scope_not_allowed', 'that room is not yours');
  }
}

async function createBoard(ctx: AppContext, b: BoardInput, ownerOrg: string | null, by: string): Promise<LeaderboardRow> {
  validateBoard(b);
  await assertBoardModeAllowed(ctx.db, b.mode as PlayMode);
  if (!ownerOrg && CLOSED_LOOP_MODES.has(b.mode as PlayMode)) throw unprocessable('org_required', 'chips and diamonds belong to one organization; its portal creates and funds the board');
  if (ownerOrg && b.margin_bps > 0) throw forbidden('margin_preflop_only', 'only PreFlop boards take a share of PreFlop’s margin');
  // The player contribution comes out of PreFlop's bankroll, so only PreFlop boards take one.
  if (ownerOrg && b.contribution_bps > 0) throw forbidden('contribution_preflop_only', 'only PreFlop boards take a player contribution');
  return tx(ctx.db, async (c) => {
    const id = newId('lb');
    const now = new Date();
    await c.query(
      `insert into leaderboards (id, owner_org, name, mode, currency, scope, scope_ref, metric, min_rounds, prize_split_bps, starts_at, ends_at, status, margin_bps, contribution_bps, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [id, ownerOrg, b.name, b.mode, b.currency, b.scope, b.scope === 'global' ? null : b.scope_ref, b.metric, b.min_rounds ?? DEFAULT_MIN_ROUNDS[b.metric as Metric],
        b.prize_split_bps, b.starts_at, b.ends_at, b.starts_at <= now ? 'active' : 'scheduled', b.margin_bps, b.contribution_bps, by]);
    const lb = (await lockBoard(c, id))!;
    if (b.fund_minor) await fund(c, lb, ownerOrg ? 'org' : 'sponsor', b.fund_minor, by);
    await audit(c, { type: 'leaderboard.created', leaderboardId: id, ownerOrg, by, mode: b.mode, metric: b.metric });
    return lb;
  });
}

/** A board on an invite-only room is seen only by those who may see the room (as GET /v1/rooms/:id). */
async function canSeeBoard(ctx: AppContext, lb: LeaderboardRow, u: SessionUser | null): Promise<boolean> {
  if (lb.scope !== 'room') return true;
  const r = (await ctx.db.query<{ visibility: string; org_id: string }>('select visibility, org_id from rooms where id = $1', [lb.scope_ref])).rows[0];
  if (!r || r.visibility !== 'invite') return true;
  if (!u) return false;
  if (u.platform_role !== null) return true;
  return !!(await ctx.db.query('select 1 from room_members where room_id = $1 and user_id = $2 union all select 1 from memberships where org_id = $3 and user_id = $2',
    [lb.scope_ref, u.id, r.org_id])).rowCount;
}

async function boardView(ctx: AppContext, lb: LeaderboardRow) {
  const org = lb.owner_org ? (await ctx.db.query<{ name: string }>('select name from organizations where id = $1', [lb.owner_org])).rows[0]?.name ?? null : null;
  return {
    id: lb.id, name: lb.name, owner_org: lb.owner_org, owner_name: org ?? 'PreFlop', mode: lb.mode, currency: lb.currency, scope: lb.scope, scope_ref: lb.scope_ref,
    metric: lb.metric, min_rounds: lb.min_rounds, prize_split_bps: lb.prize_split_bps, starts_at: lb.starts_at, ends_at: lb.ends_at, status: lb.status,
    margin_bps: lb.margin_bps, contribution_bps: lb.contribution_bps, pool_minor: lb.status === 'settled' || lb.status === 'cancelled'
      ? Number((await ctx.db.query<{ s: string }>('select coalesce(sum(prize_minor), 0)::text as s from leaderboard_results where leaderboard_id = $1', [lb.id])).rows[0]!.s)
      : await poolBalance(ctx.db, lb),
  };
}

function promoView(p: PromotionRow, claimed?: boolean) {
  return {
    id: p.id, owner_org: p.owner_org, kind: p.kind, title: p.title, body: p.body, link: p.link, leaderboard_id: p.leaderboard_id, mode: p.mode, currency: p.currency,
    amount_minor: p.amount_minor === null ? null : Number(p.amount_minor), budget_minor: p.budget_minor === null ? null : Number(p.budget_minor), claimed_minor: Number(p.claimed_minor),
    starts_at: p.starts_at, ends_at: p.ends_at, status: p.status, review_note: p.review_note, ...(claimed !== undefined ? { claimed } : {}),
  };
}

type PromoInput = z.infer<typeof PromoBody>;

async function createPromotion(ctx: AppContext, b: PromoInput, ownerOrg: string | null, orgKind: string | null, by: string): Promise<PromotionRow> {
  if (b.ends_at <= b.starts_at) throw unprocessable('invalid_period', 'the promotion must end after it starts');
  if (b.kind === 'free-chips') {
    if (ownerOrg) throw forbidden('kind_not_allowed', 'free-chip claims are PreFlop promotions');
    if (!b.amount_minor || b.amount_minor > 100_000) throw unprocessable('invalid_amount', 'free chips per claim: 1 to 100,000');
  }
  if (b.kind === 'org-drop') {
    if (!ownerOrg || (orgKind !== 'organizer' && orgKind !== 'club')) throw forbidden('kind_not_allowed', 'drops come from a club or organizer treasury');
    if (b.mode !== 'virtual-chips' && b.mode !== 'diamonds') throw unprocessable('invalid_mode', 'drops are in chips or diamonds');
    if (!b.currency || !MODES[b.mode].currencies.includes(b.currency)) throw unprocessable('invalid_currency', 'that currency does not belong to the mode');
    if (!b.amount_minor || !b.budget_minor || b.budget_minor < b.amount_minor) throw unprocessable('invalid_amount', 'set an amount per player and a budget at least that large');
    // The treasury must hold the whole budget at submission; every claim re-checks it.
    if ((await balance(ctx.db as unknown as Tx, acct(ownerOrg, 'treasury', b.mode, b.currency))) < b.budget_minor) {
      throw unprocessable('insufficient_treasury', 'the treasury does not hold the whole budget');
    }
  }
  if (b.kind === 'leaderboard') {
    const lb = b.leaderboard_id ? (await ctx.db.query<{ owner_org: string | null }>('select owner_org from leaderboards where id = $1', [b.leaderboard_id])).rows[0] : undefined;
    if (!lb) throw unprocessable('invalid_leaderboard', 'choose an existing leaderboard');
    if (ownerOrg && lb.owner_org !== ownerOrg) throw forbidden('not_your_leaderboard', 'promote your own leaderboards');
  }
  const status = b.draft ? 'draft' : ownerOrg ? 'pending_review' : 'approved';
  const mode = b.kind === 'free-chips' ? 'play' : b.kind === 'org-drop' ? b.mode! : null;
  const currency = b.kind === 'free-chips' ? 'PLAY' : b.kind === 'org-drop' ? b.currency! : null;
  return tx(ctx.db, async (c) => {
    const id = newId('promo');
    const row = (await c.query<PromotionRow>(
      `insert into promotions (id, owner_org, kind, title, body, link, leaderboard_id, mode, currency, amount_minor, budget_minor, starts_at, ends_at, status, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning *`,
      [id, ownerOrg, b.kind, b.title, b.body, b.link ?? null, b.kind === 'leaderboard' ? b.leaderboard_id : null, mode, currency,
        b.kind === 'free-chips' || b.kind === 'org-drop' ? b.amount_minor : null, b.kind === 'org-drop' ? b.budget_minor : null, b.starts_at, b.ends_at, status, by])).rows[0]!;
    await audit(c, { type: 'promotion.created', promotionId: id, ownerOrg, kind: b.kind, status, by });
    return row;
  });
}

export async function growthRoutes(app: FastifyInstance, ctx: AppContext) {
  // ---------------------------------------------------------------- players
  app.get('/v1/leaderboards', async (req) => {
    const q = z.object({ mode: MODE.optional() }).parse(req.query);
    const u = await optionalUser(ctx, req);
    // Visibility is applied before the limit, with the same rule as canSeeBoard.
    const rows = (await ctx.db.query<LeaderboardRow>(
      `select l.* from leaderboards l left join organizations o on o.id = l.owner_org
        where (l.owner_org is null or o.status = 'active') and ($1::text is null or l.mode = $1)
          and (l.status in ('scheduled','active') or (l.status = 'settled' and l.settled_at > now() - interval '30 days'))
          and not exists (select 1 from rooms r where l.scope = 'room' and r.id = l.scope_ref and r.visibility = 'invite' and not $2::boolean
                            and not exists (select 1 from room_members m where m.room_id = r.id and m.user_id = $3)
                            and not exists (select 1 from memberships ms where ms.org_id = r.org_id and ms.user_id = $3))
        order by (l.status = 'settled'), l.ends_at limit 100`, [q.mode ?? null, u?.platform_role != null, u?.id ?? null])).rows;
    return { leaderboards: await Promise.all(rows.map((r) => boardView(ctx, r))) };
  });

  app.get('/v1/leaderboards/:id', async (req) => {
    const { id } = req.params as { id: string };
    const lb = (await ctx.db.query<LeaderboardRow>('select * from leaderboards where id = $1', [id])).rows[0];
    const u = await optionalUser(ctx, req);
    if (!lb || !(await canSeeBoard(ctx, lb, u))) throw notFound('leaderboard');
    const settledResults = lb.status === 'settled'
      ? (await ctx.db.query<{ rank: number; user_id: string; display_name: string; score: string; rounds: number; prize_minor: string; badge: string | null }>(
        `select r.rank, r.user_id, u.display_name, r.score::text as score, r.rounds, r.prize_minor::text as prize_minor, r.badge
           from leaderboard_results r join users u on u.id = r.user_id where r.leaderboard_id = $1 order by r.rank`, [id])).rows
      : null;
    const live = settledResults ? [] : await standings(ctx.db, lb, 50);
    const pool = (await boardView(ctx, lb)).pool_minor;
    // On real-money boards only verified players take prizes (as settle does), so projected prizes skip the rest.
    const prizeRank = new Map<string, number>();
    if (!settledResults) {
      let eligible = live.filter((x) => x.qualified);
      if (REAL_MODES.has(lb.mode)) {
        const ok = new Set((await ctx.db.query<{ id: string }>(`select id from users where id = any($1) and kyc_status = 'verified'`, [eligible.map((x) => x.user_id)])).rows.map((r) => r.id));
        eligible = eligible.filter((x) => ok.has(x.user_id));
      }
      eligible.forEach((x, i) => prizeRank.set(x.user_id, i + 1));
    }
    const projected = (userId: string) => {
      const rank = prizeRank.get(userId);
      return rank && rank <= lb.prize_split_bps.length ? Math.floor((pool * lb.prize_split_bps[rank - 1]!) / 10_000) : 0;
    };
    const rows = settledResults
      ? settledResults.map((r) => ({ rank: r.rank, user_id: r.user_id, display_name: r.display_name, score: Number(r.score), rounds: r.rounds, qualified: true, prize_minor: Number(r.prize_minor), badge: r.badge }))
      : live.map((s) => ({ rank: s.rank, user_id: s.user_id, display_name: s.display_name, score: s.score, rounds: s.rounds, qualified: s.qualified, prize_minor: projected(s.user_id), badge: null }));
    const mine = u ? rows.find((r) => r.user_id === u.id) ?? (settledResults ? null : await standingOf(ctx.db, lb, u.id).then((s) => (s ? { rank: s.rank, user_id: s.user_id, display_name: s.display_name, score: s.score, rounds: s.rounds, qualified: s.qualified, prize_minor: 0, badge: null } : null))) : null;
    // Other players are shown by display name only.
    const strip = <T extends { user_id: string }>(r: T) => { const { user_id: _drop, ...rest } = r; return { ...rest, you: u?.id === r.user_id }; };
    return { leaderboard: await boardView(ctx, lb), standings: rows.map(strip), you: mine ? strip(mine) : null };
  });

  app.get('/v1/me/badges', async (req) => {
    const u = await ctx.user(req);
    return { badges: (await ctx.db.query('select id, kind, label, leaderboard_id, awarded_at from badges where user_id = $1 order by awarded_at desc', [u.id])).rows };
  });

  app.get('/v1/promotions', async (req) => {
    const u = await optionalUser(ctx, req);
    const rows = (await ctx.db.query<PromotionRow & { claimed: boolean; eligible: boolean; org_name: string | null }>(
      `select p.*, o.name as org_name, exists (select 1 from promotion_claims c where c.promotion_id = p.id and c.user_id = $1) as claimed,
              (p.kind <> 'org-drop' or exists (select 1 from room_members m join rooms r on r.id = m.room_id where m.user_id = $1 and r.org_id = p.owner_org)) as eligible
         from promotions p left join organizations o on o.id = p.owner_org
        where p.status = 'approved' and p.starts_at <= now() and p.ends_at > now() and (p.owner_org is null or o.status = 'active')
        order by p.owner_org nulls first, p.starts_at desc limit 50`, [u?.id ?? null])).rows;
    return { promotions: rows.map((p) => ({ ...promoView(p, u ? p.claimed : undefined), owner_name: p.org_name ?? 'PreFlop', ...(u ? { eligible: p.eligible } : {}) })) };
  });

  app.post('/v1/promotions/:id/claim', async (req) => {
    const u = await ctx.user(req);
    const { id } = req.params as { id: string };
    return tx(ctx.db, (c) => claim(c, id, u.id));
  });

  // ---------------------------------------------------------------- PreFlop team
  app.get('/v1/admin/leaderboards', async (req) => {
    await requirePlatform(ctx, req);
    const rows = (await ctx.db.query<LeaderboardRow>('select * from leaderboards order by created_at desc limit 200')).rows;
    return { leaderboards: await Promise.all(rows.map((r) => boardView(ctx, r))) };
  });
  app.post('/v1/admin/leaderboards', async (req, reply) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const lb = await createBoard(ctx, BoardBody.parse(req.body), null, u.id);
    return reply.code(201).send(await boardView(ctx, lb));
  });
  app.post('/v1/admin/leaderboards/:id/fund', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const { id } = req.params as { id: string };
    const { amount_minor } = z.object({ amount_minor: z.number().int().positive() }).parse(req.body);
    await tx(ctx.db, async (c) => {
      const lb = await lockBoard(c, id);
      if (!lb) throw notFound('leaderboard');
      await fund(c, lb, 'sponsor', amount_minor, u.id);
    });
    return boardView(ctx, (await ctx.db.query<LeaderboardRow>('select * from leaderboards where id = $1', [id])).rows[0]!);
  });
  app.post('/v1/admin/leaderboards/:id/settle', async (req) => {
    await requirePlatform(ctx, req, 'admin', 'ops');
    const { id } = req.params as { id: string };
    const done = await tx(ctx.db, (c) => settle(c, id));
    if (!done) throw unprocessable('not_settleable', 'the board has not ended yet, or is already closed');
    return { ok: true };
  });
  app.post('/v1/admin/leaderboards/:id/cancel', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const { id } = req.params as { id: string };
    await tx(ctx.db, (c) => cancel(c, id, u.id));
    return { ok: true };
  });

  app.get('/v1/admin/promotions', async (req) => {
    await requirePlatform(ctx, req);
    // `hint` is the decision model's suggestion (docs/20) for a promotion still in review.
    const rows = (await ctx.db.query<PromotionRow & { org_name: string | null; hint: unknown }>(
      `select p.*, o.name as org_name,
              case when h.ref is null or h.error is not null then null else jsonb_build_object('model', h.model, 'answers', h.answers, 'at', h.created_at) end as hint
         from promotions p left join organizations o on o.id = p.owner_org left join decision_hints h on h.kind = 'promotion' and h.ref = p.id
        order by (p.status = 'pending_review') desc, p.created_at desc limit 300`)).rows;
    return { promotions: rows.map((p) => ({ ...promoView(p), owner_name: p.org_name ?? 'PreFlop', live: isLive(p), hint: p.hint ?? null })) };
  });
  app.post('/v1/admin/promotions', async (req, reply) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    return reply.code(201).send(promoView(await createPromotion(ctx, PromoBody.parse(req.body), null, null, u.id)));
  });
  app.post('/v1/admin/promotions/:id/decision', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const { id } = req.params as { id: string };
    const b = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(300).optional() }).parse(req.body);
    if (b.decision === 'reject' && !b.note) throw unprocessable('note_required', 'say why the promotion is rejected');
    return tx(ctx.db, async (c) => {
      const p = (await c.query<PromotionRow>('select * from promotions where id = $1 for update', [id])).rows[0];
      if (!p) throw notFound('promotion');
      if (p.status !== 'pending_review') throw unprocessable('not_pending', `this promotion is ${p.status}`);
      // Four eyes: nobody reviews a promotion they wrote or that comes from an organization they belong to.
      const mine = p.created_by === u.id || !!(await c.query('select 1 from memberships where org_id = $1 and user_id = $2', [p.owner_org, u.id])).rowCount;
      if (mine) throw forbidden('self_approval', 'another team member reviews this promotion');
      const status = b.decision === 'approve' ? 'approved' : 'rejected';
      await c.query('update promotions set status = $2, review_note = $3, reviewed_by = $4 where id = $1', [id, status, b.note ?? null, u.id]);
      await audit(c, { type: 'promotion.reviewed', promotionId: id, decision: b.decision, by: u.id });
      return { id, status };
    });
  });
  app.post('/v1/admin/promotions/:id/end', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const { id } = req.params as { id: string };
    await tx(ctx.db, async (c) => {
      const r = await c.query(`update promotions set status = 'ended', ends_at = least(ends_at, now()) where id = $1 and status in ('approved','pending_review','draft')`, [id]);
      if (!r.rowCount) throw unprocessable('not_running', 'this promotion is not running');
      await audit(c, { type: 'promotion.ended', promotionId: id, by: u.id });
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- clubs and organizers
  app.get('/v1/org/:id/leaderboards', async (req) => {
    const { id } = req.params as { id: string };
    await requireOrg(ctx, req, id, { kinds: ['club', 'organizer'] });
    const rows = (await ctx.db.query<LeaderboardRow>('select * from leaderboards where owner_org = $1 order by created_at desc', [id])).rows;
    return { leaderboards: await Promise.all(rows.map((r) => boardView(ctx, r))) };
  });
  app.post('/v1/org/:id/leaderboards', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { user, org } = await requireOrg(ctx, req, id, { kinds: ['club', 'organizer'], write: true });
    const b = BoardBody.parse(req.body);
    if (b.mode === 'play') throw forbidden('play_is_preflop', 'free-chip boards are run by PreFlop; organizations run chip or diamond boards');
    await assertOrgScope(ctx, id, org.kind, b);
    const lb = await createBoard(ctx, b, id, user.id);
    return reply.code(201).send(await boardView(ctx, lb));
  });
  app.post('/v1/org/:id/leaderboards/:lb/fund', async (req) => {
    const { id, lb: lbId } = req.params as { id: string; lb: string };
    const { user } = await requireOrg(ctx, req, id, { kinds: ['club', 'organizer'], write: true });
    const { amount_minor } = z.object({ amount_minor: z.number().int().positive() }).parse(req.body);
    await tx(ctx.db, async (c) => {
      const lb = await lockBoard(c, lbId);
      if (!lb || lb.owner_org !== id) throw notFound('leaderboard');
      await fund(c, lb, 'org', amount_minor, user.id);
    });
    return boardView(ctx, (await ctx.db.query<LeaderboardRow>('select * from leaderboards where id = $1', [lbId])).rows[0]!);
  });

  app.get('/v1/org/:id/promotions', async (req) => {
    const { id } = req.params as { id: string };
    await requireOrg(ctx, req, id, { kinds: ['club', 'organizer'] });
    const rows = (await ctx.db.query<PromotionRow>('select * from promotions where owner_org = $1 order by created_at desc', [id])).rows;
    return { promotions: rows.map((p) => ({ ...promoView(p), live: isLive(p) })) };
  });
  app.post('/v1/org/:id/promotions', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { user, org } = await requireOrg(ctx, req, id, { kinds: ['club', 'organizer'], write: true });
    const b = PromoBody.parse(req.body);
    return reply.code(201).send(promoView(await createPromotion(ctx, b, id, org.kind, user.id)));
  });
  /** Sends a draft for review. */
  app.post('/v1/org/:id/promotions/:promo/submit', async (req) => {
    const { id, promo } = req.params as { id: string; promo: string };
    const { user } = await requireOrg(ctx, req, id, { kinds: ['club', 'organizer'], write: true });
    return tx(ctx.db, async (c) => {
      const r = await c.query(`update promotions set status = 'pending_review' where id = $1 and owner_org = $2 and status = 'draft' returning id`, [promo, id]);
      if (!r.rowCount) throw unprocessable('not_draft', 'only your own draft promotions can be submitted');
      await audit(c, { type: 'promotion.submitted', promotionId: promo, by: user.id });
      return { id: promo, status: 'pending_review' };
    });
  });
}
