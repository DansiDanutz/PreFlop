import { SELECTIONS, type PlayMode } from '@preflop/odds-engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { roomOdds } from '../bets/rooms.ts';
import { statsOf } from '../bets/service.ts';
import { audit } from '../lib/audit.ts';
import { tx } from '../lib/db.ts';
import { ApiError, conflict, notFound, unprocessable } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { applyDueLimits, toEurCents } from '../lib/rg.ts';
import { assertPositive, buyChips, deposit, withdraw } from '../payments/sandbox.ts';

const SELECTION_IDS = new Set(SELECTIONS.map((s) => s.id));
export const DEFAULT_FAVORITES = ['hand-class:pair', 'colour:all-red', 'colour:all-black', 'suit-pattern:monotone', 'straight:yes', 'any-ace:yes'];

export const roomSelect = `select r.*, o.name as org_name, t.name as table_name from rooms r
  join organizations o on o.id = r.org_id join poker_tables t on t.id = r.table_id`;

/** Public view of a room (invite codes only for the owner's portal). */
export function roomView(r: Record<string, any>, withCode = false) {
  return {
    id: r.id, org_id: r.org_id, org_name: r.org_name, name: r.name, table_id: r.table_id, table_name: r.table_name, mode: r.mode, currency: r.currency,
    house: r.house, rules: r.rules, status: r.status, visibility: r.visibility, ...(withCode ? { invite_code: r.invite_code } : {}),
  };
}

const Application = z.object({
  kind: z.enum(['club', 'partner', 'organizer']),
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  details: z.record(z.unknown()).optional(),
});
const Limits = z.object({
  deposit_day_minor: z.number().int().positive().nullable().optional(),
  loss_day_minor: z.number().int().positive().nullable().optional(),
  session_minutes: z.number().int().min(5).max(24 * 60).nullable().optional(),
});
const Money = z.object({ mode: z.enum(['real-fiat', 'real-crypto']), currency: z.string(), amount_minor: z.number().int().positive(), method: z.string().min(2).max(40), destination: z.string().max(200).optional() });

export async function accountRoutes(app: FastifyInstance, ctx: AppContext) {
  // ---------------------------------------------------------------- favorites
  app.get('/v1/me/favorites', async (req) => {
    const u = await ctx.user(req);
    const r = (await ctx.db.query<{ selection_ids: string[] }>('select selection_ids from user_favorites where user_id = $1', [u.id])).rows[0];
    return { selection_ids: r?.selection_ids ?? DEFAULT_FAVORITES };
  });
  app.put('/v1/me/favorites', async (req) => {
    const u = await ctx.user(req);
    const ids = z.object({ selection_ids: z.array(z.string()).max(6) }).parse(req.body).selection_ids;
    for (const id of ids) if (!SELECTION_IDS.has(id)) throw unprocessable('unknown_selection', `no selection ${id}`);
    if (new Set(ids).size !== ids.length) throw unprocessable('duplicate_favorite', 'each favorite only once');
    await ctx.db.query(`insert into user_favorites (user_id, selection_ids) values ($1, $2)
                        on conflict (user_id) do update set selection_ids = excluded.selection_ids, updated_at = now()`, [u.id, ids]);
    return { selection_ids: ids };
  });

  // ---------------------------------------------------------------- rooms
  app.get('/v1/rooms', async () => ({
    rooms: (await ctx.db.query(`${roomSelect} where r.status = 'active' and r.visibility = 'public' and o.status = 'active' order by r.created_at desc`)).rows.map((r) => roomView(r)),
  }));
  app.get('/v1/rooms/:id', async (req) => {
    const { id } = req.params as { id: string };
    const r = (await ctx.db.query(`${roomSelect} where r.id = $1`, [id])).rows[0];
    if (!r) throw notFound('room');
    if (r.visibility === 'invite') {
      // Invite-only rooms are visible to their members, the organization's portal members and the PreFlop team.
      let allowed = false;
      try {
        const u = await ctx.user(req);
        allowed = u.platform_role !== null
          || !!(await ctx.db.query('select 1 from room_members where room_id = $1 and user_id = $2 union all select 1 from memberships where org_id = $3 and user_id = $2', [id, u.id, r.org_id])).rowCount;
      } catch { allowed = false; }
      if (!allowed) throw notFound('room');
    }
    // per-selection odds for this room's book
    const odds = Object.fromEntries(SELECTIONS.map((s) => [s.id, roomOdds(r as never, statsOf(s.id).wins)]));
    return { ...roomView(r), odds };
  });
  app.post('/v1/rooms/join', async (req) => {
    const u = await ctx.user(req);
    const { code } = z.object({ code: z.string().min(4).max(40) }).parse(req.body);
    const r = (await ctx.db.query(`${roomSelect} where upper(r.invite_code) = upper($1) and r.status = 'active'`, [code.trim()])).rows[0];
    if (!r) throw notFound('room');
    await ctx.db.query('insert into room_members (room_id, user_id) values ($1, $2) on conflict do nothing', [r.id, u.id]);
    return roomView(r);
  });

  // ---------------------------------------------------------------- applications (website forms)
  app.post('/v1/applications', async (req, reply) => {
    const a = Application.parse(req.body);
    let userId: string | null = null;
    try { userId = (await ctx.user(req)).id; } catch { userId = null; }
    const id = newId('app');
    await ctx.db.query('insert into applications (id, kind, user_id, name, email, details) values ($1, $2, $3, $4, $5, $6)',
      [id, a.kind, userId, a.name, a.email.toLowerCase(), JSON.stringify(a.details ?? {})]);
    return reply.code(201).send({ id });
  });

  // ---------------------------------------------------------------- responsible gaming
  app.get('/v1/me/limits', async (req) => {
    const u = await ctx.user(req);
    await applyDueLimits(ctx.db, u.id);
    const l = (await ctx.db.query('select deposit_day_minor, loss_day_minor, session_minutes, pending, pending_effective_at from rg_limits where user_id = $1', [u.id])).rows[0];
    return l ?? { deposit_day_minor: null, loss_day_minor: null, session_minutes: null };
  });
  /** Lowering a limit applies at once; raising or removing it waits 24 h (cooling-off). */
  app.put('/v1/me/limits', async (req) => {
    const u = await ctx.user(req);
    const want = Limits.parse(req.body);
    return tx(ctx.db, async (c) => {
      await c.query('insert into rg_limits (user_id) values ($1) on conflict do nothing', [u.id]);
      await applyDueLimits(c, u.id);
      const cur = (await c.query<Record<string, number | null>>('select deposit_day_minor, loss_day_minor, session_minutes from rg_limits where user_id = $1 for update', [u.id])).rows[0]!;
      const now: Record<string, number | null> = {};
      const later: Record<string, number | null> = {};
      for (const k of ['deposit_day_minor', 'loss_day_minor', 'session_minutes'] as const) {
        if (!(k in want)) continue;
        const v = want[k] ?? null;
        const old = cur[k] ?? null;
        if (old === null ? v !== null : v !== null && v <= old) now[k] = v;
        else if (v !== old) later[k] = v;
      }
      const sets = Object.keys(now).map((k, i) => `${k} = $${i + 2}`);
      if (sets.length) await c.query(`update rg_limits set ${sets.join(', ')}, updated_at = now() where user_id = $1`, [u.id, ...Object.values(now)]);
      if (Object.keys(later).length) await c.query(`update rg_limits set pending = $2, pending_effective_at = now() + interval '24 hours' where user_id = $1`, [u.id, JSON.stringify(later)]);
      await audit(c, { type: 'rg.limits', userId: u.id, now, later });
      return (await c.query('select deposit_day_minor, loss_day_minor, session_minutes, pending, pending_effective_at from rg_limits where user_id = $1', [u.id])).rows[0];
    });
  });
  app.post('/v1/me/self-exclusion', async (req) => {
    const u = await ctx.user(req);
    const { days } = z.object({ days: z.number().int().min(1).max(3650) }).parse(req.body);
    return tx(ctx.db, async (c) => {
      const until = (await c.query<{ until: Date }>(
        `update users set status = 'self_excluded', self_excluded_until = now() + ($2 || ' days')::interval where id = $1 returning self_excluded_until as until`, [u.id, String(days)])).rows[0]!.until;
      await c.query('delete from sessions where user_id = $1', [u.id]);
      await audit(c, { type: 'rg.self_exclusion', userId: u.id, days });
      return { until: until.toISOString() };
    });
  });

  // ---------------------------------------------------------------- KYC (sandbox provider)
  /** The sandbox KYC and payment rails never run in production: real providers replace them (fail closed). */
  const sandboxOnly = () => {
    if (ctx.config.nodeEnv === 'production') throw new ApiError(503, 'provider_not_configured', 'identity and payments need a real provider in production');
  };
  app.post('/v1/me/kyc', async (req) => {
    sandboxOnly();
    const u = await ctx.user(req);
    return tx(ctx.db, async (c) => {
      // Sandbox: documents are "verified" instantly. A real KYC provider sets 'pending' here and
      // its webhook moves the user to 'verified' or 'rejected'.
      await c.query(`update users set kyc_status = 'verified' where id = $1 and kyc_status in ('none','pending','rejected')`, [u.id]);
      await audit(c, { type: 'kyc.verified', userId: u.id, provider: 'sandbox' });
      return { kyc_status: 'verified', provider: 'sandbox' };
    });
  });

  // ---------------------------------------------------------------- payments (sandbox rail)
  const realGate = async (userId: string, mode: PlayMode) => {
    if (!(await ctx.modeEnabled(mode))) throw conflict('mode_disabled', 'real money is not enabled in this territory');
    const u = (await ctx.db.query<{ kyc_status: string; status: string }>('select kyc_status, status from users where id = $1', [userId])).rows[0]!;
    if (u.status !== 'active') throw new ApiError(403, 'self_excluded', 'account cannot transact');
    if (u.kyc_status !== 'verified') throw new ApiError(403, 'kyc_required', 'identity verification required');
  };
  app.get('/v1/me/payments', async (req) => {
    const u = await ctx.user(req);
    return { payments: (await ctx.db.query('select id, kind, method, mode, currency, amount_minor, status, created_at, address from payments where user_id = $1 order by created_at desc limit 100', [u.id])).rows };
  });
  app.post('/v1/me/deposits', async (req, reply) => {
    sandboxOnly();
    const u = await ctx.user(req);
    const b = Money.parse(req.body);
    await realGate(u.id, b.mode);
    const out = await tx(ctx.db, async (c) => {
      // Serialise this user's deposits: the daily total and the new payment are read and written
      // under the user row lock, so concurrent deposits cannot both pass the limit.
      await c.query('select id from users where id = $1 for update', [u.id]);
      await applyDueLimits(c, u.id);
      const l = (await c.query<{ deposit_day_minor: number | null }>('select deposit_day_minor from rg_limits where user_id = $1', [u.id])).rows[0];
      if (l?.deposit_day_minor != null) {
        // Limits are in EUR cents; stablecoins (6 decimals) count 1:1 with EUR, so 10,000 micro-units = 1 cent.
        const today = Number((await c.query<{ n: number }>(
          `select coalesce(sum(case when currency = 'EUR' then amount_minor else amount_minor / 10000 end), 0)::bigint as n
             from payments where user_id = $1 and kind = 'deposit' and status = 'completed' and created_at > now() - interval '24 hours'`, [u.id])).rows[0]!.n);
        const cents = toEurCents(b.currency, b.amount_minor);
        if (today + cents > l.deposit_day_minor) throw new ApiError(403, 'limit_reached', 'your daily deposit limit would be exceeded');
      }
      return deposit(c, u.id, b.mode, b.currency, b.amount_minor, b.method);
    });
    return reply.code(201).send(out);
  });
  app.post('/v1/me/withdrawals', async (req, reply) => {
    sandboxOnly();
    const u = await ctx.user(req);
    const b = Money.parse(req.body);
    await realGate(u.id, b.mode);
    return reply.code(201).send(await tx(ctx.db, (c) => withdraw(c, u.id, b.mode, b.currency, b.amount_minor, b.method, b.destination)));
  });
  app.post('/v1/me/chips/purchases', async (req, reply) => {
    sandboxOnly();
    const u = await ctx.user(req);
    const b = z.object({ chips: z.number().int(), pay_with: z.enum(['EUR', 'USDT', 'USDC']) }).parse(req.body);
    assertPositive(b.chips, 'chips');
    if (!(await ctx.modeEnabled('virtual-chips'))) throw conflict('mode_disabled', 'virtual chips are not enabled');
    return reply.code(201).send(await tx(ctx.db, (c) => buyChips(c, { userId: u.id }, b.chips, b.pay_with)));
  });
}
