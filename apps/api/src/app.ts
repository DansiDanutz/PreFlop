import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { type PlayMode } from '@preflop/odds-engine';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, LogController, type FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';
import { type SessionUser, bearer, userFromToken } from './auth/players.ts';
import { type Config, corsOrigin } from './config.ts';
import type { Db } from './lib/db.ts';
import { ApiError, forbidden } from './lib/errors.ts';
import { type Limiter, RateLimiter, unlimited } from './lib/rateLimit.ts';
import { type Decider, deciderFromConfig } from './lib/decisions.ts';
import { accountRoutes } from './routes/account.ts';
import { adminRoutes } from './routes/admin.ts';
import { agentRoutes } from './routes/agents.ts';
import { growthRoutes } from './routes/growth.ts';
import { newsRoutes } from './routes/news.ts';
import { tournamentRoutes } from './routes/tournaments.ts';
import { orgRoutes } from './routes/org.ts';
import { partnerRoutes } from './routes/partner.ts';
import { playerRoutes } from './routes/player.ts';
import { providerRoutes } from './routes/provider.ts';
import { publicRoutes } from './routes/public.ts';
import { mfaEnrolmentAllowed, securityRoutes, staffMfaRequired } from './routes/security.ts';
import { STREAM_MAX_PAYLOAD, streamRoutes } from './routes/stream.ts';
import type { Timing } from './rounds/service.ts';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export interface AppContext {
  db: Db;
  config: Config;
  timing: Timing;
  /** Signed-in player or console user (throws 401). */
  user(req: FastifyRequest): Promise<SessionUser>;
  modeEnabled(mode: PlayMode): Promise<boolean>;
  /** In-process rate limiters (one set per app instance; see lib/rateLimit.ts). */
  limits: {
    login: Limiter; register: Limiter; partnerToken: Limiter; bets: Limiter;
    /** Per IP: verify-email, forgot-password and reset-password. */
    emailLinks: Limiter;
    /** Per account or address: emails we send on request (3 per 15 minutes). */
    accountEmail: Limiter;
    /** Per user: one-time codes tried on 2FA enable/disable (10 per 15 minutes). */
    otp: Limiter;
  };
  /** Live counters of this instance, for GET /v1/admin/metrics. */
  stats: { wsClients: number; startedAt: Date };
  /** Decision hints (docs/20): the decision model, or a disabled stand-in without JEV_API_KEY. */
  decider: Decider;
}

/** Accepted incoming request ids: short, printable, no spaces (no log injection). */
const REQUEST_ID = /^[A-Za-z0-9._:\-]{1,128}$/;

export interface BuildOptions {
  /** Send the request log (JSON lines) to this stream, whatever LOG says (tests). */
  logStream?: NodeJS.WritableStream;
  /** Replace the decision model (tests; the worker shares the API's when both run in one process). */
  decider?: Decider;
}

/** Query parameters whose values never reach a log line (old clients may still send ?token=). */
const SECRET_PARAMS = /([?&](?:token|access_token|client_secret|secret|password)=)[^&#]*/gi;
export const redactUrl = (url: string) => url.replace(SECRET_PARAMS, '$1[redacted]');

/** Fastify's default request serializer, with secrets in the query string redacted. */
const logSerializers = {
  req: (req: FastifyRequest) => ({
    method: req.method,
    url: redactUrl(req.url),
    host: req.host,
    remoteAddress: req.ip,
    ...(req.socket?.remotePort !== undefined ? { remotePort: req.socket.remotePort } : {}),
  }),
};

/**
 * Security headers on every API answer. Responses are JSON for scripts, never documents, so they
 * get a deny-all CSP, and are never cached by browsers or shared proxies (they carry balances,
 * bets and sessions) unless a route opts in by setting its own Cache-Control.
 */
function securityHeaders(reply: FastifyReply) {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('referrer-policy', 'no-referrer');
  reply.header('x-frame-options', 'DENY');
  reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
}

/**
 * TRUST_PROXY as Fastify takes it. A hop count becomes a function (Fastify itself refuses plain
 * numbers): the first `hops` addresses behind the socket are proxies, the next one is the client.
 * Right only when the API is reachable through those proxies alone (Fly machines without a public
 * IP); otherwise list the proxies' CIDRs instead.
 */
export function trustProxyOption(v: Config['trustProxy']): NonNullable<FastifyServerOptions['trustProxy']> {
  if (typeof v === 'number') return (_address: string, hop: number) => hop < v;
  return v;
}

export async function buildApp(db: Db, config: Config, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logStream ? { stream: opts.logStream, serializers: logSerializers } : config.log ? { serializers: logSerializers } : false,
    trustProxy: trustProxyOption(config.trustProxy),
    bodyLimit: 12 * 1024 * 1024,
    // Every request carries an id: the caller's X-Request-Id when it is sane, otherwise a new
    // UUID. It is in every log line (request_id) and echoed back in the X-Request-Id header.
    logController: new LogController({ requestIdLogLabel: 'request_id' }),
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && REQUEST_ID.test(h) ? h : randomUUID();
    },
  });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    securityHeaders(reply);
    return payload;
  });

  // Keep the raw body: provider requests are signed over its exact bytes.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body as Buffer;
    if ((body as Buffer).length === 0) return done(null, {});
    try { done(null, JSON.parse((body as Buffer).toString('utf8'))); } catch (e) { done(e as Error, undefined); }
  });
  app.addContentTypeParser(['application/octet-stream', 'image/jpeg', 'image/png'], { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body as Buffer;
    done(null, body);
  });

  await app.register(cors, { origin: corsOrigin(config.corsOrigins), credentials: true });
  await app.register(websocket, { options: { maxPayload: STREAM_MAX_PAYLOAD } });

  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof ApiError) {
      if (err.status === 429 && typeof err.extra.retry_after_s === 'number') reply.header('retry-after', String(err.extra.retry_after_s));
      return reply.code(err.status).type('application/problem+json').send({ type: err.type, title: err.message, status: err.status, ...err.extra });
    }
    if (err instanceof ZodError) {
      return reply.code(400).type('application/problem+json').send({ type: 'bad_request', title: 'invalid request', status: 400, issues: err.issues });
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ type: 'bad_request', title: e.message, status: e.statusCode });
    req.log.error(err);
    console.error(`[${req.id}]`, err);
    return reply.code(500).type('application/problem+json').send({ type: 'internal', title: 'internal error', status: 500, request_id: req.id });
  });

  const rl = config.rateLimit;
  const limiter = (name: string, perMinute: number, windowMs = 60_000): Limiter => (rl.enabled ? new RateLimiter(name, perMinute, windowMs) : unlimited(name));
  const ctx: AppContext = {
    db,
    config,
    timing: { resultSlaMs: config.resultSlaMs, reviewSlaMs: config.reviewSlaMs, maxCaptureDelayMs: config.maxCaptureDelayMs },
    async user(req) {
      const u = await userFromToken(db, bearer(req.headers.authorization));
      // require_staff_mfa: a PreFlop team account without 2FA may only enrol (docs/14).
      if (u.platform_role && !u.mfa_enabled && !mfaEnrolmentAllowed(req) && (await staffMfaRequired(db))) {
        throw forbidden('mfa_enrollment_required', 'set up two-factor authentication before using the console');
      }
      return u;
    },
    async modeEnabled(mode) {
      const v = (await db.query<{ value: Record<string, boolean> }>("select value from settings where key = 'modes_enabled'")).rows[0]?.value;
      return !!v?.[mode];
    },
    limits: {
      login: limiter('login', rl.authPerMinute),
      register: limiter('register', rl.authPerMinute),
      partnerToken: limiter('partner token', rl.partnerTokenPerMinute),
      bets: limiter('bets', rl.betsPerMinute),
      emailLinks: limiter('email links', rl.authPerMinute),
      accountEmail: limiter('account email', 3, 15 * 60_000),
      otp: limiter('one-time codes', 10, 15 * 60_000),
    },
    stats: { wsClients: 0, startedAt: new Date() },
    decider: opts.decider ?? deciderFromConfig(config),
  };

  await publicRoutes(app, ctx);
  await playerRoutes(app, ctx);
  await securityRoutes(app, ctx);
  await providerRoutes(app, ctx);
  await accountRoutes(app, ctx);
  await growthRoutes(app, ctx);
  await agentRoutes(app, ctx);
  await tournamentRoutes(app, ctx);
  await newsRoutes(app, ctx);
  await orgRoutes(app, ctx);
  await partnerRoutes(app, ctx);
  await adminRoutes(app, ctx);
  await streamRoutes(app, ctx);
  return app;
}
