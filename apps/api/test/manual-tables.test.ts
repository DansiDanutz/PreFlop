import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, bet, harness, ledgerSums, walletOf } from './helpers.ts';

/**
 * Manual tables (migration 020): the PreFlop team closes betting and types the flop in the
 * console. Free play only; the flop is accepted only after betting closes; every step is audited.
 */
let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await harness('manual_tables');
  await tx(h.db, (c) => seedAdmin(c, 'manual-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'manual-admin@test.dev', password: 'admin-pass-1' })).body.token;
});
afterAll(async () => h?.close());

const create = async (name: string, mode?: string) => h.api('POST', '/v1/admin/tables/manual', admin, { name, ...(mode ? { mode } : {}) });
const current = async (id: string) => (await h.api('GET', '/v1/admin/tables/manual', admin)).body.tables.find((t: any) => t.id === id);

describe('manual tables', () => {
  it('a new manual table opens betting at once, with no Table Box, stream or certification', async () => {
    const r = await create('Webcam test table');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: 'manual', mode: 'play', currency: 'PLAY' });
    const t = await current(r.body.id);
    expect(t.round).toMatchObject({ hand_no: 1, state: 'OPEN' });
    // players see it in the lobby like any table
    const lobby = (await h.api('GET', '/v1/lobby')).body.tables.find((x: any) => x.id === r.body.id);
    expect(lobby).toMatchObject({ kind: 'manual' });
  });

  it('bets, close betting, typed flop: the round settles, pays winners and the next round opens', async () => {
    const id = (await create('Settle table')).body.id;
    const p = await h.register('Manual player');
    const before = await walletOf(h, p.token);
    const round = `${id}:h1`;
    expect((await bet(h, p.token, round, 'colour:mixed', 1_000)).status).toBe(201);

    // the flop cannot be typed while betting is open
    const early = await h.api('POST', `/v1/admin/tables/${id}/manual/flop`, admin, { hand_no: 1, cards: ['Ah', 'Kd', '7c'] });
    expect(early.status).toBe(409);
    expect(early.body.title).toMatch(/close betting/);

    expect((await h.api('POST', `/v1/admin/tables/${id}/manual/lock`, admin, { hand_no: 1 })).status).toBe(200);
    // no bets after betting closes
    expect((await bet(h, p.token, round, 'colour:mixed', 500)).status).toBe(409);

    // bad cards are refused and change nothing
    expect((await h.api('POST', `/v1/admin/tables/${id}/manual/flop`, admin, { hand_no: 1, cards: ['Ah', 'Ah', '7c'] })).status).toBe(422);
    expect((await h.api('POST', `/v1/admin/tables/${id}/manual/flop`, admin, { hand_no: 1, cards: ['Zz', 'Kd', '7c'] })).status).toBe(422);

    // Ah Kd 7c: two red and one black = mixed colours, so the bet wins
    const s = await h.api('POST', `/v1/admin/tables/${id}/manual/flop`, admin, { hand_no: 1, cards: ['Ah', 'Kd', '7c'] });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ state: 'SETTLED', cards: ['Ah', 'Kd', '7c'], next_round_id: `${id}:h2` });
    const row = (await h.db.query('select state, flop, flop_source from rounds where id = $1', [round])).rows[0];
    expect(row).toMatchObject({ state: 'SETTLED', flop: ['Ah', 'Kd', '7c'], flop_source: 'manual' });
    const b = (await h.db.query('select status, payout_minor from bets where round_id = $1', [round])).rows[0];
    expect(b.status).toBe('won');
    expect(await walletOf(h, p.token)).toBe(before - 1_000 + b.payout_minor);

    // typed twice: the second is refused
    expect((await h.api('POST', `/v1/admin/tables/${id}/manual/flop`, admin, { hand_no: 1, cards: ['2c', '3c', '4c'] })).status).toBe(409);

    // the audit says who typed which cards
    const a = (await h.db.query(`select event from audit_log where event::jsonb->>'type' = 'round.manual_flop' and event::jsonb->>'roundId' = $1`, [round])).rows[0].event;
    const ev = typeof a === 'string' ? JSON.parse(a) : a;
    expect(ev).toMatchObject({ cards: ['Ah', 'Kd', '7c'], by: 'user:u_admin' });
    for (const s of await ledgerSums(h.db)) expect(s.total).toBe(0);
  });

  it('an unentered flop is voided and refunded at the result deadline', async () => {
    const id = (await create('Deadline table')).body.id;
    const p = await h.register('Refund player');
    const before = await walletOf(h, p.token);
    expect((await bet(h, p.token, `${id}:h1`, 'colour:mixed', 700)).status).toBe(201);
    expect((await h.api('POST', `/v1/admin/tables/${id}/manual/lock`, admin, { hand_no: 1 })).status).toBe(200);
    await h.db.query(`update rounds set locked_at = now() - interval '1 hour' where id = $1`, [`${id}:h1`]);
    await h.work();
    expect((await h.db.query('select state from rounds where id = $1', [`${id}:h1`])).rows[0].state).toBe('VOID');
    expect(await walletOf(h, p.token)).toBe(before);
  });

  it('play money only (migration 021), PreFlop team only, never real money, never on a simulated table', async () => {
    const r = await create('Chip table', 'virtual-chips');
    expect(r.body).toMatchObject({ mode: 'play', currency: 'PLAY' }); // a mode in the body is ignored
    await expect(h.db.query(`update poker_tables set mode = 'virtual-chips' where kind = 'manual'`)).rejects.toThrow(/poker_tables_manual_play_only/);
    // never approved for real money: a typed flop has no capture or review
    const approve = await h.api('PUT', `/v1/admin/tables/${r.body.id}/real-money`, admin, { approved: true });
    expect(approve.status).toBe(422);
    expect(approve.body.type).toBe('manual_table');
    expect((await h.db.query('select real_money_approved_at from poker_tables where id = $1', [r.body.id])).rows[0].real_money_approved_at).toBeNull();

    const p = await h.register('Not staff');
    expect((await h.api('POST', '/v1/admin/tables/manual', p.token, { name: 'Mine' })).status).toBe(403);
    expect((await h.api('POST', `/v1/admin/tables/${r.body.id}/manual/lock`, p.token, { hand_no: 1 })).status).toBe(403);

    await h.sim.heartbeat();
    await h.work();
    const hand = await h.sim.openHand();
    const sim = await h.api('POST', '/v1/admin/tables/sim-1/manual/lock', admin, { hand_no: hand });
    expect(sim.status).toBe(409);
    expect(sim.body.type).toBe('not_manual_table');
  });

  it('a flop typed after the result deadline voids and refunds the hand instead of paying', async () => {
    const id = (await create('Late table')).body.id;
    const p = await h.register('Late player');
    const before = await walletOf(h, p.token);
    expect((await bet(h, p.token, `${id}:h1`, 'colour:mixed', 400)).status).toBe(201);
    expect((await h.api('POST', `/v1/admin/tables/${id}/manual/lock`, admin, { hand_no: 1 })).status).toBe(200);
    await h.db.query(`update rounds set locked_at = now() - interval '1 hour' where id = $1`, [`${id}:h1`]);
    const late = await h.api('POST', `/v1/admin/tables/${id}/manual/flop`, admin, { hand_no: 1, cards: ['Ah', 'Kd', '7c'] });
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ type: 'round_expired', next_round_id: `${id}:h2` });
    expect((await h.db.query('select state, void_reason, flop from rounds where id = $1', [`${id}:h1`])).rows[0]).toMatchObject({ state: 'VOID', void_reason: 'result deadline passed', flop: null });
    expect(await walletOf(h, p.token)).toBe(before);
    for (const s of await ledgerSums(h.db)) expect(s.total).toBe(0);
  });

  it('switching manual_tables_enabled off refunds open hands and stops new ones', async () => {
    const id = (await create('Switch table')).body.id;
    const p = await h.register('Off player');
    const before = await walletOf(h, p.token);
    expect((await bet(h, p.token, `${id}:h1`, 'colour:mixed', 100)).status).toBe(201);
    expect((await h.api('PUT', '/v1/admin/settings/manual_tables_enabled', admin, { value: false })).status).toBe(200);
    // the open hand was voided and refunded by the switch, so no bet is stranded
    expect((await h.db.query('select state, void_reason from rounds where id = $1', [`${id}:h1`])).rows[0]).toMatchObject({ state: 'VOID', void_reason: 'manual tables switched off' });
    expect(await walletOf(h, p.token)).toBe(before);
    expect((await bet(h, p.token, `${id}:h1`, 'colour:mixed', 100)).status).toBe(409);
    expect((await h.api('POST', `/v1/admin/tables/${id}/manual/lock`, admin, { hand_no: 1 })).status).toBe(409);
    await h.work(); // no new hand opens while the switch is off
    expect((await h.db.query('select count(*)::int as n from rounds where table_id = $1', [id])).rows[0].n).toBe(1);
    expect((await h.api('GET', '/v1/admin/tables/manual', admin)).body.enabled).toBe(false);
    expect((await h.api('PUT', '/v1/admin/settings/manual_tables_enabled', admin, { value: true })).status).toBe(200);
    await h.work();
    expect((await h.db.query(`select count(*)::int as n from rounds where table_id = $1 and state = 'OPEN'`, [id])).rows[0].n).toBe(1);
    for (const s of await ledgerSums(h.db)) expect(s.total).toBe(0);
  });
});
