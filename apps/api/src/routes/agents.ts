import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { type AgentRow, RATE_CAPS, apply, approveStatement, closeMonth, payStatement, updateAgent } from '../growth/agents.ts';
import { tx } from '../lib/db.ts';
import { requirePlatform } from './admin.ts';

/** Agents: applications, the two-level tree, monthly statements (docs/16 §4). */

function agentView(a: AgentRow) {
  return { user_id: a.user_id, code: a.code, parent_agent_id: a.parent_agent_id, status: a.status, rate_l1_bps: a.rate_l1_bps, rate_l2_bps: a.rate_l2_bps, note: a.note, created_at: a.created_at };
}

const statementCols = `s.id, s.agent_id, to_char(s.month, 'YYYY-MM') as month, s.currency, s.level, s.ngr_minor::float8 as ngr_minor, s.carry_in_minor::float8 as carry_in_minor,
  s.carry_out_minor::float8 as carry_out_minor, s.rate_bps, s.amount_minor::float8 as amount_minor, s.status`;

export async function agentRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/v1/me/agent/apply', async (req, reply) => {
    const u = await ctx.user(req);
    const b = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    const a = await tx(ctx.db, (c) => apply(c, u.id, b.note ?? null));
    return reply.code(201).send(agentView(a));
  });

  app.get('/v1/me/agent', async (req) => {
    const u = await ctx.user(req);
    const a = (await ctx.db.query<AgentRow>('select * from agents where user_id = $1', [u.id])).rows[0];
    if (!a) return { agent: null };
    const players = (await ctx.db.query<{ n: number }>('select count(*)::int as n from users where referred_by_agent = $1', [u.id])).rows[0]!.n;
    const subAgents = (await ctx.db.query<{ user_id: string; display_name: string; code: string; status: string; players: number }>(
      `select a.user_id, u.display_name, a.code, a.status, (select count(*)::int from users p where p.referred_by_agent = a.user_id) as players
         from agents a join users u on u.id = a.user_id where a.parent_agent_id = $1 order by u.display_name`, [u.id])).rows;
    const statements = (await ctx.db.query(`select ${statementCols} from agent_statements s where s.agent_id = $1 order by s.month desc, s.currency, s.level`, [u.id])).rows;
    return { agent: agentView(a), players, sub_agents: subAgents, statements };
  });

  app.get('/v1/admin/agents', async (req) => {
    await requirePlatform(ctx, req);
    // `hint` is the decision model's suggestion (docs/20) for an application still awaiting a decision.
    const agents = (await ctx.db.query<AgentRow & { display_name: string; email: string; players: number; parent_name: string | null; hint: unknown }>(
      `select a.*, u.display_name, u.email, (select count(*)::int from users p where p.referred_by_agent = a.user_id) as players, pu.display_name as parent_name,
              case when h.ref is null or h.error is not null then null else jsonb_build_object('model', h.model, 'answers', h.answers, 'at', h.created_at) end as hint
         from agents a join users u on u.id = a.user_id left join users pu on pu.id = a.parent_agent_id left join decision_hints h on h.kind = 'agent' and h.ref = a.user_id
        order by (a.status = 'applied') desc, a.created_at desc`)).rows;
    const statements = (await ctx.db.query(`select ${statementCols}, u.display_name from agent_statements s join users u on u.id = s.agent_id
       order by s.month desc, u.display_name, s.currency, s.level limit 500`)).rows;
    return {
      caps: { rate_l1_bps: RATE_CAPS.l1, rate_l2_bps: RATE_CAPS.l2 },
      agents: agents.map((a) => ({ ...agentView(a), display_name: a.display_name, email: a.email, players: a.players, parent_name: a.parent_name, hint: a.hint ?? null })),
      statements,
    };
  });

  app.put('/v1/admin/agents/:id', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const { id } = req.params as { id: string };
    const b = z.object({
      status: z.enum(['active', 'suspended', 'rejected']).optional(),
      rate_l1_bps: z.number().int().optional(),
      rate_l2_bps: z.number().int().optional(),
      parent_agent_id: z.string().nullable().optional(),
    }).parse(req.body);
    const clean = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    return agentView(await tx(ctx.db, (c) => updateAgent(c, id, clean, u.id)));
  });

  app.post('/v1/admin/agents/statements/close', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    const { month } = z.object({ month: z.string() }).parse(req.query);
    return { created: await tx(ctx.db, (c) => closeMonth(c, month, u.id)) };
  });
  app.post('/v1/admin/agents/statements/:id/approve', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin', 'ops');
    await tx(ctx.db, (c) => approveStatement(c, (req.params as { id: string }).id, u.id));
    return { ok: true };
  });
  app.post('/v1/admin/agents/statements/:id/pay', async (req) => {
    const u = await requirePlatform(ctx, req, 'admin');
    await tx(ctx.db, (c) => payStatement(c, (req.params as { id: string }).id, u.id));
    return { ok: true };
  });
}
