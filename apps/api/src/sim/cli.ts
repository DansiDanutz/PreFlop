import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { migrate } from '@preflop/db';
import { createPool, tx } from '../lib/db.ts';
import { seedAdmin, seedSimTable, upsertClub } from '../seed.ts';
import { SimTable, fetchSend, keysToFile, type SimKeysFile } from './tableSim.ts';

/**
 * Runs simulated tables against a live API: `pnpm --filter @preflop/api sim`.
 * Seeds demo clubs and tables on first run (keys kept in .data/sim-keys.json), then deals a
 * hand on every table every BETTING_WINDOW_MS (default 20 s, the sandbox cadence in docs/02 §5).
 */
const API = process.env.API_URL ?? 'http://localhost:4000';
const DB = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/preflop';
const WINDOW = Number(process.env.BETTING_WINDOW_MS ?? 20_000);
const KEYS = process.env.SIM_KEYS ?? '.data/sim-keys.json';

const TABLES = [
  { clubId: 'atlas', club: 'Atlas Poker Club', city: 'Bucharest', country: 'RO', tableId: 'atlas-04', name: 'Table 04' },
  { clubId: 'atlas', club: 'Atlas Poker Club', city: 'Bucharest', country: 'RO', tableId: 'atlas-07', name: 'Table 07' },
  { clubId: 'meridian', club: 'Meridian Poker Club', city: 'London', country: 'GB', tableId: 'meridian-02', name: 'Table 02' },
  { clubId: 'preflop-practice', club: 'PreFlop Practice', city: 'Online', country: '', tableId: 'green-room', name: 'The Green Room' },
  { clubId: 'preflop-practice', club: 'PreFlop Practice', city: 'Online', country: '', tableId: 'midnight-room', name: 'Midnight Room' },
];

async function seed(): Promise<SimKeysFile[]> {
  if (existsSync(KEYS)) return JSON.parse(readFileSync(KEYS, 'utf8'));
  const pool = createPool(DB, 4);
  await migrate(pool);
  const keys = await tx(pool, async (c) => {
    await seedAdmin(c, process.env.ADMIN_EMAIL ?? 'admin@preflop.local', process.env.ADMIN_PASSWORD ?? 'preflop-admin');
    const out: SimKeysFile[] = [];
    for (const t of TABLES) {
      await upsertClub(c, t.clubId, t.club, { city: t.city, country: t.country });
      out.push(keysToFile(await seedSimTable(c, { clubId: t.clubId, tableId: t.tableId, name: t.name })));
    }
    return out;
  });
  await pool.end();
  mkdirSync(KEYS.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(KEYS, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return keys;
}

const send = fetchSend(API);
const tables = (await seed()).map((k) => new SimTable(send, k));
for (const t of tables) await t.syncCheckpoint();
console.log(`simulating ${tables.length} tables against ${API}, a flop every ${WINDOW / 1000}s`);

async function loop(t: SimTable, offset: number) {
  await new Promise((r) => setTimeout(r, offset));
  for (;;) {
    try {
      await t.heartbeat();
      const n = await t.openHand();
      if (n !== null) {
        await new Promise((r) => setTimeout(r, WINDOW));
        await t.heartbeat();
        const out = await t.playHand(n);
        console.log(`${t.tableId} hand ${n}: ${out.cards.join(' ')} (cut ${out.cutDepth})`);
      } else await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.error(`${t.tableId}:`, (e as Error).message);
      await t.syncCheckpoint().catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
await Promise.all(tables.map((t, i) => loop(t, i * (WINDOW / tables.length))));
