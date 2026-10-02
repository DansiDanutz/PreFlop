import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { audit } from '../lib/audit.ts';
import { tx } from '../lib/db.ts';
import { forbidden, notFound } from '../lib/errors.ts';
import { tableSummaries } from './public.ts';

export async function requirePlatform(ctx: AppContext, req: FastifyRequest, ...roles: string[]) {
  const u = await ctx.user(req);
  if (!u.platform_role || (roles.length && !roles.includes(u.platform_role) && u.platform_role !== 'admin')) throw forbidden('forbidden_role', 'PreFlop team only');
  return u;
}

const Setting = z.object({ value: z.unknown() });

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/v1/admin/overview', async (req) => {
    await requirePlatform(ctx, req);
    const q = async (sql: string) => (await ctx.db.query(sql)).rows[0];
    return {
      users: await q('select count(*)::int as n from users'),
      bets_24h: await q(`select count(*)::int as n, coalesce(sum(stake_minor),0)::bigint as staked from bets where placed_at > now() - interval '24 hours'`),
      rounds_24h: await q(`select count(*) filter (where state='SETTLED')::int as settled, count(*) filter (where state='VOID')::int as voided from rounds where opened_at > now() - interval '24 hours'`),
      open_alerts: await q('select count(*)::int as n from alerts where resolved_at is null'),
      tables: await tableSummaries(ctx),
    };
  });

  app.get('/v1/admin/settings', async (req) => {
    await requirePlatform(ctx, req);
    return { settings: (await ctx.db.query('select key, value, updated_at, updated_by from settings order by key')).rows };
  });

  app.put('/v1/admin/settings/:key', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin');
    const { key } = req.params as { key: string };
    const { value } = Setting.parse(req.body);
    return tx(ctx.db, async (c) => {
      const r = await c.query('update settings set value = $2, updated_at = now(), updated_by = $3 where key = $1 returning key', [key, JSON.stringify(value), u.id]);
      if (!r.rowCount) throw notFound('setting');
      await audit(c, { type: 'settings.changed', key, value: value as never, by: u.id });
      return { key, value };
    });
  });

  app.get('/v1/admin/alerts', async (req) => {
    await requirePlatform(ctx, req);
    return { alerts: (await ctx.db.query('select * from alerts order by created_at desc limit 200')).rows };
  });

  app.post('/v1/admin/alerts/:id/resolve', async (req) => {
    const u = await requirePlatform(ctx, req);
    const { id } = req.params as { id: string };
    await ctx.db.query('update alerts set resolved_at = now(), resolved_by = $2 where id = $1 and resolved_at is null', [id, u.id]);
    return { ok: true };
  });
}
