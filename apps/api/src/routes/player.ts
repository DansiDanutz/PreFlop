import { type Channel, payoutMinor } from '@preflop/odds-engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { bearer, createSession, endSession, hashPassword, verifyPassword } from '../auth/players.ts';
import { placeRoomBet } from '../bets/rooms.ts';
import { placeBet, resetPlay } from '../bets/service.ts';
import { audit } from '../lib/audit.ts';
import { tx } from '../lib/db.ts';
import { ApiError, badRequest, conflict } from '../lib/errors.ts';
import { EventBatch, publish } from '../lib/events.ts';
import { newId } from '../lib/ids.ts';
import { LOGIN_LOCKOUT, guardedLogin } from '../lib/loginLockout.ts';
import { perIp } from '../lib/rateLimit.ts';
import { applyDueLimits, toEurCents } from '../lib/rg.ts';
import { acct, post } from '../lib/ledger.ts';
import { bindReferral } from '../growth/agents.ts';
import { redeemOwnerClaim } from '../lib/ownerClaims.ts';

const Register = z.object({
  // Partner players get placeholder addresses under .partner.preflop; nobody can register one.
  email: z.string().email().max(200).transform((s) => s.toLowerCase())
    .refine((s) => !/\.partner\.preflop$/.test(s), 'this address is reserved'),
  password: z.string().min(8).max(200),
  display_name: z.string().min(1).max(60),
  country: z.string().length(2).optional(),
  ref: z.string().trim().max(20).optional(),
});
const Login = z.object({ email: z.string().email().transform((s) => s.toLowerCase()), password: z.string() });
const Bet = z.object({
  round_id: z.string(),
  selection_id: z.string(),
  stake_minor: z.number().int().positive(),
  odds_centi: z.number().int().min(100),
  accept_price_change: z.boolean().optional(),
  room_id: z.string().optional(),
});

export async function memberships(ctx: AppContext, userId: string) {
  return (await ctx.db.query<{ org_id: string; kind: string; name: string; role: string; status: string }>(
    `select m.org_id, o.kind, o.name, m.role, o.status from memberships m join organizations o on o.id = m.org_id where m.user_id = $1 order by o.kind, o.name`, [userId])).rows;
}

export async function wallets(ctx: AppContext, userId: string) {
  const rows = (await ctx.db.query<{ account_id: string; balance_minor: number }>(
    `select a.id as account_id, coalesce(sum(e.amount_minor), 0)::bigint as balance_minor
       from ledger_accounts a left join ledger_entries e on e.account_id = a.id
      where a.id like $1 group by a.id order by a.id`, [`${userId}:wallet%`])).rows;
  const orgIds = [...new Set(rows.map((w) => w.account_id.split(':')[1]!).filter((p) => p.startsWith('wallet-')).map((p) => p.slice(7)))];
  const names = new Map((await ctx.db.query<{ id: string; name: string }>('select id, name from organizations where id = any($1::text[])', [orgIds])).rows.map((o) => [o.id, o.name]));
  return rows.map((w) => {
    const [, purpose, mode, currency] = w.account_id.split(':');
    const orgId = purpose!.startsWith('wallet-') ? purpose!.slice(7) : null;
    return { mode, currency, balance_minor: Number(w.balance_minor), org_id: orgId, org_name: orgId ? names.get(orgId) ?? null : null };
  });
}

/** Responsible gaming on real-money bets: daily loss limit (docs/02 §3). */
async function assertRgAllows(ctx: AppContext, userId: string, roundId: string, stake: number) {
  const r = (await ctx.db.query<{ mode: string }>('select mode from rounds where id = $1', [roundId])).rows[0];
  if (!r || (r.mode !== 'real-fiat' && r.mode !== 'real-crypto')) return;
  await applyDueLimits(ctx.db, userId);
  const l = (await ctx.db.query<{ loss_day_minor: number | null }>('select loss_day_minor from rg_limits where user_id = $1', [userId])).rows[0];
  if (l?.loss_day_minor == null) return;
  // The limit is in EUR cents across every real-money currency (stablecoins count 1:1 with EUR).
  const rows = (await ctx.db.query<{ currency: string; n: number }>(
    `select currency, coalesce(sum(stake_minor - coalesce(payout_minor, 0)), 0)::bigint as n from bets
      where user_id = $1 and mode in ('real-fiat','real-crypto') and placed_at > now() - interval '24 hours' and status <> 'void'
      group by currency`, [userId])).rows;
  const lostCents = rows.reduce((a, x) => a + toEurCents(x.currency, Number(x.n)), 0);
  const roundCurrency = (await ctx.db.query<{ currency: string }>('select currency from rounds where id = $1', [roundId])).rows[0]!.currency;
  if (lostCents + toEurCents(roundCurrency, stake) > l.loss_day_minor) throw new ApiError(403, 'limit_reached', 'your daily loss limit would be exceeded');
}

export async function playerRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/v1/auth/register', { preHandler: perIp(ctx.limits.register) }, async (req, reply) => {
    const b = Register.parse(req.body);
    const id = newId('u');
    const hash = await hashPassword(b.password);
    const token = await tx(ctx.db, async (c) => {
      const exists = await c.query('select 1 from users where email = $1', [b.email]);
      if (exists.rowCount) throw conflict('email_taken', 'an account with this email exists');
      await c.query('insert into users (id, email, password_hash, display_name, country) values ($1, $2, $3, $4, $5)', [id, b.email, hash, b.display_name, b.country ?? null]);
      // Every account starts with free play money (no cash value, no fees).
      await post(c, 'play.grant', id, [{ from: acct('PreFlop', 'play-issuance', 'play', 'PLAY'), to: acct(id, 'wallet', 'play', 'PLAY'), amountMinor: ctx.config.playStartMinor }]);
      await audit(c, { type: 'user.registered', userId: id });
      await bindReferral(c, id, b.ref);
      return createSession(c, id);
    });
    return reply.code(201).send({ token, user: { id, email: b.email, display_name: b.display_name } });
  });

  app.post('/v1/auth/login', { preHandler: perIp(ctx.limits.login) }, async (req) => {
    const b = Login.parse(req.body);
    // Per-email lockout in Postgres (all instances): 5 failures in 15 min → 429 login_locked.
    const u = await guardedLogin(ctx.db, b.email, req.ip, LOGIN_LOCKOUT, async (c) => {
      const row = (await c.query<{ id: string; password_hash: string; status: string }>('select id, password_hash, status from users where email = $1 and partner_id is null', [b.email])).rows[0];
      return row && (await verifyPassword(b.password, row.password_hash)) ? row : null;
    });
    // A self-exclusion lifts itself only once its period has ended.
    await ctx.db.query(`update users set status = 'active', self_excluded_until = null where id = $1 and status = 'self_excluded' and self_excluded_until <= now()`, [u.id]);
    if (u.status === 'closed' || u.status === 'suspended') throw new ApiError(403, 'account_blocked', `account is ${u.status}`);
    return { token: await createSession(ctx.db, u.id) };
  });

  app.post('/v1/auth/logout', async (req) => {
    const t = bearer(req.headers.authorization);
    if (t) await endSession(ctx.db, t);
    return { ok: true };
  });

  /** Redeems a single-use owner link from PreFlop: the signed-in account becomes an owner of that organization. */
  app.post('/v1/me/org-claims', { preHandler: perIp(ctx.limits.login) }, async (req) => {
    const u = await ctx.user(req);
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
    return tx(ctx.db, (c) => redeemOwnerClaim(c, token, u.id));
  });

  app.get('/v1/me', async (req) => {
    const u = await ctx.user(req);
    const agent = (await ctx.db.query<{ status: string; code: string }>('select status, code from agents where user_id = $1', [u.id])).rows[0] ?? null;
    return { ...u, memberships: await memberships(ctx, u.id), wallets: await wallets(ctx, u.id), agent };
  });

  // Display name only; email and password changes need their own verified flows.
  app.patch('/v1/me', async (req) => {
    const u = await ctx.user(req);
    const b = z.object({ display_name: z.string().trim().min(1).max(60) }).parse(req.body);
    await tx(ctx.db, async (c) => {
      await c.query('update users set display_name = $2 where id = $1', [u.id, b.display_name]);
      await audit(c, { type: 'user.renamed', userId: u.id });
    });
    return { id: u.id, display_name: b.display_name };
  });

  app.get('/v1/me/wallets', async (req) => ({ wallets: await wallets(ctx, (await ctx.user(req)).id) }));

  app.post('/v1/me/play/reset', async (req) => {
    const u = await ctx.user(req);
    return resetPlay(ctx.db, u.id, ctx.config.playStartMinor);
  });

  app.post('/v1/bets', async (req, reply) => {
    const u = await ctx.user(req);
    ctx.limits.bets.consume(`user:${u.id}`);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 200) throw badRequest('Idempotency-Key header (8–200 chars) required');
    const b = Bet.parse(req.body);
    const ev = new EventBatch();
    if (b.room_id) {
      const rb = await placeRoomBet(ctx.db, {
        userId: u.id, idempotencyKey: key, roomId: b.room_id, roundId: b.round_id, selectionId: b.selection_id, stakeMinor: b.stake_minor, oddsCenti: b.odds_centi,
        ...(b.accept_price_change !== undefined ? { acceptPriceChange: b.accept_price_change } : {}),
      }, ev, ctx.modeEnabled);
      publish(ev);
      return reply.code(201).send(rb);
    }
    await assertRgAllows(ctx, u.id, b.round_id, b.stake_minor);
    const out = await placeBet(ctx.db, {
      userId: u.id, idempotencyKey: key, roundId: b.round_id, selectionId: b.selection_id, stakeMinor: b.stake_minor, oddsCenti: b.odds_centi,
      ...(b.accept_price_change !== undefined ? { acceptPriceChange: b.accept_price_change } : {}),
      channel: (u.partner_id ? 'partner' : 'direct') as Channel, partnerId: u.partner_id,
    }, ev, ctx.modeEnabled);
    publish(ev);
    return reply.code(201).send(out);
  });

  app.get('/v1/me/bets', async (req) => {
    const u = await ctx.user(req);
    const q = req.query as { limit?: string; round_id?: string; status?: string };
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50)));
    const rows = (await ctx.db.query(
      `select b.id as bet_id, b.round_id, b.room_id, b.selection_id, b.stake_minor, b.odds_centi, b.mode, b.currency, b.status, b.payout_minor, b.placed_at, b.settled_at,
              r.hand_no, r.table_id, r.flop, t.name as table_name
         from bets b join rounds r on r.id = b.round_id join poker_tables t on t.id = r.table_id
        where b.user_id = $1 and ($2::text is null or b.round_id = $2) and ($3::text is null or b.status = $3)
        order by b.placed_at desc limit $4`, [u.id, q.round_id ?? null, q.status ?? null, limit])).rows;
    return { bets: rows.map((b) => ({ ...b, potential_payout_minor: payoutMinor(b.stake_minor, b.odds_centi) })) };
  });

  app.get('/v1/me/ledger', async (req) => {
    const u = await ctx.user(req);
    const rows = (await ctx.db.query(
      `select t.kind, t.ref, t.created_at, e.account_id, e.amount_minor, e.currency
         from ledger_entries e join ledger_tx t on t.id = e.tx_id
        where e.account_id like $1 order by e.id desc limit 200`, [`${u.id}:wallet:%`])).rows;
    return { entries: rows };
  });

  app.get('/v1/me/stats', async (req) => {
    const u = await ctx.user(req);
    const s = (await ctx.db.query(
      `select count(*)::int as bets, count(*) filter (where status = 'won')::int as won, count(*) filter (where status = 'lost')::int as lost,
              coalesce(sum(stake_minor) filter (where status in ('won','lost')), 0)::bigint as staked_minor,
              coalesce(sum(payout_minor) filter (where status = 'won'), 0)::bigint as returned_minor
         from bets where user_id = $1 and mode = 'play'`, [u.id])).rows[0];
    return s;
  });
}
