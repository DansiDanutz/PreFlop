import { REVIEW_STATES, recordOutcome } from '../lib/decisions.ts';
import { type LinkSample, MAX_TIMESTAMP_MS, captureShapeProblems } from '@preflop/odds-engine';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { type Principal, assertTableScope, requireDevice, requireStaff, verifySignedRequest } from '../auth/envelope.ts';
import { audit } from '../lib/audit.ts';
import { evidenceOf } from './admin.ts';
import { type Tx, tx } from '../lib/db.ts';
import { ApiError, badRequest, notFound } from '../lib/errors.ts';
import { EventBatch, publish } from '../lib/events.ts';
import { idempotent, type StoredResponse } from '../lib/idempotency.ts';
import { tableReadiness } from '../rounds/readiness.ts';
import {
  carriesRealMoney, cut, dealStart, ensureOpenRound, flopEntry, getTable, lockRound, receiveCapture, receiveImage, resolveReview,
  type RoundState, roundId, shuffleCommand, shuffleComplete, startHand, voidRound, withReviewDeadline,
} from '../rounds/service.ts';

const Heartbeat = z.object({
  uploadMbps: z.number(), rttMs: z.number(), jitterMs: z.number(), packetLossPct: z.number(), videoDelayMs: z.number(),
  backupLinkUp: z.boolean(), streamLive: z.boolean(),
});

type H = { t: string; n?: string; id?: string };

/** A signed flop capture as sent by the Table Box (packages/odds-engine FlopCapture), strictly typed. */
const CaptureBody = z.object({
  capture: z.object({
    deviceId: z.string().min(1).max(200),
    tableId: z.string().min(1).max(200),
    roundId: z.string().min(1).max(200),
    handNo: z.number().int().safe().min(1),
    cards: z.tuple([z.string().min(1).max(3), z.string().min(1).max(3), z.string().min(1).max(3)]),
    source: z.enum(['vision', 'rfid']),
    imageSha256: z.string().regex(/^[0-9a-f]{64}$/),
    capturedAt: z.number().int().min(0).max(MAX_TIMESTAMP_MS),
    seq: z.number().int().safe().min(1),
    prevHash: z.string().min(1).max(200),
  }).strict(),
  signature: z.string().min(1).max(500),
  image_base64: z.string().max(20_000_000).optional(),
}).strict();

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
      `select id, hand_no, state, procedure_step as step, cut_depth, locked_at, deal_start_at, flop, review_reasons, review_started_at
         from rounds where table_id = $1 order by hand_no desc limit 3`, [t])).rows.map((r) => withReviewDeadline(r, ctx.config.reviewSlaMs) as Record<string, any>);
    // Entries per round. Independence (docs/12 §6): another person's cards are only visible once the
    // caller has submitted their own entry for that round, or the round is decided / under review.
    const all = (await ctx.db.query<{ round_id: string; source: string; person_id: string; cards: string[] }>(
      'select round_id, source, person_id, cards from flop_entries where round_id = any($1::text[])', [rounds.map((r) => r.id)])).rows;
    const me = p.kind === 'staff' ? p.personId : null;
    for (const r of rounds) {
      const mine = all.some((e) => e.round_id === r.id && e.person_id === me);
      const open = mine || ['SETTLED', 'VOID', 'REVIEW', 'EVIDENCE_REJECTED'].includes(r.state);
      r.entries = all.filter((e) => e.round_id === r.id).map((e) => ({ source: e.source, person_id: e.person_id, mine: e.person_id === me, cards: open || e.person_id === me ? e.cards : null }));
      r.has_dealer_entry = all.some((e) => e.round_id === r.id && e.source === 'dealer');
      r.has_floor_entry = all.some((e) => e.round_id === r.id && e.source === 'floor');
      r.my_entry = all.find((e) => e.round_id === r.id && e.person_id === me)?.cards ?? null;
      if (!open) r.flop = null;
    }
    return { table: { id: table.id, name: table.name, status: table.status, pause_reason: table.pause_reason, pause_kind: table.pause_kind, kind: table.kind }, readiness: await tableReadiness(ctx.db, table), rounds, entries: rounds[0]?.entries ?? [] };
  });

  /** Who this credential is (role, person, table), so a tablet can confirm its enrollment. */
  app.get('/v1/provider/whoami', async (req) => {
    const p = await auth(req);
    return p.kind === 'staff'
      ? { kind: 'staff', credential_id: p.id, role: p.role, person_id: p.personId, table_id: p.tableId }
      : { kind: 'device', credential_id: p.id, table_id: p.tableId };
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
    // The full signed-capture schema is checked here, before replay, chain or admission: a record
    // with a missing or mistyped field (e.g. no capturedAt) is refused as evidence (422), recorded
    // as a failed attempt, and never advances the device chain.
    const parsed = CaptureBody.safeParse(req.body);
    const shape = parsed.success ? captureShapeProblems(parsed.data) : parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
    return receiveCapture(c, t, handNo, d.id, (parsed.success ? parsed.data : req.body ?? {}) as Parameters<typeof receiveCapture>[4], ctx.timing, ev, shape);
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
    // Once cards are on the felt, voiding a real-money round would let the club cancel results it
    // has seen; from then on only the PreFlop team decides (POST /v1/admin/rounds/:id/review or
    // /void). "On the felt" starts at deal-start, which is recorded while the round is still LOCKED:
    // the round row is locked here, so a concurrent deal-start is either seen or comes after.
    const real = await carriesRealMoney(c, r);
    const from: RoundState[] | undefined = real ? ['OPEN', 'LOCKED'] : undefined;
    if (from && (!from.includes(r.state) || r.deal_start_at !== null)) {
      throw new ApiError(403, 'platform_review_required', 'after the deal, a real-money round is voided by the PreFlop team');
    }
    const ok = await voidRound(c, r, reason, s.id, ev, from);
    // A void from REVIEW is the floor manager's decision on that review (docs/20 §Measuring the adviser).
    if (ok && REVIEW_STATES.has(r.state)) await recordOutcome(c, 'review', r.id, 'void', `staff:${s.id}`);
    if (ok) await ensureOpenRound(c, r.table_id, ev);
    return ok ? { status: 200, body: { state: 'VOID' } } : { status: 409, body: { type: 'invalid_round_state', title: 'the round is already settled or voided', status: 409 } };
  }));

  /** Evidence for the floor manager's review on the club tablet (same data the PreFlop team sees). */
  app.get('/v1/provider/rounds/:id/evidence', async (req) => {
    const p = requireStaff(await auth(req), 'floor_manager');
    const { id } = req.params as H;
    const t = (await ctx.db.query<{ table_id: string }>('select table_id from rounds where id = $1', [id])).rows[0];
    if (!t) throw notFound('round');
    assertTableScope(p, t.table_id);
    return evidenceOf(ctx, id!);
  });

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
        if (out.status === 200) await recordOutcome(c, 'review', r.id, (req.body as { action: string }).action, `staff:${s.id}`);
        await ensureOpenRound(c, r.table_id, ev);
        return out;
      });
    });
    publish(ev);
    return reply.code(res.status).send(res.body);
  });

  app.post('/v1/provider/tables/:t/pause', write(async (c, p, req, ev) => {
    requireStaff(p, 'floor_manager');
    const { t } = req.params as H;
    await getTable(c, t);
    // Lock order: the open round first, then the table. Bets already accepted on the open flop are
    // refunded now, in this transaction; a hand already in progress finishes or meets its deadline.
    const open = (await c.query<{ id: string }>(`select id from rounds where table_id = $1 and state = 'OPEN'`, [t])).rows[0];
    if (open) await voidRound(c, await lockRound(c, open.id), 'table paused', p.id, ev, ['OPEN']);
    // A table already held by the outcome monitor, the evidence checks or the PreFlop team keeps that
    // hold (kind and reason): a floor pause on top must never turn it into one the floor may lift.
    const kept = (await c.query<{ pause_kind: string | null }>(
      `update poker_tables set status = 'paused', pause_kind = 'floor', pause_reason = $2
        where id = $1 and (status <> 'paused' or pause_kind is null or pause_kind = 'floor') returning pause_kind`,
      [t, String((req.body as { reason?: string })?.reason ?? 'paused by floor')])).rowCount === 0;
    await audit(c, { type: 'table.paused', tableId: t, by: p.id, ...(kept ? { keptExistingHold: true } : {}) });
    return { status: 200, body: { status: 'paused' } };
  }));

  /**
   * The club lifts only its own pause (pause_kind 'floor'). Holds for integrity — the outcome
   * monitor, failed captures ('evidence') or the PreFlop team ('platform') — are lifted by the PreFlop
   * team after review (PUT /v1/admin/tables/:id/status): 403 platform_resume_required.
   */
  app.post('/v1/provider/tables/:t/resume', write(async (c, p, req, ev) => {
    requireStaff(p, 'floor_manager');
    const { t } = req.params as H;
    const cur = (await c.query<{ status: string; pause_kind: string | null }>('select status, pause_kind from poker_tables where id = $1 for update', [t])).rows[0];
    if (!cur) throw notFound('table');
    if (cur.status === 'paused' && cur.pause_kind !== null && cur.pause_kind !== 'floor') {
      throw new ApiError(403, 'platform_resume_required', `this table is held (${cur.pause_kind}); the PreFlop team resumes it after review`);
    }
    await c.query(`update poker_tables set status = 'active', pause_reason = null, pause_kind = null where id = $1`, [t]);
    await audit(c, { type: 'table.resumed', tableId: t, by: p.id, previousPauseKind: cur.pause_kind });
    await ensureOpenRound(c, t, ev);
    return { status: 200, body: { status: 'active' } };
  }));
}
