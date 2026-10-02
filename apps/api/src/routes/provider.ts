import type { LinkSample } from '@preflop/odds-engine';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { type Principal, assertTableScope, requireDevice, requireStaff, verifySignedRequest } from '../auth/envelope.ts';
import { audit } from '../lib/audit.ts';
import { type Tx, tx } from '../lib/db.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { EventBatch, publish } from '../lib/events.ts';
import { idempotent, type StoredResponse } from '../lib/idempotency.ts';
import { tableReadiness } from '../rounds/readiness.ts';
import {
  cut, dealStart, ensureOpenRound, flopEntry, getTable, lockRound, receiveCapture, receiveImage, resolveReview,
  roundId, shuffleCommand, shuffleComplete, startHand, voidRound,
} from '../rounds/service.ts';

const Heartbeat = z.object({
  uploadMbps: z.number(), rttMs: z.number(), jitterMs: z.number(), packetLossPct: z.number(), videoDelayMs: z.number(),
  backupLinkUp: z.boolean(), streamLive: z.boolean(),
});

type H = { t: string; n?: string; id?: string };

export async function providerRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = async (req: FastifyRequest): Promise<Principal> => verifySignedRequest(ctx.db, {
    method: req.method, url: req.url, header: req.headers['x-preflop-auth'] as string | undefined,
    idempotencyKey: req.headers['idempotency-key'] as string | undefined, rawBody: req.rawBody ?? '',
  });

  /** A signed, table-scoped, idempotent write in one transaction; events publish after commit. */
  const write = (fn: (c: Tx, p: Principal, req: FastifyRequest, ev: EventBatch) => Promise<StoredResponse>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const p = await auth(req);
      const { t } = req.params as H;
      assertTableScope(p, t);
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || !key) throw badRequest('Idempotency-Key header required');
      const ev = new EventBatch();
      const res = await tx(ctx.db, (c) => idempotent(c, p.id, key, req.method, req.url, req.rawBody ?? '', () => fn(c, p, req, ev)));
      publish(ev);
      return reply.code(res.status).send(res.body);
    };
  const hand = (req: FastifyRequest) => {
    const { t, n } = req.params as H;
    const handNo = Number(n);
    if (!Number.isSafeInteger(handNo) || handNo < 1) throw badRequest('invalid hand number');
    return { t, handNo, rid: roundId(t, handNo) };
  };

  app.post('/v1/provider/tables/:t/heartbeat', async (req) => {
    const p = requireDevice(await auth(req));
    const { t } = req.params as H;
    assertTableScope(p, t);
    const link: Omit<LinkSample, 'heartbeatAgeS'> = Heartbeat.parse(req.body);
    await ctx.db.query('update poker_tables set link = $2, link_at = now() where id = $1', [t, JSON.stringify(link)]);
    const ev = new EventBatch();
    await tx(ctx.db, (c) => ensureOpenRound(c, t, ev));
    publish(ev);
    const table = (await ctx.db.query('select * from poker_tables where id = $1', [t])).rows[0];
    return { ok: true, readiness: await tableReadiness(ctx.db, table) };
  });

  app.get('/v1/provider/tables/:t/state', async (req) => {
    const p = await auth(req);
    const { t } = req.params as H;
    assertTableScope(p, t);
    const table = (await ctx.db.query('select * from poker_tables where id = $1', [t])).rows[0];
    if (!table) throw notFound('table');
    const rounds = (await ctx.db.query(
      `select id, hand_no, state, procedure_step as step, cut_depth, locked_at, deal_start_at, flop, review_reasons
         from rounds where table_id = $1 order by hand_no desc limit 3`, [t])).rows;
    const entries = rounds[0] ? (await ctx.db.query('select source, person_id, cards from flop_entries where round_id = $1', [rounds[0].id])).rows : [];
    return { table: { id: table.id, name: table.name, status: table.status, pause_reason: table.pause_reason, kind: table.kind }, readiness: await tableReadiness(ctx.db, table), rounds, entries };
  });

  app.post('/v1/provider/tables/:t/hands/:n/start', write(async (c, p, req, ev) => {
    requireStaff(p, 'dealer');
    const r = await lockRound(c, hand(req).rid);
    return { status: 200, body: await startHand(c, r, p, ev) };
  }));

  app.get('/v1/provider/tables/:t/hands/:n/shuffle-command', async (req) => {
    const p = requireDevice(await auth(req));
    const { t, rid } = hand(req);
    assertTableScope(p, t);
    const r = (await ctx.db.query('select * from rounds where id = $1', [rid])).rows[0];
    if (!r) throw notFound('round');
    return shuffleCommand(r);
  });

  app.post('/v1/provider/tables/:t/hands/:n/shuffle-complete', write(async (c, p, req, ev) => {
    const r = await lockRound(c, hand(req).rid);
    const body = (req.body ?? {}) as { attestation?: Parameters<typeof shuffleComplete>[3] };
    return { status: 200, body: await shuffleComplete(c, r, p, body.attestation, ev) };
  }));

  app.post('/v1/provider/tables/:t/hands/:n/cut', write(async (c, p, req) => {
    requireStaff(p, 'dealer');
    return { status: 200, body: await cut(c, await lockRound(c, hand(req).rid), p) };
  }));

  app.post('/v1/provider/tables/:t/hands/:n/deal-start', write(async (c, p, req, ev) => {
    requireStaff(p, 'dealer');
    return { status: 200, body: await dealStart(c, await lockRound(c, hand(req).rid), p, ev) };
  }));

  app.post('/v1/provider/tables/:t/hands/:n/flop', write(async (c, p, req) => {
    const s = requireStaff(p);
    const r = await lockRound(c, hand(req).rid);
    return { status: 200, body: await flopEntry(c, r, s, (req.body as { cards?: unknown })?.cards) };
  }));

  app.post('/v1/provider/tables/:t/hands/:n/capture', write(async (c, p, req, ev) => {
    const d = requireDevice(p);
    const { t, handNo } = hand(req);
    const res = await receiveCapture(c, t, handNo, d.id, req.body as Parameters<typeof receiveCapture>[4], ctx.timing, ev);
    return res;
  }));

  app.put('/v1/provider/tables/:t/hands/:n/capture/image', write(async (c, p, req) => {
    const d = requireDevice(p);
    const { t, handNo } = hand(req);
    if (!Buffer.isBuffer(req.body)) throw badRequest('raw image bytes required (application/octet-stream)');
    return { status: 200, body: await receiveImage(c, t, handNo, d.id, req.body) };
  }));

  app.get('/v1/provider/devices/:id/checkpoint', async (req) => {
    const p = requireDevice(await auth(req));
    const { id } = req.params as H;
    if (p.id !== id) throw notFound('device');
    const d = (await ctx.db.query<{ last_seq: number; last_hash: string }>('select last_seq, last_hash from devices where id = $1', [id])).rows[0]!;
    const rec = (await ctx.db.query<{ capture: unknown; signature: string }>('select capture, signature from captures where device_id = $1 and seq = $2', [id, d.last_seq])).rows[0];
    const ev = new EventBatch();
    await tx(ctx.db, (c) => audit(c, { type: 'device.checkpoint_sync', deviceId: id, lastSeq: d.last_seq }));
    publish(ev);
    return { last_seq: d.last_seq, last_hash: d.last_hash, record: rec?.capture ?? null, signature: rec?.signature ?? null };
  });

  app.post('/v1/provider/tables/:t/hands/:n/void', write(async (c, p, req, ev) => {
    const s = requireStaff(p, 'floor_manager');
    const reason = String((req.body as { reason?: string })?.reason ?? 'floor decision').slice(0, 200);
    const r = await lockRound(c, hand(req).rid);
    const ok = await voidRound(c, r, reason, s.id, ev);
    if (ok) await ensureOpenRound(c, r.table_id, ev);
    return ok ? { status: 200, body: { state: 'VOID' } } : { status: 409, body: { type: 'invalid_round_state' } };
  }));

  app.post('/v1/provider/rounds/:id/review', async (req, reply) => {
    const p = await auth(req);
    const s = requireStaff(p, 'floor_manager');
    const { id } = req.params as H;
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !key) throw badRequest('Idempotency-Key header required');
    const ev = new EventBatch();
    const res = await tx(ctx.db, async (c) => {
      const r = await lockRound(c, id!);
      assertTableScope(p, r.table_id);
      return idempotent(c, p.id, key, req.method, req.url, req.rawBody ?? '', async () => {
        const out = await resolveReview(c, r, s, req.body as Parameters<typeof resolveReview>[3], ctx.timing, ev);
        await ensureOpenRound(c, r.table_id, ev);
        return out;
      });
    });
    publish(ev);
    return reply.code(res.status).send(res.body);
  });

  app.post('/v1/provider/tables/:t/pause', write(async (c, p, req) => {
    requireStaff(p, 'floor_manager');
    const { t } = req.params as H;
    await getTable(c, t);
    await c.query(`update poker_tables set status = 'paused', pause_reason = $2 where id = $1`, [t, String((req.body as { reason?: string })?.reason ?? 'paused by floor')]);
    await audit(c, { type: 'table.paused', tableId: t, by: p.id });
    return { status: 200, body: { status: 'paused' } };
  }));

  app.post('/v1/provider/tables/:t/resume', write(async (c, p, req, ev) => {
    requireStaff(p, 'floor_manager');
    const { t } = req.params as H;
    await c.query(`update poker_tables set status = 'active', pause_reason = null where id = $1`, [t]);
    await audit(c, { type: 'table.resumed', tableId: t, by: p.id });
    await ensureOpenRound(c, t, ev);
    return { status: 200, body: { status: 'active' } };
  }));
}
