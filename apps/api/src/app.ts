import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { type PlayMode } from '@preflop/odds-engine';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, LogController } from 'fastify';
import { ZodError } from 'zod';
import { type SessionUser, bearer, userFromToken } from './auth/players.ts';
import { type Config, corsOrigin } from './config.ts';
import type { Db } from './lib/db.ts';
import { ApiError } from './lib/errors.ts';
import { type Limiter, RateLimiter, unlimited } from './lib/rateLimit.ts';
import { accountRoutes } from './routes/account.ts';
import { adminRoutes } from './routes/admin.ts';
import { agentRoutes } from './routes/agents.ts';
import { growthRoutes } from './routes/growth.ts';
import { tournamentRoutes } from './routes/tournaments.ts';
import { orgRoutes } from './routes/org.ts';
import { partnerRoutes } from './routes/partner.ts';
import { playerRoutes } from './routes/player.ts';
import { providerRoutes } from './routes/provider.ts';
import { publicRoutes } from './routes/public.ts';
import { streamRoutes } from './routes/stream.ts';
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
  limits: { login: Limiter; register: Limiter; partnerToken: Limiter; bets: Limiter };
  /** Live counters of this instance, for GET /v1/admin/metrics. */
  stats: { wsClients: number; startedAt: Date };
}

/** Accepted incoming request ids: short, printable, no spaces (no log injection). */
const REQUEST_ID = /^[A-Za-z0-9._:\-]{1,128}$/;

export interface BuildOptions {
  /** Send the request log (JSON lines) to this stream, whatever LOG says (tests). */
  logStream?: NodeJS.WritableStream;
}

export async function buildApp(db: Db, config: Config, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logStream ? { stream: opts.logStream } : config.log,
    trustProxy: config.trustProxy,
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
  await app.register(websocket);

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
  const limiter = (name: string, perMinute: number): Limiter => (rl.enabled ? new RateLimiter(name, perMinute, 60_000) : unlimited(name));
  const ctx: AppContext = {
    db,
    config,
    timing: { resultSlaMs: config.resultSlaMs, reviewSlaMs: config.reviewSlaMs, maxCaptureDelayMs: config.maxCaptureDelayMs },
    user: (req) => userFromToken(db, bearer(req.headers.authorization)),
    async modeEnabled(mode) {
      const v = (await db.query<{ value: Record<string, boolean> }>("select value from settings where key = 'modes_enabled'")).rows[0]?.value;
      return !!v?.[mode];
    },
    limits: {
      login: limiter('login', rl.authPerMinute),
      register: limiter('register', rl.authPerMinute),
      partnerToken: limiter('partner token', rl.partnerTokenPerMinute),
      bets: limiter('bets', rl.betsPerMinute),
    },
    stats: { wsClients: 0, startedAt: new Date() },
  };

  await publicRoutes(app, ctx);
  await playerRoutes(app, ctx);
  await providerRoutes(app, ctx);
  await accountRoutes(app, ctx);
  await growthRoutes(app, ctx);
  await agentRoutes(app, ctx);
  await tournamentRoutes(app, ctx);
  await orgRoutes(app, ctx);
  await partnerRoutes(app, ctx);
  await adminRoutes(app, ctx);
  await streamRoutes(app, ctx);
  return app;
}
