import { type Channel } from '@preflop/odds-engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PositiveMinor } from '../lib/json.ts';
import type { AppContext } from '../app.ts';
import { bearer, createSession, endSession, hashPassword, tokenHash, verifyPassword, verifyAgainstNobody } from '../auth/players.ts';
import { placeRoomBet } from '../bets/rooms.ts';
import { placeBet, potentialPayoutMinor, resetPlay } from '../bets/service.ts';
import { audit } from '../lib/audit.ts';
import { tx } from '../lib/db.ts';
import { Country, DateOfBirth, MIN_AGE, assertMayBet, assertSessionTime, isAdult, loadTerritories } from '../lib/accounts.ts';
import { sendVerification } from '../lib/emailTokens.ts';
import { ApiError, badRequest, conflict, unauthorized } from '../lib/errors.ts';
import { EventBatch, publish } from '../lib/events.ts';
import { newId } from '../lib/ids.ts';
import { LOGIN_LOCKOUT, LoginRefusal, guardedLogin } from '../lib/loginLockout.ts';
import { limitParam } from '../lib/query.ts';
import { perIp } from '../lib/rateLimit.ts';
import { assertLossLimit, toEurCents } from '../lib/rg.ts';
import { acct, post } from '../lib/ledger.ts';
import { bindReferral } from '../growth/agents.ts';
import { redeemOwnerClaim } from '../lib/ownerClaims.ts';
import { checkOtp, staffMfaRequired } from './security.ts';

const Register = z.object({
  // Partner players get placeholder addresses under .partner.preflop; nobody can register one.
  email: z.string().email().max(200).transform((s) => s.toLowerCase())
    .refine((s) => !/\.partner\.preflop$/.test(s), 'this address is reserved'),
  password: z.string().min(8).max(200),
  display_name: z.string().min(1).max(60),
  // Age gate (18+, checked here on the server) and the self-declared country of residence.
  date_of_birth: DateOfBirth,
  country: Country,
  ref: z.string().trim().max(20).optional(),
});
const Login = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().max(200),
  // One-time code, required when the account has two-factor authentication on.
  otp: z.string().trim().max(10).optional(),
});
const qText = z.string().min(1).max(200).optional();
const MyBetsQuery = z.object({ round_id: qText, status: qText, before: qText, mode: qText, currency: qText, room_id: qText }).passthrough();
const Bet = z.object({
  round_id: z.string(),
  selection_id: z.string(),
  stake_minor: PositiveMinor,
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
  const roundCurrency = (await ctx.db.query<{ currency: string }>('select currency from rounds where id = $1', [roundId])).rows[0]!.currency;
  await assertLossLimit(ctx.db, userId, toEurCents(roundCurrency, stake));
}

export async function playerRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/v1/auth/register', { preHandler: perIp(ctx.limits.register) }, async (req, reply) => {
    const b = Register.parse(req.body);
    if (!isAdult(b.date_of_birth)) throw new ApiError(403, 'underage', `PreFlop is for players aged ${MIN_AGE} or over`);
    // The country is self-declared until a KYC or geolocation provider confirms it (lib/accounts.ts).
    if ((await loadTerritories(ctx.db)).blocked.includes(b.country)) throw new ApiError(403, 'territory_blocked', 'PreFlop is not available in your country');
    const id = newId('u');
    const hash = await hashPassword(b.password);
    const token = await tx(ctx.db, async (c) => {
      const exists = await c.query('select 1 from users where email = $1', [b.email]);
      if (exists.rowCount) throw conflict('email_taken', 'an account with this email exists');
      await c.query('insert into users (id, email, password_hash, display_name, country, date_of_birth) values ($1, $2, $3, $4, $5, $6)',
        [id, b.email, hash, b.display_name, b.country, b.date_of_birth]);
      // Every account starts with free play money (no cash value, no fees).
      await post(c, 'play.grant', id, [{ from: acct('PreFlop', 'play-issuance', 'play', 'PLAY'), to: acct(id, 'wallet', 'play', 'PLAY'), amountMinor: ctx.config.playStartMinor }]);
      await audit(c, { type: 'user.registered', userId: id });
      await bindReferral(c, id, b.ref);
      await sendVerification(c, ctx.config, id, b.email);
      return createSession(c, id);
    });
    return reply.code(201).send({ token, user: { id, email: b.email, display_name: b.display_name } });
  });

  app.post('/v1/auth/login', { preHandler: perIp(ctx.limits.login) }, async (req) => {
    const b = Login.parse(req.body);
    // Per-email lockout in Postgres (all instances): 5 failures in 15 min → 429 login_locked.
    const u = await guardedLogin(ctx.db, b.email, req.ip, LOGIN_LOCKOUT, async (c) => {
      const row = (await c.query<{ id: string; password_hash: string; status: string; mfa: boolean }>(
        `select u.id, u.password_hash, u.status, exists (select 1 from user_mfa m where m.user_id = u.id and m.enabled_at is not null) as mfa
           from users u where u.email = $1 and u.partner_id is null`, [b.email])).rows[0];
      // An unknown email costs one scrypt run too, so timing does not reveal which accounts exist.
      if (!row) return verifyAgainstNobody(b.password).then(() => null);
      if (!(await verifyPassword(b.password, row.password_hash))) return null;
      if (!row.mfa) return row;
      // Two-factor: no session without a valid code. A missing code is not a failure (nothing is
      // recorded or cleared); a wrong or replayed one counts toward the lockout like a wrong password.
      if (!b.otp) return new LoginRefusal(new ApiError(401, 'mfa_required', 'enter the 6-digit code from your authenticator app'), false);
      if (!(await checkOtp(c, row.id, b.otp))) return new LoginRefusal(new ApiError(401, 'invalid_otp', 'that code is not valid'), true);
      return row;
    });
    return tx(ctx.db, async (c) => {
      // Issue the session under the account row lock, and only if the password is still the one just
      // checked: a reset or change (same lock) that lands in between makes this sign-in fail instead of
      // leaving a session its sessions purge never saw.
      const now = (await c.query<{ password_hash: string; status: string }>('select password_hash, status from users where id = $1 for update', [u.id])).rows[0];
      if (!now || now.password_hash !== u.password_hash) throw unauthorized('invalid_credentials', 'wrong email or password');
      // A self-exclusion lifts itself only once its period has ended.
      await c.query(`update users set status = 'active', self_excluded_until = null where id = $1 and status = 'self_excluded' and self_excluded_until <= now()`, [u.id]);
      if (now.status === 'closed' || now.status === 'suspended') throw new ApiError(403, 'account_blocked', `account is ${now.status}`);
      return { token: await createSession(c, u.id) };
    });
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
    const mfaEnrollmentRequired = !!u.platform_role && !u.mfa_enabled && (await staffMfaRequired(ctx.db));
    return { ...u, mfa_enrollment_required: mfaEnrollmentRequired, memberships: await memberships(ctx, u.id), wallets: await wallets(ctx, u.id), agent };
  });

  /**
   * The display name, at any time. The date of birth and the country can be added once, by
   * accounts created before they were asked at registration; changing them afterwards goes
   * through support (KYC). Email and password changes have their own verified flows.
   */
  app.patch('/v1/me', async (req) => {
    const u = await ctx.user(req);
    const b = z.object({
      display_name: z.string().trim().min(1).max(60).optional(),
      date_of_birth: DateOfBirth.optional(),
      country: Country.optional(),
    }).refine((x) => Object.keys(x).length > 0, 'nothing to change').parse(req.body);
    return tx(ctx.db, async (c) => {
      const cur = (await c.query<{ display_name: string; dob: string | null; country: string | null }>(
        `select display_name, to_char(date_of_birth, 'YYYY-MM-DD') as dob, country from users where id = $1 for update`, [u.id])).rows[0]!;
      if (b.date_of_birth !== undefined && cur.dob !== null && cur.dob !== b.date_of_birth) throw conflict('already_set', 'your date of birth is already recorded; contact support to correct it');
      if (b.country !== undefined && cur.country !== null && cur.country !== b.country) throw conflict('already_set', 'your country is already recorded; contact support to change it');
      if (b.display_name !== undefined) {
        await c.query('update users set display_name = $2 where id = $1', [u.id, b.display_name]);
        await audit(c, { type: 'user.renamed', userId: u.id });
      }
      if (b.date_of_birth !== undefined && cur.dob === null) {
        await c.query('update users set date_of_birth = $2 where id = $1', [u.id, b.date_of_birth]);
        await audit(c, { type: 'user.dob_declared', userId: u.id, adult: isAdult(b.date_of_birth) });
      }
      if (b.country !== undefined && cur.country === null) {
        await c.query('update users set country = $2 where id = $1', [u.id, b.country]);
        await audit(c, { type: 'user.country_declared', userId: u.id, country: b.country });
      }
      const r = (await c.query<{ display_name: string; date_of_birth: string | null; country: string | null }>(
        `select display_name, to_char(date_of_birth, 'YYYY-MM-DD') as date_of_birth, country from users where id = $1`, [u.id])).rows[0]!;
      return { id: u.id, ...r };
    });
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
    // Every mode: no betting from a blocked country or under 18, and none once the session limit is reached.
    await assertMayBet(ctx.db, u);
    await assertSessionTime(ctx.db, tokenHash(bearer(req.headers.authorization) ?? ''), u.id);
    const ev = new EventBatch();
    if (b.room_id) {
      const rb = await placeRoomBet(ctx.db, {
        userId: u.id, idempotencyKey: key, roomId: b.room_id, roundId: b.round_id, selectionId: b.selection_id, stakeMinor: b.stake_minor, oddsCenti: b.odds_centi,
        ...(b.accept_price_change !== undefined ? { acceptPriceChange: b.accept_price_change } : {}),
      }, ev, ctx.modeEnabled);
      publish(ev);
      return reply.code(201).send(rb);
    }
    // Fast refusal before any lock; placeBet repeats the check under the player lock (the one that counts).
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
    // Newest first. Pages: pass the last bet_id of a page as `before` (next_before) for the next one.
    // Filters: status, round_id, and one wallet (mode + currency, room_id or "none" for no room).
    const q = MyBetsQuery.parse(req.query ?? {});
    const limit = limitParam(req.query, 200, 50);
    const rows = (await ctx.db.query(
      `select b.id as bet_id, b.round_id, b.room_id, b.selection_id, b.stake_minor, b.odds_centi, b.mode, b.currency, b.status, b.payout_minor, b.placed_at, b.settled_at,
              b.at_risk_minor, b.house_kind, b.idempotency_key, r.hand_no, r.table_id, r.flop, t.name as table_name
         from bets b join rounds r on r.id = b.round_id join poker_tables t on t.id = r.table_id
        where b.user_id = $1 and ($2::text is null or b.round_id = $2) and ($3::text is null or b.status = $3)
          and ($5::text is null or b.mode = $5) and ($6::text is null or b.currency = $6)
          and ($7::text is null or ($7 = 'none' and b.room_id is null) or b.room_id = $7)
          and ($8::text is null or (b.placed_at, b.id) < (select c.placed_at, c.id from bets c where c.id = $8 and c.user_id = $1))
        order by b.placed_at desc, b.id desc limit $4`,
      [u.id, q.round_id ?? null, q.status ?? null, limit, q.mode ?? null, q.currency ?? null, q.room_id ?? null, q.before ?? null])).rows;
    // Same amount settlement pays (the at-risk stake; a pool share is unknown until settlement: 0).
    const bets = rows.map(({ at_risk_minor, ...b }) => ({ ...b, potential_payout_minor: potentialPayoutMinor({ ...b, at_risk_minor }) }));
    return { bets, next_before: rows.length === limit ? rows[rows.length - 1]!.bet_id : null };
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
    // One row per (mode, currency) the player has bet in; amounts of different currencies are never
    // added. The top-level fields stay the play-money row (as before) for older clients.
    const rows = (await ctx.db.query<{ mode: string; currency: string; bets: number; won: number; lost: number; staked_minor: number; returned_minor: number }>(
      `select mode, currency, count(*)::int as bets, count(*) filter (where status = 'won')::int as won, count(*) filter (where status = 'lost')::int as lost,
              coalesce(sum(stake_minor) filter (where status in ('won','lost')), 0)::bigint as staked_minor,
              coalesce(sum(payout_minor) filter (where status = 'won'), 0)::bigint as returned_minor
         from bets where user_id = $1 group by mode, currency order by mode, currency`, [u.id])).rows;
    const play = rows.filter((r) => r.mode === 'play');
    const sum = (k: 'bets' | 'won' | 'lost' | 'staked_minor' | 'returned_minor') => play.reduce((a, r) => a + Number(r[k]), 0);
    return { bets: sum('bets'), won: sum('won'), lost: sum('lost'), staked_minor: sum('staked_minor'), returned_minor: sum('returned_minor'), by_currency: rows };
  });
}
