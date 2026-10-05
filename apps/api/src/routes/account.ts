import { SELECTIONS, type PlayMode } from '@preflop/odds-engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { roomOdds } from '../bets/rooms.ts';
import { statsOf } from '../bets/service.ts';
import { audit } from '../lib/audit.ts';
import { type Tx, tx } from '../lib/db.ts';
import { ApiError, conflict, notFound, unprocessable } from '../lib/errors.ts';
import { idempotentMoneyWrite, requireIdempotencyKey } from '../lib/idempotency.ts';
import { newId } from '../lib/ids.ts';
import { BoundedRecord, CurrencyCode, PositiveMinor } from '../lib/json.ts';
import { perIp } from '../lib/rateLimit.ts';
import { applyDueLimits, toEurCents } from '../lib/rg.ts';
import { assertRealMoneyAccount } from '../lib/accounts.ts';
import { modeEnabled as modeEnabledIn } from '../growth/leaderboards.ts';
import { assertPositive, buyChips, deposit, withdraw } from '../payments/service.ts';
import { railFor, requireProvider } from '../providers/index.ts';

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
  // The website form's free fields: bounded so a public, unauthenticated route cannot store
  // megabytes or thousands of keys per submission (the adviser scrub and the console read them).
  details: BoundedRecord({ maxChars: 16_000, maxDepth: 6 }).optional(),
});
/** The applications form is public: 32 KB is plenty for every field it has. */
export const APPLICATION_BODY_LIMIT = 32 * 1024;
const Limits = z.object({
  deposit_day_minor: PositiveMinor.nullable().optional(),
  loss_day_minor: PositiveMinor.nullable().optional(),
  session_minutes: z.number().int().min(5).max(24 * 60).nullable().optional(),
});
const Money = z.object({ mode: z.enum(['real-fiat', 'real-crypto']), currency: CurrencyCode, amount_minor: PositiveMinor, method: z.string().min(2).max(40), destination: z.string().max(200).optional() });

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
  // Unauthenticated and public: the registration limiter applies per IP, and the body is small.
  app.post('/v1/applications', { preHandler: perIp(ctx.limits.register), bodyLimit: APPLICATION_BODY_LIMIT }, async (req, reply) => {
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
  /**
   * Lowering a limit (or setting one where there was none) applies at once; raising or removing it
   * waits 24 h (cooling-off). An explicit edit of a field supersedes that field's queued change:
   * reducing to 50 after asking for 200 cancels the 200, and re-stating the current value cancels a
   * queued raise. Queued changes of fields not in the request are kept. Queued changes share one
   * deadline, and a new raise restarts it: a raise can only wait longer, never less.
   */
  app.put('/v1/me/limits', async (req) => {
    const u = await ctx.user(req);
    const want = Limits.parse(req.body);
    return tx(ctx.db, async (c) => {
      await c.query('insert into rg_limits (user_id) values ($1) on conflict do nothing', [u.id]);
      await applyDueLimits(c, u.id);
      const cur = (await c.query<Record<string, number | null> & { pending: Record<string, number | null> | null }>(
        'select deposit_day_minor, loss_day_minor, session_minutes, pending from rg_limits where user_id = $1 for update', [u.id])).rows[0]!;
      const now: Record<string, number | null> = {};
      const later: Record<string, number | null> = {};
      const pending: Record<string, number | null> = { ...(cur.pending ?? {}) };
      const superseded: string[] = [];
      for (const k of ['deposit_day_minor', 'loss_day_minor', 'session_minutes'] as const) {
        if (!(k in want)) continue;
        const v = want[k] ?? null;
        const old = cur[k] ?? null;
        if (k in pending) {
          delete pending[k];
          superseded.push(k);
        }
        if (old === null ? v !== null : v !== null && v <= old) now[k] = v;
        else if (v !== old) later[k] = v;
      }
      const sets = Object.keys(now).map((k, i) => `${k} = $${i + 2}`);
      if (sets.length) await c.query(`update rg_limits set ${sets.join(', ')}, updated_at = now() where user_id = $1`, [u.id, ...Object.values(now)]);
      const raised = Object.keys(later).length > 0;
      if (superseded.length || raised) {
        const next = { ...pending, ...later };
        await c.query(
          `update rg_limits set pending = $2::jsonb,
                  pending_effective_at = case when $2::jsonb is null then null when $3 then now() + interval '24 hours' else pending_effective_at end
            where user_id = $1`, [u.id, Object.keys(next).length ? JSON.stringify(next) : null, raised]);
      }
      await audit(c, { type: 'rg.limits', userId: u.id, now, later, superseded });
      return (await c.query('select deposit_day_minor, loss_day_minor, session_minutes, pending, pending_effective_at from rg_limits where user_id = $1', [u.id])).rows[0];
    });
  });
  /**
   * Self-exclusion for `days` days. It is never shortened: excluding again while one is in force
   * keeps the later end (greatest of the two). A suspended or closed account keeps that status, so
   * the sign-in lift (routes/player.ts) can never turn it into an active one. Migration 016 refuses
   * status 'active' while self_excluded_until is in the future, whatever path tries it.
   */
  app.post('/v1/me/self-exclusion', async (req) => {
    const u = await ctx.user(req);
    const { days } = z.object({ days: z.number().int().min(1).max(3650) }).parse(req.body);
    return tx(ctx.db, async (c) => {
      const prev = (await c.query<{ until: Date | null }>('select self_excluded_until as until from users where id = $1 for update', [u.id])).rows[0]!.until;
      const until = (await c.query<{ until: Date }>(
        `update users set status = case when status in ('suspended', 'closed') then status else 'self_excluded' end,
                self_excluded_until = greatest(self_excluded_until, now() + ($2 || ' days')::interval)
          where id = $1 returning self_excluded_until as until`, [u.id, String(days)])).rows[0]!.until;
      await c.query('delete from sessions where user_id = $1', [u.id]);
      await audit(c, { type: 'rg.self_exclusion', userId: u.id, days, until: until.toISOString(), previousUntil: prev ? prev.toISOString() : null });
      return { until: until.toISOString() };
    });
  });

  // ---------------------------------------------------------------- KYC (provider adapter, docs/21)
  /** Without a configured provider every real-money entry point answers 503 provider_not_configured (fail closed). */
  const kycProvider = () => requireProvider(ctx.providers.kyc, 'identity verification');
  const rail = (mode: PlayMode) => requireProvider(railFor(ctx.providers, mode), mode === 'real-crypto' ? 'stablecoin payments' : 'card and bank payments');
  app.post('/v1/me/kyc', async (req) => {
    const kyc = kycProvider();
    const u = await ctx.user(req);
    return tx(ctx.db, async (c) => {
      // Lock the user row: a verdict arriving by webhook while this runs is serialised with it.
      const cur = (await c.query<{ kyc_status: string; email: string }>('select kyc_status, email from users where id = $1 for update', [u.id])).rows[0]!;
      if (cur.kyc_status === 'verified') return { kyc_status: 'verified', provider: kyc.name };
      // The sandbox verifies instantly. A real provider returns `pending` and a place to continue;
      // its webhook then moves the user to verified or rejected (routes/webhooks.ts).
      const r = await kyc.start(c, { id: u.id, email: cur.email });
      await c.query('update users set kyc_status = $2, kyc_provider = $3, kyc_ref = $4 where id = $1', [u.id, r.status, kyc.name, r.ref]);
      await audit(c, { type: `kyc.${r.status}`, userId: u.id, provider: kyc.name, ref: r.ref });
      return { kyc_status: r.status, provider: kyc.name, redirect_url: r.redirect_url ?? null };
    });
  });

  // ---------------------------------------------------------------- payments (provider rails)
  // Run INSIDE idempotentMoneyWrite's callback: a retry of a payment that already committed must
  // replay its stored response, even if the account, KYC, territory or mode changed since.
  // Every query goes through the transaction's own connection: asking the pool for a second one
  // while holding this one could starve the pool under concurrent payments.
  const realGate = async (c: Tx, userId: string, mode: PlayMode) => {
    if (!(await modeEnabledIn(c, mode))) throw conflict('mode_disabled', 'real money is not enabled in this territory');
    const u = (await c.query<{ kyc_status: string; status: string }>('select kyc_status, status from users where id = $1', [userId])).rows[0]!;
    if (u.status !== 'active') throw new ApiError(403, 'self_excluded', 'account cannot transact');
    if (u.kyc_status !== 'verified') throw new ApiError(403, 'kyc_required', 'identity verification required');
  };
  app.get('/v1/me/payments', async (req) => {
    const u = await ctx.user(req);
    return { payments: (await ctx.db.query('select id, kind, method, mode, currency, amount_minor, status, created_at, address from payments where user_id = $1 order by created_at desc limit 100', [u.id])).rows };
  });
  /**
   * Money in and out needs an Idempotency-Key (8–200 characters, as POST /v1/bets). The payment id
   * and its ledger postings are derived from (player, key) and the response is stored with them:
   * a retry returns the original payment and never moves money twice; the same key with a
   * different request gets 422 idempotency_mismatch.
   */
  app.post('/v1/me/deposits', async (req, reply) => {
    const u = await ctx.user(req);
    const key = requireIdempotencyKey(req);
    const b = Money.parse(req.body);
    const r = rail(b.mode);
    const res = await idempotentMoneyWrite(ctx.db, `user:${u.id}`, key, req, 'pay', async (c, ref) => {
      await realGate(c, u.id, b.mode);
      // Deposits only: a withdrawal returns the player's own money and is never held back by these.
      await assertRealMoneyAccount(c, u.id); // age, verified email, territory
      // Serialise this user's deposits: the daily total and the new payment are read and written
      // under the user row lock, so concurrent deposits cannot both pass the limit.
      await c.query('select id from users where id = $1 for update', [u.id]);
      await applyDueLimits(c, u.id);
      const l = (await c.query<{ deposit_day_minor: number | null }>('select deposit_day_minor from rg_limits where user_id = $1', [u.id])).rows[0];
      if (l?.deposit_day_minor != null) {
        // Limits are in EUR cents. Deposits are summed per currency in exact minor units, the new one
        // included, and converted once (stablecoins round up): splitting a deposit into sub-cent
        // pieces never makes it count for less.
        const rows = (await c.query<{ currency: string; n: number }>(
          `select currency, coalesce(sum(amount_minor), 0)::bigint as n from payments
            where user_id = $1 and kind = 'deposit' and status = 'completed' and created_at > now() - interval '24 hours' group by currency`, [u.id])).rows;
        const totals = new Map(rows.map((x) => [x.currency, Number(x.n)]));
        totals.set(b.currency, (totals.get(b.currency) ?? 0) + b.amount_minor);
        const cents = [...totals].reduce((a, [cur, n]) => a + toEurCents(cur, n), 0);
        if (cents > l.deposit_day_minor) throw new ApiError(403, 'limit_reached', 'your daily deposit limit would be exceeded');
      }
      return { status: 201, body: await deposit(c, r, u.id, b.mode, b.currency, b.amount_minor, b.method, ref) };
    });
    return reply.code(res.status).send(res.body);
  });
  app.post('/v1/me/withdrawals', async (req, reply) => {
    const u = await ctx.user(req);
    const key = requireIdempotencyKey(req);
    const b = Money.parse(req.body);
    const r = rail(b.mode);
    const res = await idempotentMoneyWrite(ctx.db, `user:${u.id}`, key, req, 'pay', async (c, ref) => {
      await realGate(c, u.id, b.mode);
      return { status: 201, body: await withdraw(c, r, u.id, b.mode, b.currency, b.amount_minor, b.method, b.destination, ref) };
    });
    return reply.code(res.status).send(res.body);
  });
  app.post('/v1/me/chips/purchases', async (req, reply) => {
    const u = await ctx.user(req);
    const key = requireIdempotencyKey(req);
    const b = z.object({ chips: z.number().int(), pay_with: z.enum(['EUR', 'USDT', 'USDC']) }).parse(req.body);
    assertPositive(b.chips, 'chips');
    const r = rail(b.pay_with === 'EUR' ? 'real-fiat' : 'real-crypto');
    const res = await idempotentMoneyWrite(ctx.db, `user:${u.id}`, key, req, 'pay', async (c, ref) => {
      if (!(await modeEnabledIn(c, 'virtual-chips'))) throw conflict('mode_disabled', 'virtual chips are not enabled');
      return { status: 201, body: await buyChips(c, r, { userId: u.id }, b.chips, b.pay_with, ref) };
    });
    return reply.code(res.status).send(res.body);
  });
}
