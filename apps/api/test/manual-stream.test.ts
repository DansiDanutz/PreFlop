import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness } from './helpers.ts';

/**
 * Webcam tables (migration 032): a manual table shows players its YouTube/Twitch stream, and the
 * console can send the frame it read the flop from, kept as evidence with its SHA-256.
 */
let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await harness('manual_stream');
  await tx(h.db, (c) => seedAdmin(c, 'stream-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'stream-admin@test.dev', password: 'admin-pass-1' })).body.token;
});
afterAll(async () => h?.close());

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const create = (body: Record<string, unknown>) => h.api('POST', '/v1/admin/tables/manual', admin, body);
const setStream = (id: string, stream_url: string | null, token = admin) => h.api('PUT', `/v1/admin/tables/${id}/manual/stream`, token, { stream_url });
/** A tiny JPEG-shaped payload: the start-of-image and end-of-image markers around some bytes. */
const jpeg = (fill = 7) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, fill), Buffer.from([0xff, 0xd9])]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const snapshot = (b: Buffer, digest = sha(b), read_cards = ['Ah', 'Kd', '7c']) => ({ image_base64: b.toString('base64'), sha256: digest, read_cards });

async function lockedTable(name: string) {
  const id = (await create({ name })).body.id as string;
  expect((await h.api('POST', `/v1/admin/tables/${id}/manual/lock`, admin, { hand_no: 1 })).status).toBe(200);
  return id;
}

describe('manual table stream link', () => {
  it('is set at creation and shown to players as a provider and id, never the pasted URL', async () => {
    const r = await create({ name: 'Stream table', stream_url: YT });
    expect(r.status).toBe(200);
    expect(r.body.stream).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    const detail = (await h.api('GET', `/v1/tables/${r.body.id}`)).body;
    expect(detail.stream).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    const lobby = (await h.api('GET', '/v1/lobby')).body.tables.find((t: any) => t.id === r.body.id);
    expect(lobby.stream).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    const admins = (await h.api('GET', '/v1/admin/tables/manual', admin)).body.tables.find((t: any) => t.id === r.body.id);
    expect(admins.stream).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
  });

  it('can be changed and removed, and every change is audited', async () => {
    const id = (await create({ name: 'Changing stream' })).body.id as string;
    expect((await h.api('GET', `/v1/tables/${id}`)).body.stream).toBeNull();
    const set = await setStream(id, 'https://www.twitch.tv/PreFlop_Table');
    expect(set.status).toBe(200);
    expect(set.body.stream).toEqual({ provider: 'twitch', id: 'preflop_table' });
    expect((await h.api('GET', `/v1/tables/${id}`)).body.stream).toEqual({ provider: 'twitch', id: 'preflop_table' });
    expect((await setStream(id, null)).body.stream).toBeNull();
    expect((await h.api('GET', `/v1/tables/${id}`)).body.stream).toBeNull();
    const audits = (await h.db.query(`select event from audit_log where event::jsonb->>'type' = 'table.stream_set' and event::jsonb->>'tableId' = $1`, [id])).rows;
    expect(audits).toHaveLength(2);
  });

  it('refuses links that are not a YouTube video or Twitch channel', async () => {
    const id = (await create({ name: 'Bad stream' })).body.id as string;
    for (const url of ['https://evil.example/live', 'http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)']) {
      expect((await setStream(id, url)).status).toBe(422);
    }
    expect((await create({ name: 'Bad at birth', stream_url: 'https://evil.example/x' })).status).toBe(422);
    expect((await h.api('GET', `/v1/tables/${id}`)).body.stream).toBeNull();
  });

  it('is PreFlop team only and only for manual tables', async () => {
    const id = (await create({ name: 'Guarded stream' })).body.id as string;
    const p = await h.register('Stream player');
    expect((await setStream(id, YT, p.token)).status).toBe(403);
    const sim = (await h.db.query<{ id: string }>(`select id from poker_tables where kind <> 'manual' limit 1`)).rows[0];
    if (sim) expect((await setStream(sim.id, YT)).status).toBe(409);
    expect((await setStream('no_such_table', YT)).status).toBe(404);
  });
});

describe('flop snapshot', () => {
  it('is stored with the settled flop when its SHA-256 matches', async () => {
    const id = await lockedTable('Snapshot table');
    const img = jpeg();
    const r = await h.api('POST', `/v1/admin/tables/${id}/manual/flop`, admin, { hand_no: 1, cards: ['Ah', 'Kd', '7c'], snapshot: snapshot(img) });
    expect(r.status).toBe(200);
    const row = (await h.db.query('select cards, sha256, image, taken_by from manual_flop_snapshots where round_id = $1', [`${id}:h1`])).rows[0];
    expect(row).toMatchObject({ cards: ['Ah', 'Kd', '7c'], sha256: sha(img), taken_by: 'user:u_admin' });
    expect((await h.db.query('select read_cards from manual_flop_snapshots where round_id = $1', [`${id}:h1`])).rows[0].read_cards).toEqual(['Ah', 'Kd', '7c']);
    expect(Buffer.compare(row.image, img)).toBe(0);
    // evidence is never changed afterwards
    await expect(h.db.query('delete from manual_flop_snapshots where round_id = $1', [`${id}:h1`])).rejects.toThrow(/append-only/);
  });

  it('keeps the cards the camera read when the operator corrected one', async () => {
    const id = await lockedTable('Corrected table');
    const r = await h.api('POST', `/v1/admin/tables/${id}/manual/flop`, admin, { hand_no: 1, cards: ['Ah', 'Kd', '7s'], snapshot: snapshot(jpeg(), undefined, ['Ah', 'Kd', '7c']) });
    expect(r.status).toBe(200);
    const row = (await h.db.query('select cards, read_cards from manual_flop_snapshots where round_id = $1', [`${id}:h1`])).rows[0];
    expect(row).toMatchObject({ cards: ['Ah', 'Kd', '7s'], read_cards: ['Ah', 'Kd', '7c'] });
  });

  it('settles without one (typed by hand) and stores nothing', async () => {
    const id = await lockedTable('Typed table');
    expect((await h.api('POST', `/v1/admin/tables/${id}/manual/flop`, admin, { hand_no: 1, cards: ['2c', '3c', '4c'] })).status).toBe(200);
    expect((await h.db.query('select 1 from manual_flop_snapshots where round_id = $1', [`${id}:h1`])).rowCount).toBe(0);
  });

  it('refuses a snapshot whose hash does not match, that is not a JPEG, or is too large, and the hand stays locked', async () => {
    const id = await lockedTable('Bad snapshot table');
    const img = jpeg();
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100)]);
    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600 * 1024, 1), Buffer.from([0xff, 0xd9])]);
    for (const s of [snapshot(img, sha(jpeg(9))), snapshot(png), snapshot(huge), { image_base64: 'not base64!', sha256: sha(img), read_cards: ['Ah', 'Kd', '7c'] }]) {
      const r = await h.api('POST', `/v1/admin/tables/${id}/manual/flop`, admin, { hand_no: 1, cards: ['Ah', 'Kd', '7c'], snapshot: s });
      expect(r.status).toBe(422);
    }
    // a malformed body (two read cards) is refused by the schema
    expect((await h.api('POST', `/v1/admin/tables/${id}/manual/flop`, admin, { hand_no: 1, cards: ['Ah', 'Kd', '7c'], snapshot: snapshot(img, undefined, ['Ah', 'Kd']) })).status).toBe(400);
    const round = (await h.db.query('select state from rounds where id = $1', [`${id}:h1`])).rows[0];
    expect(round.state).toBe('LOCKED');
  });
});
