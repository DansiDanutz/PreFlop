import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit, verifyAuditChain } from '../src/lib/audit.ts';
import { tx } from '../src/lib/db.ts';
import { type MailTransport, deliverMail, mailStats, MAIL_MAX_ATTEMPTS, queueMail } from '../src/lib/mailer.ts';
import { enqueueWebhooks } from '../src/lib/webhooks.ts';
import { deliverDue } from '../src/routes/partner.ts';
import { seedAdmin, seedSimTable } from '../src/seed.ts';
import { SimTable, keysToFile } from '../src/sim/tableSim.ts';
import { type Harness, bet, harness, idemKey, ownedOrg, realMoneyReady } from './helpers.ts';

/**
 * External source audit (2026-10), backend findings F01–F05, F13, F14 and the email transport.
 * Each block fails on the code before its fix.
 */
let h: Harness;
let admin: string;
beforeAll(async () => {
  process.env.WEBHOOK_ALLOW_PRIVATE = 'true'; // the webhook receiver below listens on 127.0.0.1
  h = await harness('srcaudit');
  await tx(h.db, (c) => seedAdmin(c, 'sa-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'sa-admin@test.dev', password: 'admin-pass-1' })).body.token;
});
afterAll(async () => {
  delete process.env.WEBHOOK_ALLOW_PRIVATE;
  await h?.close();
});

let n = 0;
async function user(name: string) {
  const email = `${name}-${++n}-${Date.now()}@sa.dev`;
  const r = await h.api('POST', '/v1/auth/register', undefined, { email, password: 'correct horse', display_name: name, date_of_birth: '1990-01-01', country: 'MT' });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return { token: r.body.token as string, id: r.body.user.id as string, email };
}
const login = async (email: string) => h.api('POST', '/v1/auth/login', undefined, { email, password: 'correct horse' });
const modes = (real: boolean) => h.api('PUT', '/v1/admin/settings/modes_enabled', admin, { value: { play: true, 'virtual-chips': true, diamonds: true, 'real-fiat': real, 'real-crypto': real } });
async function openOn(sim: SimTable): Promise<number> {
  await sim.heartbeat();
  await h.work();
  const hand = await sim.openHand();
  if (hand === null) throw new Error('no open round');
  return hand;
}
const untilOf = async (id: string) => (await h.db.query<{ u: Date | null }>('select self_excluded_until as u from users where id = $1', [id])).rows[0]!.u;
const statusOf = async (id: string) => (await h.db.query<{ s: string }>('select status as s from users where id = $1', [id])).rows[0]!.s;
const DAY = 86_400_000;

describe('F01: self-exclusion can never be shortened or lifted early', () => {
  it('re-excluding for fewer days after signing in again keeps the longer period', async () => {
    const p = await user('se-short');
    const long = await h.api('POST', '/v1/me/self-exclusion', p.token, { days: 365 });
    expect(long.status).toBe(200);
    const until = new Date(long.body.until).getTime();
    expect(until).toBeGreaterThan(Date.now() + 364 * DAY);
    // Sessions end at exclusion; signing in is still possible (read-only), and must not shorten it.
    const again = await login(p.email);
    expect(again.status).toBe(200);
    const short = await h.api('POST', '/v1/me/self-exclusion', again.body.token, { days: 1 });
    expect(short.status).toBe(200);
    expect(new Date(short.body.until).getTime()).toBe(until);
    expect((await untilOf(p.id))!.getTime()).toBe(until);
    expect(await statusOf(p.id)).toBe('self_excluded');
    // A longer one extends it.
    const relog = (await login(p.email)).body.token;
    const longer = await h.api('POST', '/v1/me/self-exclusion', relog, { days: 400 });
    expect(new Date(longer.body.until).getTime()).toBeGreaterThan(until);
  });

  it('admin self_excluded → suspended → active before the end is refused; the account stays excluded', async () => {
    const p = await user('se-admin');
    expect((await h.api('POST', '/v1/me/self-exclusion', p.token, { days: 30 })).status).toBe(200);
    const sus = await h.api('PUT', `/v1/admin/users/${p.id}`, admin, { status: 'suspended' });
    expect(sus.status).toBe(200);
    const act = await h.api('PUT', `/v1/admin/users/${p.id}`, admin, { status: 'active' });
    expect([act.status, act.body.type]).toEqual([409, 'self_excluded']);
    expect(await statusOf(p.id)).toBe('suspended');
    // Any other write path is stopped by the database too.
    await expect(h.db.query(`update users set status = 'active' where id = $1`, [p.id])).rejects.toThrow(/self-exclusion/);
    // Back to self_excluded (allowed), then play stays refused until the end.
    expect((await h.api('PUT', `/v1/admin/users/${p.id}`, admin, { status: 'self_excluded' })).status).toBe(200);
    const s = await login(p.email);
    expect(s.status).toBe(200);
    const hand = await openOn(h.sim);
    expect((await bet(h, s.body.token, `sim-1:h${hand}`, 'colour:mixed', 100)).body.type).toBe('self_excluded');
    // Once it has ended, signing in lifts it and the admin may re-activate.
    await h.db.query(`update users set self_excluded_until = now() - interval '1 minute' where id = $1`, [p.id]);
    const after = await login(p.email);
    expect(await statusOf(p.id)).toBe('active');
    expect((await bet(h, after.body.token, `sim-1:h${hand}`, 'colour:mixed', 100)).status).toBe(201);
  });

  it('self-excluding a suspended account keeps it suspended (no route back to active through the lift)', async () => {
    const p = await user('se-sus');
    const tok = p.token;
    await h.db.query(`update users set status = 'suspended' where id = $1`, [p.id]);
    expect((await h.api('POST', '/v1/me/self-exclusion', tok, { days: 2 })).status).toBe(200);
    expect(await statusOf(p.id)).toBe('suspended');
  });

  it('real-money deposits are refused while self-excluded after signing in again', async () => {
    await modes(true);
    try {
      const p = await user('se-dep');
      await h.api('POST', '/v1/me/kyc', p.token, {});
      await realMoneyReady(h, p.id);
      await h.api('POST', '/v1/me/self-exclusion', p.token, { days: 10 });
      const t = (await login(p.email)).body.token;
      const r = await h.api('POST', '/v1/me/deposits', t, { mode: 'real-fiat', currency: 'EUR', amount_minor: 1_000, method: 'card' }, idemKey());
      expect([r.status, r.body.type]).toEqual([403, 'self_excluded']);
    } finally { await modes(false); }
  });
});

describe('F02: an explicit edit supersedes that field\'s queued change', () => {
  const put = (t: string, b: Record<string, unknown>) => h.api('PUT', '/v1/me/limits', t, b);
  const get = async (t: string) => (await h.api('GET', '/v1/me/limits', t)).body;
  const expire = (id: string) => h.db.query(`update rg_limits set pending_effective_at = now() - interval '1 minute' where user_id = $1`, [id]);

  it('100 → request 200 (queued) → reduce to 50: after the deadline the limit is still 50', async () => {
    const p = await user('lim');
    expect((await put(p.token, { deposit_day_minor: 100 })).body.deposit_day_minor).toBe(100);
    const up = (await put(p.token, { deposit_day_minor: 200, session_minutes: 60 })).body;
    expect(up.deposit_day_minor).toBe(100);
    expect(up.session_minutes).toBe(60); // a new limit applies at once
    // an unrelated field's queued increase, which must survive
    expect((await put(p.token, { loss_day_minor: 500 })).body.loss_day_minor).toBe(500);
    const q = (await put(p.token, { loss_day_minor: 900 })).body;
    expect(q.pending).toEqual({ deposit_day_minor: 200, loss_day_minor: 900 });
    const down = (await put(p.token, { deposit_day_minor: 50 })).body;
    expect(down.deposit_day_minor).toBe(50);
    expect(down.pending).toEqual({ loss_day_minor: 900 });
    await expire(p.id);
    const l = await get(p.token);
    expect([l.deposit_day_minor, l.loss_day_minor, l.session_minutes, l.pending]).toEqual([50, 900, 60, null]);
  });

  it('re-stating the current value cancels a queued increase; removing a queued removal works the same way', async () => {
    const p = await user('lim2');
    await put(p.token, { deposit_day_minor: 100 });
    await put(p.token, { deposit_day_minor: null }); // removal: queued
    expect((await get(p.token)).pending).toEqual({ deposit_day_minor: null });
    const same = (await put(p.token, { deposit_day_minor: 100 })).body;
    expect(same.pending).toBeNull();
    expect(same.pending_effective_at).toBeNull();
    await expire(p.id);
    expect((await get(p.token)).deposit_day_minor).toBe(100);
  });

  it('concurrent raise and reduce end in one of the two serial outcomes, never a stale raise over a later reduction', async () => {
    for (let i = 0; i < 6; i++) {
      const p = await user(`limc${i}`);
      await put(p.token, { deposit_day_minor: 100 });
      const [a, b] = await Promise.all([put(p.token, { deposit_day_minor: 200 }), put(p.token, { deposit_day_minor: 50 })]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const l = await get(p.token);
      expect(l.deposit_day_minor).toBe(50);
      // Raise last → 200 waits (a later explicit request); reduce last → nothing waits.
      expect([null, JSON.stringify({ deposit_day_minor: 200 })]).toContain(l.pending === null ? null : JSON.stringify(l.pending));
      const lastWasReduce = l.pending === null;
      await expire(p.id);
      expect((await get(p.token)).deposit_day_minor).toBe(lastWasReduce ? 50 : 200);
    }
  });
});

describe('F03/F04: floor powers end where the PreFlop team starts', () => {
  let sim: SimTable;
  const T = 'sa-rm';
  beforeAll(async () => {
    await modes(true);
    sim = new SimTable(h.send, keysToFile(await tx(h.db, (c) => seedSimTable(c, { clubId: 'club-sim', tableId: T, name: 'Real Table', mode: 'real-fiat', currency: 'EUR' }))));
    expect((await h.api('PUT', `/v1/admin/tables/${T}/real-money`, admin, { approved: true })).status).toBe(200);
  });
  afterAll(async () => { await modes(false); });

  const base = (hand: number) => `/v1/provider/tables/${T}/hands/${hand}`;
  const floorVoid = (hand: number) => sim.call('floor_manager', 'POST', `${base(hand)}/void`, { reason: 'misdeal' });
  /** Runs the procedure up to (not including) `stop`. */
  async function upTo(stop: 'open' | 'start' | 'shuffle' | 'cut' | 'deal' | 'capture'): Promise<number> {
    const hand = await openOn(sim);
    const steps = ['start', 'shuffle', 'cut', 'deal', 'capture'] as const;
    for (const s of steps) {
      if (s === stop || stop === 'open') break;
      if (s === 'start') expect((await sim.call('dealer', 'POST', `${base(hand)}/start`, {})).status).toBe(200);
      if (s === 'shuffle') expect((await sim.call('dealer', 'POST', `${base(hand)}/shuffle-complete`, {})).status).toBe(200);
      if (s === 'cut') expect((await sim.call('dealer', 'POST', `${base(hand)}/cut`, {})).status).toBe(200);
      if (s === 'deal') expect((await sim.call('dealer', 'POST', `${base(hand)}/deal-start`, {})).status).toBe(200);
    }
    return hand;
  }

  it('F03: the floor may void a real-money round before deal-start, never after', async () => {
    for (const stop of ['open', 'shuffle', 'cut', 'deal'] as const) {
      const hand = await upTo(stop);
      const r = await floorVoid(hand);
      expect([stop, r.status], JSON.stringify(r.body)).toEqual([stop, 200]);
    }
    // deal-start recorded, round still LOCKED: refused
    const hand = await upTo('capture');
    const rid = `${T}:h${hand}`;
    expect((await h.db.query('select state from rounds where id = $1', [rid])).rows[0].state).toBe('LOCKED');
    const r = await floorVoid(hand);
    expect([r.status, r.body.type]).toEqual([403, 'platform_review_required']);
    // DEALT and REVIEW: refused
    await h.db.query(`update rounds set state = 'DEALT' where id = $1`, [rid]);
    expect((await floorVoid(hand)).body.type).toBe('platform_review_required');
    await h.db.query(`update rounds set state = 'REVIEW', review_started_at = clock_timestamp(), review_reasons = '["t"]' where id = $1`, [rid]);
    expect((await floorVoid(hand)).body.type).toBe('platform_review_required');
    // the PreFlop team still can
    const a = await h.api('POST', `/v1/admin/rounds/${rid}/void`, admin, { reason: 'misdeal after deal' });
    expect([a.status, a.body.state]).toEqual([200, 'VOID']);
  });

  it('F03: concurrent deal-start and floor void never both succeed', async () => {
    for (let i = 0; i < 4; i++) {
      const hand = await upTo('deal');
      const [d, v] = await Promise.all([sim.call('dealer', 'POST', `${base(hand)}/deal-start`, {}), floorVoid(hand)]);
      const st = (await h.db.query('select state, deal_start_at from rounds where id = $1', [`${T}:h${hand}`])).rows[0];
      if (v.status === 200) {
        expect(st.state).toBe('VOID');
        expect(d.status).not.toBe(200);
      } else {
        expect([v.status, v.body.type, d.status]).toEqual([403, 'platform_review_required', 200]);
        expect(st.deal_start_at).not.toBeNull();
        expect((await h.api('POST', `/v1/admin/rounds/${T}:h${hand}/void`, admin, { reason: 'cleanup' })).status).toBe(200);
      }
    }
  });

  it('F04: a floor resume clears only a floor pause; integrity holds need the PreFlop team', async () => {
    const tbl = async () => (await h.db.query('select status, pause_kind, pause_reason from poker_tables where id = $1', [T])).rows[0];
    for (const kind of ['monitor', 'evidence', 'platform'] as const) {
      await h.db.query(`update poker_tables set status = 'paused', pause_kind = $2, pause_reason = 'hold' where id = $1`, [T, kind]);
      const r = await sim.call('floor_manager', 'POST', `/v1/provider/tables/${T}/resume`, {});
      expect([kind, r.status, r.body.type]).toEqual([kind, 403, 'platform_resume_required']);
      expect(await tbl()).toMatchObject({ status: 'paused', pause_kind: kind });
      // A floor pause on top must not turn the hold into a floor pause it could then lift.
      expect((await sim.call('floor_manager', 'POST', `/v1/provider/tables/${T}/pause`, { reason: 'floor too' })).status).toBe(200);
      expect(await tbl()).toMatchObject({ status: 'paused', pause_kind: kind, pause_reason: 'hold' });
      expect((await sim.call('floor_manager', 'POST', `/v1/provider/tables/${T}/resume`, {})).status).toBe(403);
      // PreFlop admin/ops resume (audited)
      expect((await h.api('PUT', `/v1/admin/tables/${T}/status`, admin, { status: 'active' })).status).toBe(200);
      expect(await tbl()).toMatchObject({ status: 'active', pause_kind: null });
      const ev = (await h.db.query(`select event from audit_log where event::jsonb->>'type' = 'table.resumed' and event::jsonb->>'tableId' = $1 order by seq desc limit 1`, [T])).rows[0];
      expect(JSON.parse(ev.event)).toMatchObject({ previousPauseKind: kind });
    }
    // the floor's own pause: paused and resumed from the tablet
    expect((await sim.call('floor_manager', 'POST', `/v1/provider/tables/${T}/pause`, { reason: 'break' })).status).toBe(200);
    expect((await tbl()).pause_kind).toBe('floor');
    expect((await sim.call('floor_manager', 'POST', `/v1/provider/tables/${T}/resume`, {})).status).toBe(200);
    expect((await tbl()).status).toBe('active');
  });

  it('F04: three failed captures pause the table for evidence; the floor cannot clear it', async () => {
    const hand = await upTo('capture');
    const { signed } = sim.buildCapture(hand, ['Ah', 'Kd', '2s'], { seq: 999 });
    for (let i = 0; i < 3; i++) expect((await sim.sendCapture(hand, signed)).status).toBe(422);
    expect((await h.db.query('select pause_kind from poker_tables where id = $1', [T])).rows[0].pause_kind).toBe('evidence');
    expect((await sim.call('floor_manager', 'POST', `/v1/provider/tables/${T}/resume`, {})).status).toBe(403);
    expect((await h.api('PUT', `/v1/admin/tables/${T}/status`, admin, { status: 'active' })).status).toBe(200);
  });
});

describe('F05: a capture must carry a valid signed timestamp (HTTP ingress)', () => {
  const variants: [string, unknown][] = [
    ['missing', undefined], ['null', null], ['string', String(Date.now())], ['negative', -1], ['fraction', Date.now() + 0.5], ['huge', 1e300],
  ];
  it.each(variants)('capturedAt %s → 422 evidence_rejected, never admitted, chain not advanced', async (_label, value) => {
    const hand = await openOn(h.sim);
    const { cards } = await h.sim.procedure(hand);
    const { signed, image } = h.sim.buildCapture(hand, cards, { capturedAt: value as number });
    const seqBefore = h.sim.seq;
    const r = await h.sim.sendCapture(hand, signed, image);
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.type).toBe('evidence_rejected');
    expect(r.body.problems.join(' ')).toMatch(/capturedAt/);
    expect(h.sim.seq).toBe(seqBefore);
    const rid = `sim-1:h${hand}`;
    expect((await h.db.query('select state from rounds where id = $1', [rid])).rows[0].state).toBe('LOCKED');
    expect((await h.db.query('select 1 from captures where round_id = $1', [rid])).rowCount).toBe(0);
    expect((await h.sim.call('floor_manager', 'POST', `/v1/provider/tables/sim-1/hands/${hand}/void`, { reason: 'cleanup' })).status).toBe(200);
  });

  it('a wrongly typed field or an unknown field is refused at ingress as well', async () => {
    for (const o of [{ seq: '1' }, { handNo: 1.5 }, { cards: ['Ah', 'Kd'] }, { source: 'manual' }, { imageSha256: 'abc' }, { extra: 1 }] as Record<string, unknown>[]) {
      const hand = await openOn(h.sim);
      const { cards } = await h.sim.procedure(hand);
      const { signed, image } = h.sim.buildCapture(hand, cards, o as never);
      const r = await h.sim.sendCapture(hand, signed, image);
      expect([JSON.stringify(o), r.status]).toEqual([JSON.stringify(o), 422]);
      expect((await h.sim.call('floor_manager', 'POST', `/v1/provider/tables/sim-1/hands/${hand}/void`, { reason: 'cleanup' })).status).toBe(200);
    }
    // a well-formed capture still works
    const hand = await openOn(h.sim);
    const out = await h.sim.playHand(hand);
    expect(out.captureStatus).toBe(200);
  });
});

describe('F13: audit verification reads one consistent snapshot', () => {
  it('verifying while events are appended never reports corruption; real tampering is still found', async () => {
    let stop = false;
    const writers = Array.from({ length: 4 }, async () => {
      let i = 0;
      while (!stop && i < 60) await tx(h.db, (c) => audit(c, { type: 'test.append', i: i++ }));
    });
    const results: boolean[] = [];
    for (let i = 0; i < 40; i++) results.push((await verifyAuditChain(h.db)).ok);
    stop = true;
    await Promise.all(writers);
    expect(results.every(Boolean)).toBe(true);
    expect((await verifyAuditChain(h.db)).ok).toBe(true);
    // tamper with one event
    const row = (await h.db.query<{ seq: number }>(`select seq from audit_log where event::jsonb->>'type' = 'test.append' order by seq limit 1`)).rows[0]!;
    const c = await h.db.connect();
    try {
      await c.query('begin');
      await c.query('alter table audit_log disable trigger audit_log_append_only');
      await c.query(`update audit_log set event = replace(event, '"test.append"', '"test.appenD"') where seq = $1`, [row.seq]);
      const v = await verifyAuditChain(c);
      expect([v.ok, v.brokenAt]).toEqual([false, row.seq]);
    } finally {
      await c.query('rollback');
      c.release();
    }
    expect((await verifyAuditChain(h.db)).ok).toBe(true);
  });
});

describe('F14: a disabled webhook delivers nothing more', () => {
  it('disable cancels pending and retrying deliveries; a stale claim is not taken over; re-enable sends new events only', async () => {
    const got: string[] = [];
    const server = createServer((req, res) => {
      let b = '';
      req.on('data', (d) => { b += d; });
      req.on('end', () => { got.push(JSON.parse(b).event_id); res.writeHead(200).end(); });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      const owner = await user('wh');
      const org = await ownedOrg(h, admin, { kind: 'partner', name: `WH ${n}` }, owner);
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
      const wh = await h.api('POST', `/v1/org/${org}/webhooks`, owner.token, { url, events: ['round.voided'] });
      expect(wh.status).toBe(201);
      const hookId = wh.body.id as string;
      const ins = (id: string, status: string, attempts: number, extra = '') => h.db.query(
        `insert into webhook_deliveries (id, webhook_id, event_id, event_type, payload, status, attempts${extra ? ', claimed_at' : ''})
         values ($1, $2, $1, 'round.voided', $3, $4, $5${extra ? `, ${extra}` : ''})`, [id, hookId, JSON.stringify({ event_id: id }), status, attempts]);
      await ins('whd_pending', 'pending', 0);
      await ins('whd_retrying', 'pending', 3);
      await ins('whd_stale', 'sending', 1, `now() - interval '1 hour'`);
      await ins('whd_inflight', 'sending', 1, 'now()');
      const del = await h.api('DELETE', `/v1/org/${org}/webhooks/${hookId}`, owner.token);
      expect(del.status).toBe(200);
      expect(del.body.cancelled).toBe(2);
      await deliverDue(h.db, 50);
      expect(got.filter((e) => e.startsWith('whd_'))).toEqual([]);
      const st = Object.fromEntries((await h.db.query('select id, status from webhook_deliveries where webhook_id = $1', [hookId])).rows.map((r) => [r.id, r.status]));
      expect(st).toMatchObject({ whd_pending: 'cancelled', whd_retrying: 'cancelled', whd_stale: 'cancelled', whd_inflight: 'sending' });
      // new events are not queued for a disabled hook; the test route refuses
      expect(await tx(h.db, (c) => enqueueWebhooks(c, { type: 'round.voided', roundId: 'r-off', tableId: 't', data: {} }))).toBe(0);
      expect((await h.api('POST', `/v1/org/${org}/webhooks/${hookId}/test`, owner.token)).body.type).toBe('webhook_disabled');
      expect((await h.db.query(`select event from audit_log where event::jsonb->>'type' = 'partner.webhook_disabled' and event::jsonb->>'webhookId' = $1`, [hookId])).rowCount).toBe(1);
      // re-enable: cancelled rows stay cancelled, new events flow
      expect((await h.api('POST', `/v1/org/${org}/webhooks/${hookId}/enable`, owner.token)).status).toBe(200);
      await tx(h.db, (c) => enqueueWebhooks(c, { type: 'round.voided', roundId: 'r-on', tableId: 't', data: {} }));
      await deliverDue(h.db, 50);
      expect(got).toEqual(['round.voided:r-on:']);
      expect((await h.db.query(`select count(*)::int as n from webhook_deliveries where webhook_id = $1 and status = 'cancelled'`, [hookId])).rows[0].n).toBe(3);
    } finally {
      server.close();
    }
  });
});

describe('F14: a disable racing an event that is being queued', () => {
  it('a settlement that read the hook before the disable still has its delivery cancelled', async () => {
    const owner = await user('whr');
    const org = await ownedOrg(h, admin, { kind: 'partner', name: `WHR ${n}` }, owner);
    const wh = await h.api('POST', `/v1/org/${org}/webhooks`, owner.token, { url: 'http://127.0.0.1:9/hook', events: ['round.voided'] });
    const hookId = wh.body.id as string;
    const c = await h.db.connect();
    try {
      await c.query('begin');
      // the "settlement" queues its webhook and has not committed yet
      expect(await enqueueWebhooks(c as never, { type: 'round.voided', roundId: `r-race-${n}`, tableId: 't', data: {} })).toBeGreaterThanOrEqual(1);
      let disabled = false;
      const del = h.api('DELETE', `/v1/org/${org}/webhooks/${hookId}`, owner.token).then((r) => { disabled = true; return r; });
      await new Promise((r) => setTimeout(r, 300));
      expect(disabled).toBe(false); // the disable waits for the queuing transaction
      await c.query('commit');
      expect((await del).body.cancelled).toBe(1);
    } finally {
      c.release();
    }
    const st = (await h.db.query('select status from webhook_deliveries where webhook_id = $1', [hookId])).rows.map((r) => r.status);
    expect(st).toEqual(['cancelled']);
  });
});

describe('Email: per-message backoff and a bounded number of attempts', () => {
  it('a failing message is tried once per pass, backs off, and fails after the maximum attempts', async () => {
    await h.db.query(`update email_outbox set status = 'sent', sent_at = now(), body = '' where status = 'pending'`);
    await h.db.query(`insert into email_outbox (to_email, template, subject, body) values ('bad@sa.dev', 'verify_email', 's', 'b'), ('good@sa.dev', 'verify_email', 's', 'b')`);
    const sent: string[] = [];
    let tries = 0;
    const flaky: MailTransport = { name: 'fake', send: async (m) => { if (m.to === 'bad@sa.dev') { tries++; throw new Error('421 try later'); } sent.push(m.to); } };
    const failedBefore = mailStats.failedAttempts;
    expect(await deliverMail(h.db, flaky, 'PreFlop <no-reply@test.dev>', 50)).toBe(1);
    expect(tries).toBe(1); // not retried in the same pass
    expect(sent).toEqual(['good@sa.dev']);
    expect(mailStats.failedAttempts).toBe(failedBefore + 1);
    const bad = async () => (await h.db.query('select status, attempts, next_attempt_at, last_error from email_outbox where to_email = $1', ['bad@sa.dev'])).rows[0];
    let b = await bad();
    expect(b).toMatchObject({ status: 'pending', attempts: 1, last_error: '421 try later' });
    expect(b.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
    // not due yet: nothing happens
    await deliverMail(h.db, flaky, 'x', 50);
    expect(tries).toBe(1);
    // backoff grows
    const gaps: number[] = [];
    for (let i = 2; i <= MAIL_MAX_ATTEMPTS; i++) {
      await h.db.query(`update email_outbox set next_attempt_at = now() - interval '1 second' where to_email = 'bad@sa.dev'`);
      const t0 = Date.now();
      await deliverMail(h.db, flaky, 'x', 50);
      b = await bad();
      if (b.status === 'pending') gaps.push(b.next_attempt_at.getTime() - t0);
    }
    expect(tries).toBe(MAIL_MAX_ATTEMPTS);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]!);
    expect(b).toMatchObject({ status: 'failed', attempts: MAIL_MAX_ATTEMPTS });
    expect((await h.db.query('select body from email_outbox where to_email = $1', ['bad@sa.dev'])).rows[0].body).toBe(''); // its link is not kept
    await h.db.query(`update email_outbox set next_attempt_at = now() - interval '1 second' where to_email = 'bad@sa.dev'`);
    await deliverMail(h.db, flaky, 'x', 50);
    expect(tries).toBe(MAIL_MAX_ATTEMPTS); // a failed message is never picked again
    const m = (await h.api('GET', '/v1/admin/metrics', admin)).body;
    expect(m.email_outbox.failed).toBeGreaterThanOrEqual(1);
  });

  it('a provider that hangs costs one bounded attempt, not the worker', async () => {
    await h.db.query(`update email_outbox set status = 'sent', sent_at = now(), body = '' where status = 'pending'`);
    const to = `hang-${Date.now()}@sa.dev`;
    await tx(h.db, (c) => queueMail(c, { to, template: 'verify_email', subject: 's', text: 'b' }));
    const hang: MailTransport = { name: 'hang', send: () => new Promise(() => {}) };
    const t0 = Date.now();
    expect(await deliverMail(h.db, hang, 'x', 5, 200)).toBe(0);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect((await h.db.query('select status, attempts, last_error from email_outbox where to_email = $1', [to])).rows[0])
      .toMatchObject({ status: 'pending', attempts: 1, last_error: 'send timed out after 200 ms' });
  });

  it('an expired link is never sent late, a replaced one is never sent at all, and dead messages lose their link', async () => {
    await h.db.query(`update email_outbox set status = 'sent', sent_at = now(), body = '' where status = 'pending'`);
    const to = `late-${Date.now()}@sa.dev`;
    await tx(h.db, (c) => queueMail(c, { to, template: 'reset_password', subject: 's', text: 'link-1' }, { expiresInMs: 3_600_000 }));
    await tx(h.db, (c) => queueMail(c, { to, template: 'reset_password', subject: 's', text: 'link-2' }, { expiresInMs: 3_600_000 }));
    const rows = async () => (await h.db.query('select body, status, last_error from email_outbox where to_email = $1 order by id', [to])).rows;
    expect((await rows()).map((r) => [r.body, r.status])).toEqual([['', 'cancelled'], ['link-2', 'pending']]);
    // the provider is down for longer than the link lives
    await h.db.query(`update email_outbox set attempts = 6, next_attempt_at = now() - interval '1 second', expires_at = now() - interval '1 second' where to_email = $1 and status = 'pending'`, [to]);
    const got: string[] = [];
    await deliverMail(h.db, { name: 'fake', send: async (m) => { got.push(m.text); } }, 'x', 50);
    expect(got).toEqual([]);
    expect((await rows())[1]).toMatchObject({ body: '', status: 'cancelled', last_error: 'link expired before delivery' });
  });

});
