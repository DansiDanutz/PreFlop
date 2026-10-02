import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { type PlayMode } from '@preflop/odds-engine';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { type SessionUser, bearer, userFromToken } from './auth/players.ts';
import type { Config } from './config.ts';
import type { Db } from './lib/db.ts';
import { ApiError } from './lib/errors.ts';
import { adminRoutes } from './routes/admin.ts';
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
}

export async function buildApp(db: Db, config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.LOG === '1', bodyLimit: 12 * 1024 * 1024 });

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

  await app.register(cors, { origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, credentials: true });
  await app.register(websocket);

  app.setErrorHandler((err: unknown, _req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof ApiError) {
      return reply.code(err.status).type('application/problem+json').send({ type: err.type, title: err.message, status: err.status, ...err.extra });
    }
    if (err instanceof ZodError) {
      return reply.code(400).type('application/problem+json').send({ type: 'bad_request', title: 'invalid request', status: 400, issues: err.issues });
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ type: 'bad_request', title: e.message, status: e.statusCode });
    app.log.error(err);
    console.error(err);
    return reply.code(500).type('application/problem+json').send({ type: 'internal', title: 'internal error', status: 500 });
  });

  const ctx: AppContext = {
    db,
    config,
    timing: { resultSlaMs: config.resultSlaMs, reviewSlaMs: config.reviewSlaMs, maxCaptureDelayMs: config.maxCaptureDelayMs },
    user: (req) => userFromToken(db, bearer(req.headers.authorization)),
    async modeEnabled(mode) {
      const v = (await db.query<{ value: Record<string, boolean> }>("select value from settings where key = 'modes_enabled'")).rows[0]?.value;
      return !!v?.[mode];
    },
  };

  await publicRoutes(app, ctx);
  await playerRoutes(app, ctx);
  await providerRoutes(app, ctx);
  await adminRoutes(app, ctx);
  await streamRoutes(app, ctx);
  return app;
}
