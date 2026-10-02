import { generateKeyPairSync } from 'node:crypto';
import { signCapture } from '@preflop/odds-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signRequest } from '../src/auth/envelope.ts';
import { tx } from '../src/lib/db.ts';
import { seedSimTable } from '../src/seed.ts';
import { verifyAuditChain } from '../src/lib/audit.ts';
import { type Harness, bet, harness, ledgerSums, walletOf } from './helpers.ts';

let h: Harness;
beforeAll(async () => {
  h = await harness('evidence');
});
afterAll(async () => h?.close());

async function open(): Promise<number> {
  await h.sim.heartbeat();
  await h.work();
  const n = await h.sim.openHand();
  if (n === null) throw new Error('no open round');
  return n;
}
const state = async (n: number) => (await h.api('GET', `/v1/rounds/sim-1:h${n}`)).body.state;
const device = async () => (await h.db.query('select last_seq, last_hash from devices where id = $1', ['box-sim-1'])).rows[0];

describe('signed evidence (docs/13 §8.4)', () => {
  it('a forged capture is logged, leaves the round LOCKED and the checkpoint unchanged; the retry settles', async () => {
    const n = await open();
    const { cards } = await h.sim.procedure(n);
    const { capture, image, signed } = h.sim.buildCapture(n, cards);
    const before = await device();
    const forged = { capture: { ...capture, cards: [cards[0]!, cards[1]!, cards[0] === 'As' ? 'Ks' : 'As'] as [string, string, string] }, signature: signed.signature };
    const bad = await h.sim.sendCapture(n, forged, image);
    expect(bad.status).toBe(422);
    expect(bad.body.type).toBe('evidence_rejected');
    expect(bad.body.expected_seq).toBe(before.last_seq + 1);
    expect(await state(n)).toBe('LOCKED');
    expect(await device()).toEqual(before);
    expect((await h.db.query('select count(*)::int as n from capture_attempts where round_id = $1', [`sim-1:h${n}`])).rows[0].n).toBe(1);

    const good = await h.sim.sendCapture(n, signed, image);
    expect(good.status).toBe(200);
    expect(good.body).toEqual({ authentic: true, admitted: true });
    await h.sim.enter(n, 'dealer', cards);
    await h.sim.enter(n, 'floor', cards);
    await h.work();
    expect(await state(n)).toBe('SETTLED');
  });

  it('lost response: the identical record is acknowledged again in any state; a different signature conflicts', async () => {
    const n = await open();
    const { cards } = await h.sim.procedure(n);
    const { image, signed } = h.sim.buildCapture(n, cards);
    expect((await h.sim.sendCapture(n, signed, image)).status).toBe(200);
    await h.sim.enter(n, 'dealer', cards);
    await h.sim.enter(n, 'floor', cards);
    await h.work();
    expect(await state(n)).toBe('SETTLED');
    // the Box never saw the 200 and retries the identical record
    const again = await h.sim.call('device', 'POST', `/v1/provider/tables/sim-1/hands/${n}/capture`, { ...signed });
    expect(again.status).toBe(200);
    expect(again.body.authentic).toBe(true);
    // same seq, different content/signature → conflict, not accepted
    const other = signCapture({ ...signed.capture, capturedAt: signed.capture.capturedAt + 1 }, generateKeyPairSync('ed25519').privateKey);
    const conflictRes = await h.sim.call('device', 'POST', `/v1/provider/tables/sim-1/hands/${n}/capture`, other);
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.type).toBe('capture_conflict');
  });

  it('dealer/floor mismatch goes to REVIEW; only a floor manager who did not enter may settle it', async () => {
    const p = await h.register();
    const n = await open();
    await bet(h, p.token, `sim-1:h${n}`, 'colour:mixed', 100);
    const { cards } = await h.sim.procedure(n);
    const { image, signed } = h.sim.buildCapture(n, cards);
    await h.sim.sendCapture(n, signed, image);
    const wrong = cards[0] === '2c' ? ['3c', cards[1]!, cards[2]!] : ['2c', cards[1]!, cards[2]!];
    if (wrong.includes(cards[1]!) && wrong.filter((c) => c === wrong[0]).length > 1) throw new Error('bad fixture');
    await h.sim.enter(n, 'dealer', wrong);
    await h.sim.enter(n, 'floor', cards);
    await h.work();
    expect(await state(n)).toBe('REVIEW');

    // a dealer cannot resolve it
    const asDealer = await h.sim.call('dealer', 'POST', `/v1/provider/rounds/sim-1:h${n}/review`, { action: 'settle', cards });
    expect(asDealer.status).toBe(403);
    const ok = await h.sim.call('floor_manager', 'POST', `/v1/provider/rounds/sim-1:h${n}/review`, { action: 'settle', cards });
    expect(ok.status).toBe(200);
    expect(await state(n)).toBe('SETTLED');
    const b = (await h.api('GET', '/v1/me/bets', p.token)).body.bets[0];
    expect(['won', 'lost']).toContain(b.status);
  });

  it('a capture timed before the lock is authentic but not admitted → EVIDENCE_REJECTED → durable void + refund', async () => {
    const p = await h.register();
    const n = await open();
    await bet(h, p.token, `sim-1:h${n}`, 'colour:mixed', 500);
    expect(await walletOf(h, p.token)).toBe(9_500);
    const { cards } = await h.sim.procedure(n);
    const { image, signed } = h.sim.buildCapture(n, cards, { capturedAt: Date.now() - 3_600_000 });
    const res = await h.sim.sendCapture(n, signed, image);
    expect(res.body).toEqual({ authentic: true, admitted: false });
    expect(await state(n)).toBe('EVIDENCE_REJECTED');
    // the outbox job exists before any worker runs (crash safety)
    expect((await h.db.query(`select count(*)::int as n from outbox where kind = 'void_round' and ref = $1 and done_at is null`, [`sim-1:h${n}`])).rows[0].n).toBe(1);
    expect(await h.sim.openHand()).toBeNull(); // N+1 did not open on rejected evidence
    await h.work();
    expect(await state(n)).toBe('VOID');
    expect(await walletOf(h, p.token)).toBe(10_000);
    // the Box chain still advanced, so the next hand's capture verifies
    const m = await open();
    expect(m).toBe(n + 1);
    const nxt = await h.sim.procedure(m);
    const c2 = h.sim.buildCapture(m, nxt.cards);
    expect((await h.sim.sendCapture(m, c2.signed, c2.image)).body.admitted).toBe(true);
    await h.sim.enter(m, 'dealer', nxt.cards);
    await h.sim.enter(m, 'floor', nxt.cards);
    await h.work();
  });

  it('a shuffle-complete sent from a staff tablet is recorded as manual and voids the hand', async () => {
    const p = await h.register();
    const n = await open();
    await bet(h, p.token, `sim-1:h${n}`, 'colour:mixed', 100);
    const { cards } = await h.sim.procedure(n, { manualShuffle: true });
    const { image, signed } = h.sim.buildCapture(n, cards);
    await h.sim.sendCapture(n, signed, image);
    await h.sim.enter(n, 'dealer', cards);
    await h.sim.enter(n, 'floor', cards);
    await h.work();
    const r = (await h.db.query('select state, void_reason, shuffle_source from rounds where id = $1', [`sim-1:h${n}`])).rows[0];
    expect(r.shuffle_source).toBe('manual');
    expect(r.state).toBe('VOID');
    expect(r.void_reason).toMatch(/procedure/);
    expect(await walletOf(h, p.token)).toBe(10_000);
  });

  it('procedure steps out of order are refused (invalid_procedure_step)', async () => {
    const n = await open();
    const base = `/v1/provider/tables/sim-1/hands/${n}`;
    expect((await h.sim.call('dealer', 'POST', `${base}/cut`, {})).body.type).toBe('invalid_procedure_step');
    await h.sim.call('dealer', 'POST', `${base}/start`, {});
    expect((await h.sim.call('dealer', 'POST', `${base}/deal-start`, {})).body.type).toBe('invalid_procedure_step');
    await h.sim.call('floor_manager', 'POST', `${base}/void`, { reason: 'cleanup' });
  });

  it('the result deadline voids a round whose evidence never completes', async () => {
    const p = await h.register();
    const n = await open();
    await bet(h, p.token, `sim-1:h${n}`, 'colour:mixed', 100);
    await h.sim.procedure(n); // capture never arrives
    await h.db.query(`update rounds set locked_at = locked_at - interval '1 hour' where id = $1`, [`sim-1:h${n}`]);
    await h.work();
    expect(await state(n)).toBe('VOID');
    expect(await walletOf(h, p.token)).toBe(10_000);
  });
});

describe('request authentication (docs/13 §8.5)', () => {
  it('a reused nonce is refused; a signature re-targeted to another hand fails; another table → 403', async () => {
    const n = await open();
    const url = `/v1/provider/tables/sim-1/state`;
    const res1 = await h.sim.call('dealer', 'GET', url);
    expect(res1.status).toBe(200);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    await h.db.query(`insert into staff_credentials (id, table_id, person_id, role, public_key_pem) values ('cred-x', 'sim-1', 'p-x', 'dealer', $1)`, [publicKey.export({ type: 'spki', format: 'pem' }).toString()]);
    const header = signRequest('cred-x', privateKey, { method: 'GET', url });
    const first = await h.app.inject({ method: 'GET', url, headers: { 'x-preflop-auth': header } });
    const replay = await h.app.inject({ method: 'GET', url, headers: { 'x-preflop-auth': header } });
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(401);
    expect(JSON.parse(replay.body).type).toBe('replayed_request');

    const h2 = signRequest('cred-x', privateKey, { method: 'POST', url: `/v1/provider/tables/sim-1/hands/${n}/start`, idempotencyKey: 'k1', body: '{}' });
    const retarget = await h.app.inject({ method: 'POST', url: `/v1/provider/tables/sim-1/hands/${n + 1}/start`, headers: { 'x-preflop-auth': h2, 'idempotency-key': 'k1', 'content-type': 'application/json' }, payload: '{}' });
    expect(retarget.statusCode).toBe(401);
    expect(JSON.parse(retarget.body).type).toBe('bad_signature');

    await tx(h.db, async (c) => {
      await seedSimTable(c, { clubId: 'club-sim', tableId: 'sim-2', name: 'Midnight Room' });
    });
    const other = await h.sim.call('dealer', 'GET', '/v1/provider/tables/sim-2/state');
    expect(other.status).toBe(403);
  });

  it('Start retried with the same Idempotency-Key returns the stored response and issues one command', async () => {
    const n = await open();
    const url = `/v1/provider/tables/sim-1/hands/${n}/start`;
    const key = 'start-once-1';
    const dealerKey = (h.sim as unknown as { staff: { dealer: { key: import('node:crypto').KeyObject } } }).staff.dealer.key;
    const call = () => h.app.inject({ method: 'POST', url, payload: '{}', headers: {
      'content-type': 'application/json', 'idempotency-key': key,
      // a new nonce on every retry, the same Idempotency-Key
      'x-preflop-auth': signRequest('cred-sim-1-dealer', dealerKey, { method: 'POST', url, idempotencyKey: key, body: '{}' }),
    } });
    const a = await call();
    const b = await call();
    expect(a.statusCode).toBe(200);
    expect(JSON.parse(b.body)).toEqual(JSON.parse(a.body));
    expect((await h.db.query(`select count(*)::int as n from round_events where round_id = $1 and step = 'shuffle_command'`, [`sim-1:h${n}`])).rows[0].n).toBe(1);
    await h.sim.call('floor_manager', 'POST', `/v1/provider/tables/sim-1/hands/${n}/void`, { reason: 'cleanup' });
  });

  it("the floor cannot see the dealer's entry before entering its own (independence); whoami reports the role", async () => {
    const n = await open();
    const { cards } = await h.sim.procedure(n);
    await h.sim.enter(n, 'dealer', cards);
    const before = (await h.sim.call('floor', 'GET', '/v1/provider/tables/sim-1/state')).body.rounds.find((r: any) => r.hand_no === n);
    expect(before.has_dealer_entry).toBe(true);
    expect(before.entries[0].cards).toBeNull();
    expect(before.my_entry).toBeNull();
    await h.sim.enter(n, 'floor', cards);
    const after = (await h.sim.call('floor', 'GET', '/v1/provider/tables/sim-1/state')).body.rounds.find((r: any) => r.hand_no === n);
    expect(after.entries.every((e: any) => Array.isArray(e.cards))).toBe(true);
    expect((await h.sim.call('floor', 'GET', '/v1/provider/whoami')).body).toMatchObject({ kind: 'staff', role: 'floor', table_id: 'sim-1' });
    await h.sim.call('floor_manager', 'POST', `/v1/provider/tables/sim-1/hands/${n}/void`, { reason: 'cleanup' });
  });

  it('a capture replayed to a different hand is a conflict, not an acknowledgement', async () => {
    const n = await open();
    const { cards } = await h.sim.procedure(n);
    const { image, signed } = h.sim.buildCapture(n, cards);
    expect((await h.sim.sendCapture(n, signed, image)).status).toBe(200);
    await h.sim.enter(n, 'dealer', cards);
    await h.sim.enter(n, 'floor', cards);
    await h.work();
    const m = await open();
    await h.sim.procedure(m);
    const res = await h.sim.call('device', 'POST', `/v1/provider/tables/sim-1/hands/${m}/capture`, { ...signed });
    expect(res.status).toBe(409);
    expect(res.body.type).toBe('capture_conflict');
    await h.sim.call('floor_manager', 'POST', `/v1/provider/tables/sim-1/hands/${m}/void`, { reason: 'cleanup' });
  });

  it('pausing a table refunds the bets on its open flop at once', async () => {
    const p = await h.register();
    const n = await open();
    await bet(h, p.token, `sim-1:h${n}`, 'colour:mixed', 300);
    expect(await walletOf(h, p.token)).toBe(9_700);
    expect((await h.sim.call('floor_manager', 'POST', '/v1/provider/tables/sim-1/pause', { reason: 'test' })).status).toBe(200);
    expect(await state(n)).toBe('VOID');
    expect(await walletOf(h, p.token)).toBe(10_000);
    expect((await h.sim.call('floor_manager', 'POST', '/v1/provider/tables/sim-1/resume', {})).status).toBe(200);
  });

  it('a truncated audit tail is detected against the stored head', async () => {
    expect((await verifyAuditChain(h.db)).ok).toBe(true);
    const c = await h.db.connect();
    try {
      await c.query('begin');
      await c.query('alter table audit_log disable trigger audit_log_append_only');
      await c.query('delete from audit_log where seq = (select max(seq) from audit_log)');
      expect((await verifyAuditChain(c)).ok).toBe(false);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('physical tables never open while physical play is disabled', async () => {
    await h.db.query(`insert into poker_tables (id, club_id, name, kind) values ('phys-1', 'club-sim', 'Real felt', 'physical')`);
    await h.work();
    const t = (await h.api('GET', '/v1/tables/phys-1')).body;
    expect(t.ready).toBe(false);
    expect(t.problems.join(' ')).toMatch(/physical-table play is disabled/);
    expect(t.open_round_id).toBeNull();
  });

  it('the ledger still sums to zero per currency', async () => {
    for (const s of await ledgerSums(h.db)) expect(s.total).toBe(0);
  });
});
