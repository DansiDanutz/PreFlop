import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS_DIR, migrate } from '@preflop/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { EventBatch } from '../src/lib/events.ts';
import { ensureOpenRound } from '../src/rounds/service.ts';
import { runOutboxOnce } from '../src/worker.ts';
import { BASE_URL, type Harness, bet, harness, ledgerSums, testDbName, walletOf } from './helpers.ts';

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

  it('a hand settling while the switch goes off cannot open a new hand behind it', async () => {
    const id = (await create('Race table')).body.id;
    // the first hand is over; the next ensureOpenRound would open hand 2
    await h.db.query(`update rounds set state = 'SETTLED', settled_at = now() where id = $1`, [`${id}:h1`]);
    // the switch-off transaction: locks the manual tables, flips the setting, but has not committed yet
    const off = await h.db.connect();
    await off.query('begin');
    await off.query(`select id from poker_tables where kind = 'manual' order by id for update`);
    await off.query(`update settings set value = 'false' where key = 'manual_tables_enabled'`);
    // a settlement's ensureOpenRound now has to wait for it
    let opened: string | null | undefined;
    const settle = tx(h.db, (c) => ensureOpenRound(c, id, new EventBatch())).then((r) => { opened = r; return r; });
    await new Promise((r) => setTimeout(r, 300));
    expect(opened).toBeUndefined(); // still blocked on the table lock
    await off.query('commit');
    off.release();
    expect(await settle).toBeNull(); // after the commit it reads the switch as off: no hand opens
    expect((await h.db.query(`select count(*)::int as n from rounds where table_id = $1 and state = 'OPEN'`, [id])).rows[0].n).toBe(0);
    expect((await h.api('PUT', '/v1/admin/settings/manual_tables_enabled', admin, { value: true })).status).toBe(200);
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

describe('migration 021 on a database that already has a free-chip manual table (migration 020 allowed one)', () => {
  it('turns it into a retired play-money table, voids its open hand, and the API still starts', async () => {
    // A database migrated up to 020, as staging was between the two deploys.
    const name = testDbName('manual_tables_021');
    const admin = new pg.Client({ connectionString: BASE_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
    await admin.end();
    const u = new URL(BASE_URL);
    u.pathname = `/${name}`;
    const upTo020 = mkdtempSync(join(tmpdir(), 'preflop-migrations-'));
    for (const f of readdirSync(MIGRATIONS_DIR)) if (f < '021') copyFileSync(join(MIGRATIONS_DIR, f), join(upTo020, f));
    const db = createPool(u.toString(), 4);
    try {
      expect((await migrate(db, upTo020)).at(-1)).toBe('020_manual_tables.sql');
      await db.query(`insert into clubs (id, name) values ('club_t', 'Test club')`);
      await db.query(`insert into poker_tables (id, club_id, name, mode, currency, kind) values ('tbl_chips', 'club_t', 'Chip table', 'virtual-chips', 'CHIP', 'manual')`);
      await db.query(`insert into rounds (id, table_id, hand_no, mode, currency, state) values ('tbl_chips:h1', 'tbl_chips', 1, 'virtual-chips', 'CHIP', 'OPEN')`);
      // the rest of the migrations (021 onwards) apply instead of failing on the chip table
      const applied = await migrate(db);
      expect(applied[0]).toBe('021_manual_play_only.sql');
      expect((await db.query(`select mode, currency, status, pause_reason from poker_tables where id = 'tbl_chips'`)).rows[0])
        .toMatchObject({ mode: 'play', currency: 'PLAY', status: 'retired', pause_reason: expect.stringMatching(/play money only/) });
      // the hand is not voided by a raw update: the worker voids it through voidRound (bets and
      // tournament bets refunded, audit, events), from the outbox job the migration enqueued
      expect((await db.query(`select state from rounds where id = 'tbl_chips:h1'`)).rows[0]).toMatchObject({ state: 'OPEN' });
      expect((await db.query(`select kind from outbox where ref = 'tbl_chips:h1' and done_at is null`)).rows).toEqual([{ kind: 'void_round_migrated' }]);
      expect(await runOutboxOnce(db, { resultSlaMs: 300_000, reviewSlaMs: 300_000, maxCaptureDelayMs: 60_000 })).toBe(1);
      expect((await db.query(`select state, void_reason, voided_by from rounds where id = 'tbl_chips:h1'`)).rows[0])
        .toMatchObject({ state: 'VOID', void_reason: expect.stringMatching(/play money only/), voided_by: 'system:migration' });
      expect((await db.query(`select count(*)::int as n from audit_log where event::jsonb->>'type' = 'round.voided' and event::jsonb->>'roundId' = 'tbl_chips:h1'`)).rows[0].n).toBe(1);
      // a new chip manual table is now refused by the database itself
      await expect(db.query(`update poker_tables set mode = 'virtual-chips' where id = 'tbl_chips'`)).rejects.toThrow(/poker_tables_manual_play_only/);
    } finally {
      await db.end();
      rmSync(upTo020, { recursive: true, force: true });
    }
  });
});
