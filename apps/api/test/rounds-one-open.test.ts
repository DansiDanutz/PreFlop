import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { EventBatch } from '../src/lib/events.ts';
import { ensureOpenRound } from '../src/rounds/service.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness } from './helpers.ts';

/**
 * At most one OPEN round per table (migration 002, rounds_one_open_per_table). The database
 * rejects a second one however it is inserted, and concurrent ensureOpenRound calls open one hand.
 */
const CONCURRENT_OPENERS = 8;

let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await harness('rounds_one_open');
  await tx(h.db, (c) => seedAdmin(c, 'one-open-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'one-open-admin@test.dev', password: 'admin-pass-1' })).body.token;
});
afterAll(async () => h?.close());

/** A manual table opens hand 1 as soon as it is created. */
async function tableWithOpenHand(name: string): Promise<string> {
  const r = await h.api('POST', '/v1/admin/tables/manual', admin, { name });
  expect(r.status).toBe(200);
  return r.body.id;
}
const openCount = async (tableId: string) =>
  (await h.db.query<{ n: number }>(`select count(*)::int as n from rounds where table_id = $1 and state = 'OPEN'`, [tableId])).rows[0]!.n;

describe('one OPEN round per table', () => {
  it('a second OPEN round insert for the same table fails with 23505', async () => {
    const id = await tableWithOpenHand('One open: insert');
    expect(await openCount(id)).toBe(1);
    // hand 2 has its own primary key, so only the partial unique index can reject it
    await expect(h.db.query(`insert into rounds (id, table_id, hand_no, mode, currency, state) values ($1, $2, 2, 'play', 'PLAY', 'OPEN')`, [`${id}:h2`, id]))
      .rejects.toMatchObject({ code: '23505', constraint: 'rounds_one_open_per_table' });
    expect(await openCount(id)).toBe(1);
  });

  it('concurrent ensureOpenRound calls open exactly one round', async () => {
    const id = await tableWithOpenHand('One open: race');
    await h.db.query(`update rounds set state = 'SETTLED', settled_at = now() where id = $1`, [`${id}:h1`]);
    const opened = await Promise.all(Array.from({ length: CONCURRENT_OPENERS }, () => tx(h.db, (c) => ensureOpenRound(c, id, new EventBatch()))));
    expect(opened.filter((r) => r !== null)).toEqual([`${id}:h2`]);
    expect(await openCount(id)).toBe(1);
  });
});
