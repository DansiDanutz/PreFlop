import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Channel } from '@preflop/odds-engine';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { createSession, hashPassword } from '../auth/players.ts';
import { placeBet } from '../bets/service.ts';
import { audit } from '../lib/audit.ts';
import { type Db, tx } from '../lib/db.ts';
import { badRequest, notFound, unauthorized, unprocessable } from '../lib/errors.ts';
import { EventBatch, publish } from '../lib/events.ts';
import { newId } from '../lib/ids.ts';
import { perIp } from '../lib/rateLimit.ts';
import { assertPublicUrl, postWebhook } from '../lib/safeUrl.ts';
import { WEBHOOK_EVENTS } from '../lib/webhooks.ts';
import { acct, post } from '../lib/ledger.ts';
import { requireOrg } from './org.ts';

/**
 * Partner (betting company) integration, docs/02 §2:
 * - OAuth2 client credentials → short-lived bearer tokens for the Partner API;
 * - partner players are PreFlop users tagged with partner_id + external_ref;
 * - transfer wallet mode in the sandbox (partner float → player wallet);
 * - signed webhooks with retries for 24 h; partners dedupe by event_id.
 */

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export { WEBHOOK_EVENTS };

export function signWebhook(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t}, v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

async function partnerFromToken(db: Db, req: FastifyRequest): Promise<{ orgId: string; clientId: string }> {
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  if (!token) throw unauthorized('unauthorized', 'partner bearer token required');
  const r = (await db.query<{ org_id: string; client_id: string }>(
    `select p.org_id, p.client_id from partner_tokens p join api_clients c on c.id = p.client_id join organizations o on o.id = p.org_id
      where p.token_sha256 = $1 and p.expires_at > now() and not c.revoked and o.status = 'active'`, [sha(token)])).rows[0];
  if (!r) throw unauthorized('unauthorized', 'token expired or revoked');
  return { orgId: r.org_id, clientId: r.client_id };
}

async function partnerPlayer(db: Db, orgId: string, ref: string, displayName?: string): Promise<string> {
  const existing = (await db.query<{ id: string }>('select id from users where partner_id = $1 and external_ref = $2', [orgId, ref])).rows[0];
  if (existing) return existing.id;
  const id = newId('u');
  // Partner players never log in with a password: they get sessions from their operator.
  const hash = await hashPassword(randomBytes(24).toString('base64url'));
  // The placeholder email is derived from a hash of (org, ref), so distinct refs never collide.
  const email = `p_${sha(`${orgId}\u0000${ref}`).slice(0, 32)}@${orgId}.partner.preflop`;
  await tx(db, async (c) => {
    const created = await c.query(`insert into users (id, email, password_hash, display_name, partner_id, external_ref) values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
      [id, email, hash, displayName ?? ref, orgId, ref]);
    if (created.rowCount !== 1) return; // a concurrent request created this player: no second grant
    await post(c, 'play.grant', id, [{ from: acct('PreFlop', 'play-issuance', 'play', 'PLAY'), to: acct(id, 'wallet', 'play', 'PLAY'), amountMinor: 10_000 }]);
    await audit(c, { type: 'partner.player', userId: id, orgId, ref });
  });
  return (await db.query<{ id: string }>('select id from users where partner_id = $1 and external_ref = $2', [orgId, ref])).rows[0]!.id;
}

export async function partnerRoutes(app: FastifyInstance, ctx: AppContext) {
  const P = '/v1/org/:orgId';
  const oid = (req: FastifyRequest) => (req.params as { orgId: string }).orgId;

  // ---------------------------------------------------------------- partner portal
  app.get(`${P}/api-clients`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req), { kinds: ['partner'] });
    return { clients: (await ctx.db.query('select id, name, created_at, revoked from api_clients where org_id = $1 order by created_at desc', [org.id])).rows };
  });
  app.post(`${P}/api-clients`, async (req, reply) => {
    const { org, user } = await requireOrg(ctx, req, oid(req), { kinds: ['partner'], write: true });
    const { name } = z.object({ name: z.string().min(1).max(60) }).parse(req.body);
    const id = newId('cli');
    const secret = `pfs_${randomBytes(24).toString('base64url')}`;
    await tx(ctx.db, async (c) => {
      await c.query('insert into api_clients (id, org_id, name, secret_sha256) values ($1, $2, $3, $4)', [id, org.id, name, sha(secret)]);
      await audit(c, { type: 'partner.client_created', clientId: id, orgId: org.id, by: user.id });
    });
    return reply.code(201).send({ id, name, created_at: new Date().toISOString(), revoked: false, secret });
  });
  app.post(`${P}/api-clients/:clientId/revoke`, async (req) => {
    const { org, user } = await requireOrg(ctx, req, oid(req), { kinds: ['partner'], write: true });
    const { clientId } = req.params as { clientId: string };
    await tx(ctx.db, async (c) => {
      const r = await c.query('update api_clients set revoked = true where id = $1 and org_id = $2', [clientId, org.id]);
      if (!r.rowCount) throw notFound('client');
      await c.query('delete from partner_tokens where client_id = $1', [clientId]);
      await audit(c, { type: 'partner.client_revoked', clientId, by: user.id });
    });
    return { ok: true };
  });
  app.get(`${P}/webhooks`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req), { kinds: ['partner'] });
    const webhooks = (await ctx.db.query('select id, url, events, active, created_at from webhooks where org_id = $1 order by created_at', [org.id])).rows;
    const deliveries = (await ctx.db.query(
      `select d.id, d.webhook_id, d.event_type, d.status, d.attempts, d.last_error, d.created_at from webhook_deliveries d join webhooks w on w.id = d.webhook_id
        where w.org_id = $1 order by d.created_at desc limit 100`, [org.id])).rows;
    return { webhooks, deliveries };
  });
  app.post(`${P}/webhooks`, async (req, reply) => {
    const { org, user } = await requireOrg(ctx, req, oid(req), { kinds: ['partner'], write: true });
    const b = z.object({ url: z.string().url().max(500), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) }).parse(req.body);
    await assertPublicUrl(b.url);
    const id = newId('wh');
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    await tx(ctx.db, async (c) => {
      await c.query('insert into webhooks (id, org_id, url, secret, events) values ($1, $2, $3, $4, $5)', [id, org.id, b.url, secret, b.events]);
      await audit(c, { type: 'partner.webhook_created', webhookId: id, by: user.id });
    });
    return reply.code(201).send({ id, url: b.url, events: b.events, active: true, created_at: new Date().toISOString(), secret });
  });
  app.delete(`${P}/webhooks/:hookId`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req), { kinds: ['partner'], write: true });
    const { hookId } = req.params as { hookId: string };
    const r = await ctx.db.query('update webhooks set active = false where id = $1 and org_id = $2', [hookId, org.id]);
    if (!r.rowCount) throw notFound('webhook');
    return { ok: true };
  });
  app.post(`${P}/webhooks/:hookId/test`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req), { kinds: ['partner'], write: true });
    const { hookId } = req.params as { hookId: string };
    const w = (await ctx.db.query('select id from webhooks where id = $1 and org_id = $2', [hookId, org.id])).rows[0];
    if (!w) throw notFound('webhook');
    const id = newId('whd');
    await ctx.db.query(`insert into webhook_deliveries (id, webhook_id, event_id, event_type, payload) values ($1, $2, $3, 'test', $4)`,
      [id, hookId, newId('evt'), JSON.stringify({ type: 'test', data: { hello: 'from PreFlop' } })]);
    await deliverDue(ctx.db, 5);
    return (await ctx.db.query('select id, webhook_id, event_type, status, attempts, last_error, created_at from webhook_deliveries where id = $1', [id])).rows[0];
  });
  app.get(`${P}/bets`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req), { kinds: ['partner'] });
    const limit = Math.min(1000, Number((req.query as { limit?: string }).limit ?? 200));
    return { bets: (await ctx.db.query(
      `select b.id as bet_id, b.round_id, b.selection_id, b.stake_minor, b.odds_centi, b.mode, b.currency, b.status, b.payout_minor, b.placed_at, b.settled_at,
              r.hand_no, r.table_id, r.flop, t.name as table_name, u.external_ref as player_ref
         from bets b join users u on u.id = b.user_id join rounds r on r.id = b.round_id join poker_tables t on t.id = r.table_id
        where b.partner_id = $1 order by b.placed_at desc limit $2`, [org.id, limit])).rows };
  });
  const widgetView = (orgId: string, settings: Record<string, unknown>) => {
    const web = process.env.WEB_URL ?? 'http://localhost:5173';
    const table = String(settings.default_table ?? 'green-room');
    return {
      settings,
      snippet: `<iframe src="${web}/embed/table/${table}?token=PLAYER_SESSION_TOKEN&accent=${encodeURIComponent(String(settings.accent ?? '#53e6a7'))}" style="width:100%;max-width:440px;height:820px;border:0;border-radius:18px" allow="autoplay" title="PreFlop"></iframe>\n<!-- Get PLAYER_SESSION_TOKEN server-side: POST /v1/partner/players/{player_ref}/session (partner ${orgId}) -->`,
    };
  };
  app.get(`${P}/widget`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req), { kinds: ['partner'] });
    return widgetView(org.id, (org.settings.widget as Record<string, unknown>) ?? {});
  });
  app.put(`${P}/widget`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req), { kinds: ['partner'], write: true });
    const { settings } = z.object({ settings: z.record(z.unknown()) }).parse(req.body);
    await ctx.db.query(`update organizations set settings = jsonb_set(settings, '{widget}', $2::jsonb) where id = $1`, [org.id, JSON.stringify(settings)]);
    return widgetView(org.id, settings);
  });

  // ---------------------------------------------------------------- Partner API (server to server)
  app.post('/v1/partner/oauth/token', { preHandler: perIp(ctx.limits.partnerToken) }, async (req) => {
    const b = z.object({ grant_type: z.literal('client_credentials'), client_id: z.string(), client_secret: z.string() }).parse(req.body);
    const c = (await ctx.db.query<{ id: string; org_id: string; secret_sha256: string; revoked: boolean }>('select * from api_clients where id = $1', [b.client_id])).rows[0];
    const ok = c && !c.revoked && timingSafeEqual(Buffer.from(sha(b.client_secret)), Buffer.from(c.secret_sha256));
    if (!ok) throw unauthorized('invalid_client', 'unknown client or wrong secret');
    const token = `pft_${randomBytes(32).toString('base64url')}`;
    await ctx.db.query(`insert into partner_tokens (token_sha256, client_id, org_id, expires_at) values ($1, $2, $3, now() + interval '1 hour')`, [sha(token), c.id, c.org_id]);
    return { access_token: token, token_type: 'Bearer', expires_in: 3600 };
  });
  app.post('/v1/partner/players', async (req, reply) => {
    const p = await partnerFromToken(ctx.db, req);
    const b = z.object({ player_ref: z.string().min(1).max(100), display_name: z.string().max(60).optional() }).parse(req.body);
    const id = await partnerPlayer(ctx.db, p.orgId, b.player_ref, b.display_name);
    return reply.code(201).send({ player_ref: b.player_ref, user_id: id });
  });
  /** A player session for the widget iframe (?token=…). Never expose the partner token to browsers. */
  app.post('/v1/partner/players/:ref/session', async (req) => {
    const p = await partnerFromToken(ctx.db, req);
    const { ref } = req.params as { ref: string };
    const id = await partnerPlayer(ctx.db, p.orgId, ref);
    return { token: await createSession(ctx.db, id), user_id: id };
  });
  /** Transfer wallet mode: move value from the partner's float into its player's PreFlop wallet. */
  app.post('/v1/partner/players/:ref/deposits', async (req, reply) => {
    const p = await partnerFromToken(ctx.db, req);
    const { ref } = req.params as { ref: string };
    const b = z.object({ amount_minor: z.number().int().positive(), mode: z.enum(['play', 'virtual-chips']).default('virtual-chips') }).parse(req.body);
    const id = await partnerPlayer(ctx.db, p.orgId, ref);
    const currency = b.mode === 'play' ? 'PLAY' : 'CHIP';
    const ref2 = newId('pdep');
    await tx(ctx.db, async (c) => {
      await post(c, 'partner.deposit', ref2, [{ from: acct(p.orgId, 'float', b.mode, currency), to: acct(id, 'wallet', b.mode, currency), amountMinor: b.amount_minor }]);
      await audit(c, { type: 'partner.deposit', orgId: p.orgId, userId: id, amountMinor: b.amount_minor, mode: b.mode });
    });
    return reply.code(201).send({ id: ref2, player_ref: ref, amount_minor: b.amount_minor, currency });
  });
  app.post('/v1/partner/bets', async (req, reply) => {
    const p = await partnerFromToken(ctx.db, req);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8) throw badRequest('Idempotency-Key header required');
    const b = z.object({ player_ref: z.string(), round_id: z.string(), selection_id: z.string(), stake_minor: z.number().int().positive(), odds_centi: z.number().int(), accept_price_change: z.boolean().optional() }).parse(req.body);
    const userId = await partnerPlayer(ctx.db, p.orgId, b.player_ref);
    const ev = new EventBatch();
    const out = await placeBet(ctx.db, {
      userId, idempotencyKey: `${p.orgId}:${key}`, roundId: b.round_id, selectionId: b.selection_id, stakeMinor: b.stake_minor, oddsCenti: b.odds_centi,
      ...(b.accept_price_change !== undefined ? { acceptPriceChange: b.accept_price_change } : {}), channel: 'partner' as Channel, partnerId: p.orgId,
    }, ev, ctx.modeEnabled);
    publish(ev);
    return reply.code(201).send({ ...out, player_ref: b.player_ref });
  });
  app.get('/v1/partner/bets', async (req) => {
    const p = await partnerFromToken(ctx.db, req);
    const q = req.query as { player_ref?: string; round_id?: string };
    return { bets: (await ctx.db.query(
      `select b.id as bet_id, b.round_id, b.selection_id, b.stake_minor, b.odds_centi, b.status, b.payout_minor, b.currency, u.external_ref as player_ref
         from bets b join users u on u.id = b.user_id where b.partner_id = $1 and ($2::text is null or u.external_ref = $2) and ($3::text is null or b.round_id = $3)
        order by b.placed_at desc limit 500`, [p.orgId, q.player_ref ?? null, q.round_id ?? null])).rows };
  });
}

// ---------------------------------------------------------------- webhook delivery
// Fan-out is durable: lib/webhooks.ts queues the rows inside the settlement/void transaction.

/** Delivers due webhooks with an HMAC signature; exponential backoff for 24 h, then failed. */
export async function deliverDue(db: Db, limit = 20): Promise<number> {
  const due = (await db.query<{ id: string; url: string; secret: string; payload: unknown; attempts: number; created_at: Date }>(
    `select d.id, w.url, w.secret, d.payload, d.attempts, d.created_at from webhook_deliveries d join webhooks w on w.id = d.webhook_id
      where d.status = 'pending' and d.next_attempt_at <= now() order by d.next_attempt_at limit $1`, [limit])).rows;
  for (const d of due) {
    const body = JSON.stringify(d.payload);
    let error: string | null = null;
    try {
      // Re-checked at delivery, and the socket only connects to the addresses that passed the
      // check (no DNS rebinding in between); redirects are never followed.
      const status = await postWebhook(d.url, { 'content-type': 'application/json', 'x-preflop-signature': signWebhook(d.secret, body) }, body);
      if (status >= 300 && status < 400) error = `redirect refused (HTTP ${status})`;
      else if (status < 200 || status >= 300) error = `HTTP ${status}`;
    } catch (e) {
      error = (e as Error).message;
    }
    if (!error) await db.query(`update webhook_deliveries set status = 'delivered', attempts = attempts + 1, delivered_at = now(), last_error = null where id = $1`, [d.id]);
    else {
      const expired = Date.now() - d.created_at.getTime() > 24 * 3600_000;
      const backoff = Math.min(3600, 2 ** Math.min(d.attempts + 1, 12));
      await db.query(`update webhook_deliveries set attempts = attempts + 1, last_error = $2, status = $3, next_attempt_at = now() + ($4 || ' seconds')::interval where id = $1`,
        [d.id, error.slice(0, 300), expired ? 'failed' : 'pending', String(backoff)]);
    }
  }
  return due.length;
}
