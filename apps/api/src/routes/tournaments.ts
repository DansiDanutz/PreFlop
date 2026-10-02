import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import type { SessionUser } from '../auth/players.ts';
import {
  type Phase, type StandingRow, type TournamentRow, allocatePrizes, cancel, createTournament, entriesOf, lateRegUntil, phaseOf,
  placeTournamentBet, prizeEligible, prizePoolOf, rankEntries, register, unregister,
} from '../growth/tournaments.ts';
import { tx } from '../lib/db.ts';
import { EventBatch, publish } from '../lib/events.ts';
import { notFound } from '../lib/errors.ts';
import { requirePlatform } from './admin.ts';
import { requireOrg } from './org.ts';

/** Tournaments (docs/17): lobby, dashboard, registration and bets; team and organization management. */

const MODE = z.enum(['play', 'virtual-chips', 'diamonds', 'real-fiat', 'real-crypto']);
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Body = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(600).optional(),
  mode: MODE,
  currency: z.string().min(3).max(8),
  buy_in_minor: minor,
  fee_bps: z.number().int().min(0).max(2000),
  added_minor: minor.optional(),
  starting_stack: z.number().int().positive().max(1_000_000_000),
  bets_allowed: z.number().int().min(1).max(500),
  min_stake: z.number().int().positive(),
  max_stake: z.number().int().positive().nullable().optional(),
  starts_at: z.coerce.date(),
  duration_minutes: z.number().int().min(5).max(7 * 24 * 60),
  late_reg_minutes: z.number().int().min(0).max(7 * 24 * 60).optional(),
  min_entries: z.number().int().min(1).max(100_000).optional(),
  max_entries: z.number().int().min(1).max(100_000).nullable().optional(),
  payout_bps: z.array(z.number().int().positive()).min(1).max(50),
});
const BetBody = z.object({
  round_id: z.string().min(1).max(80),
  selection_id: z.string().min(1).max(80),
  stake: z.number().int().positive(),
  odds_centi: z.number().int().positive(),
  accept_price_change: z.boolean().optional(),
  idempotency_key: z.string().min(8).max(100),
});

async function optionalUser(ctx: AppContext, req: FastifyRequest): Promise<SessionUser | null> {
  if (!req.headers.authorization) return null;
  return ctx.user(req).catch(() => null);
}

interface Agg { entries: number; buy_ins: number }

async function aggregates(ctx: AppContext, ids: string[]): Promise<Map<string, Agg>> {
  const rows = (await ctx.db.query<{ tournament_id: string; entries: string; buy_ins: string }>(
    `select tournament_id, count(*) as entries, coalesce(sum(buy_in_minor), 0) as buy_ins from tournament_entries
      where tournament_id = any($1) group by tournament_id`, [ids])).rows;
  return new Map(rows.map((r) => [r.tournament_id, { entries: Number(r.entries), buy_ins: Number(r.buy_ins) }]));
}

function view(t: TournamentRow & { owner_name?: string | null }, agg: Agg | undefined, now: Date, registered?: boolean) {
  const a = agg ?? { entries: 0, buy_ins: 0 };
  const phase: Phase = phaseOf(t, now);
  const regUntil = lateRegUntil(t);
  return {
    id: t.id, name: t.name, description: t.description, owner_org: t.owner_org, owner_name: t.owner_name ?? 'PreFlop',
    mode: t.mode, currency: t.currency, buy_in_minor: Number(t.buy_in_minor), fee_bps: t.fee_bps, added_minor: Number(t.added_minor),
    starting_stack: Number(t.starting_stack), bets_allowed: t.bets_allowed, min_stake: Number(t.min_stake), max_stake: t.max_stake === null ? null : Number(t.max_stake),
    starts_at: t.starts_at.toISOString(), ends_at: t.ends_at.toISOString(), duration_minutes: Math.round((t.ends_at.getTime() - t.starts_at.getTime()) / 60_000),
    late_reg_until: regUntil.toISOString(), min_entries: t.min_entries, max_entries: t.max_entries, entries: a.entries,
    prize_pool_minor: prizePoolOf(t, a.buy_ins).pool, payout_bps: t.payout_bps, status: phase,
    registration_open: t.status === 'open' && now < regUntil && now < t.ends_at && (t.max_entries === null || a.entries < t.max_entries),
    cancel_reason: t.cancel_reason,
    ...(registered === undefined ? {} : { you: { registered } }),
  };
}

const select = `select t.*, o.name as owner_name from tournaments t left join organizations o on o.id = t.owner_org`;

/** The dashboard: the tournament, everyone's standing, and the caller's own entry with bets. */
async function detail(ctx: AppContext, id: string, u: SessionUser | null) {
  const now = new Date();
  const t = (await ctx.db.query<TournamentRow & { owner_name: string | null }>(`${select} where t.id = $1`, [id])).rows[0];
  if (!t) throw notFound('tournament');
  const entries = await entriesOf(ctx.db, id);
  const agg = { entries: entries.length, buy_ins: Number((await ctx.db.query<{ s: string }>('select coalesce(sum(buy_in_minor), 0) as s from tournament_entries where tournament_id = $1', [id])).rows[0]!.s) };
  const done = t.status === 'completed';
  const ranked = rankEntries(entries);
  // Projected with the same eligibility rule completion applies, so the dashboard shows what will be paid.
  const projected = done ? new Map<string, number>() : allocatePrizes(prizePoolOf(t, agg.buy_ins).pool, t.payout_bps, rankEntries(await prizeEligible(ctx.db, t, entries)));
  const standing = (e: StandingRow & { rank: number }) => ({
    rank: done && e.final_rank !== null ? e.final_rank : e.rank,
    display_name: e.display_name, stack: e.stack, bets_used: e.bets_used, bets_left: Math.max(0, t.bets_allowed - e.bets_used),
    pending_bets: e.pending, status: e.status, prize_minor: done ? (e.prize_minor ?? 0) : t.status === 'cancelled' ? 0 : (projected.get(e.user_id) ?? 0),
    you: u?.id === e.user_id,
  });
  const mine = u ? ranked.find((e) => e.user_id === u.id) : undefined;
  const bets = mine
    ? (await ctx.db.query<{ id: string; round_id: string; table_id: string; selection_id: string; stake: string; odds_centi: number; status: string; payout: string | null; created_at: Date; settled_at: Date | null }>(
      `select b.id, b.round_id, r.table_id, b.selection_id, b.stake, b.odds_centi, b.status, b.payout, b.created_at, b.settled_at
         from tournament_bets b join rounds r on r.id = b.round_id where b.tournament_id = $1 and b.user_id = $2 order by b.created_at desc`, [id, u!.id])).rows
      .map((b) => ({ ...b, stake: Number(b.stake), payout: b.payout === null ? null : Number(b.payout), created_at: b.created_at.toISOString(), settled_at: b.settled_at?.toISOString() ?? null }))
    : [];
  return {
    tournament: view(t, agg, now, u ? !!mine : undefined),
    // Other players by display name only.
    standings: ranked.slice(0, 200).map(standing),
    you: mine ? { ...standing(mine), bets } : null,
    server_time: now.toISOString(),
  };
}

async function list(ctx: AppContext, where: string, params: unknown[], u: SessionUser | null) {
  const now = new Date();
  const rows = (await ctx.db.query<TournamentRow & { owner_name: string | null }>(`${select} where ${where} order by t.starts_at limit 200`, params)).rows;
  const agg = await aggregates(ctx, rows.map((r) => r.id));
  const mine = u ? new Set((await ctx.db.query<{ tournament_id: string }>('select tournament_id from tournament_entries where user_id = $1 and tournament_id = any($2)', [u.id, rows.map((r) => r.id)])).rows.map((r) => r.tournament_id)) : null;
  return rows.map((t) => view(t, agg.get(t.id), now, mine ? mine.has(t.id) : undefined));
}

export async function tournamentRoutes(app: FastifyInstance, ctx: AppContext) {
  const withEvents = async <T>(fn: (ev: EventBatch) => Promise<T>): Promise<T> => {
    const ev = new EventBatch();
    const out = await fn(ev);
    publish(ev);
    return out;
  };

  // ---------------------------------------------------------------- players
  app.get('/v1/tournaments', async (req) => {
    const { status } = z.object({ status: z.enum(['upcoming', 'running', 'finished']).optional() }).parse(req.query);
    const u = await optionalUser(ctx, req);
    const visible = `(t.owner_org is null or exists (select 1 from organizations o2 where o2.id = t.owner_org and o2.status = 'active'))`;
    const where = {
      upcoming: `t.status = 'open' and t.starts_at > now()`,
      running: `t.status = 'open' and t.starts_at <= now()`,
      finished: `t.status in ('completed','cancelled') and t.completed_at > now() - interval '30 days'`,
      all: `(t.status = 'open' or t.completed_at > now() - interval '30 days')`,
    }[status ?? 'all'];
    return { tournaments: await list(ctx, `${visible} and ${where}`, [], u) };
  });

  app.get('/v1/tournaments/:id', async (req) => detail(ctx, (req.params as { id: string }).id, await optionalUser(ctx, req)));

  app.post('/v1/tournaments/:id/register', async (req) => {
    const u = await ctx.user(req);
    const { id } = req.params as { id: string };
    await withEvents((ev) => tx(ctx.db, (c) => register(c, id, u.id, ev)));
    return detail(ctx, id, u);
  });

  app.delete('/v1/tournaments/:id/register', async (req) => {
    const u = await ctx.user(req);
    const { id } = req.params as { id: string };
    const refunded = await withEvents((ev) => tx(ctx.db, (c) => unregister(c, id, u.id, ev)));
    return { ok: true, refunded_minor: refunded };
  });

  app.post('/v1/tournaments/:id/bets', async (req, reply) => {
    const u = await ctx.user(req);
    ctx.limits.bets.consume(`user:${u.id}`);
    const { id } = req.params as { id: string };
    const b = BetBody.parse(req.body);
    const bet = await withEvents((ev) => placeTournamentBet(ctx.db, id, u.id, {
      roundId: b.round_id, selectionId: b.selection_id, stake: b.stake, oddsCenti: b.odds_centi, acceptPriceChange: b.accept_price_change, idempotencyKey: b.idempotency_key,
    }, ev));
    return reply.code(201).send({
      id: bet.id, round_id: bet.round_id, table_id: bet.table_id, selection_id: bet.selection_id, stake: Number(bet.stake), odds_centi: bet.odds_centi,
      status: bet.status, payout: bet.payout === null ? null : Number(bet.payout), created_at: bet.created_at.toISOString(), settled_at: bet.settled_at?.toISOString() ?? null,
    });
  });

  // ---------------------------------------------------------------- PreFlop team
  app.get('/v1/admin/tournaments', async (req) => {
    await requirePlatform(ctx, req);
    return { tournaments: await list(ctx, `true`, [], null) };
  });
  app.get('/v1/admin/tournaments/:id', async (req) => {
    await requirePlatform(ctx, req);
    return detail(ctx, (req.params as { id: string }).id, null);
  });
  app.post('/v1/admin/tournaments', async (req, reply) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const b = Body.parse(req.body);
    const t = await tx(ctx.db, (c) => createTournament(c, b, null, u.id));
    return reply.code(201).send(view(t, undefined, new Date()));
  });
  app.post('/v1/admin/tournaments/:id/cancel', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
    await withEvents((ev) => tx(ctx.db, (c) => cancel(c, (req.params as { id: string }).id, reason, u.id, ev)));
    return { ok: true };
  });

  // ---------------------------------------------------------------- organizations (chips and diamonds)
  app.get('/v1/org/:id/tournaments', async (req) => {
    const { id } = req.params as { id: string };
    await requireOrg(ctx, req, id, { kinds: ['club', 'organizer'] });
    return { tournaments: await list(ctx, `t.owner_org = $1`, [id], null) };
  });
  app.post('/v1/org/:id/tournaments', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { user } = await requireOrg(ctx, req, id, { kinds: ['club', 'organizer'], write: true });
    const b = Body.parse(req.body);
    const t = await tx(ctx.db, (c) => createTournament(c, b, id, user.id));
    return reply.code(201).send(view(t, undefined, new Date()));
  });
  app.post('/v1/org/:id/tournaments/:t/cancel', async (req) => {
    const { id, t } = req.params as { id: string; t: string };
    const { user } = await requireOrg(ctx, req, id, { kinds: ['club', 'organizer'], write: true });
    const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
    const own = (await ctx.db.query('select 1 from tournaments where id = $1 and owner_org = $2', [t, id])).rowCount;
    if (!own) throw notFound('tournament');
    await withEvents((ev) => tx(ctx.db, (c) => cancel(c, t, reason, user.id, ev)));
    return { ok: true };
  });
}
