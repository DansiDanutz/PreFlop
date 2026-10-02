/**
 * E2E setup for the tablet app (never touches the 5 seeded simulator tables).
 *
 *   npx tsx --conditions=preflop-source apps/table/scripts/e2e-setup.ts <tablets.json> <out-keys.json>
 *
 * tablets.json: { dealer: { personId, pem }, floor: {…}, floor_manager: {…} } — the PUBLIC keys the
 * three browser tablets generated. Creates (or re-keys) the simulated table `tablet-e2e`, then
 * swaps the seeded staff keys for the tablets' keys, so only the browsers can sign as staff.
 * Writes the Table Box + Trusted Shuffler private keys (device role only) to out-keys.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPool, tx } from '../../api/src/lib/db.ts';
import { seedSimTable, upsertClub } from '../../api/src/seed.ts';
import { keysToFile } from '../../api/src/sim/tableSim.ts';

const TABLE = process.env.E2E_TABLE ?? 'tablet-e2e';
const [, , tabletsPath, outPath] = process.argv;
if (!tabletsPath || !outPath) throw new Error('usage: e2e-setup.ts <tablets.json> <out-keys.json>');
type Role = 'dealer' | 'floor' | 'floor_manager';
const tablets = JSON.parse(readFileSync(tabletsPath, 'utf8')) as Record<Role, { personId: string; pem: string }>;

const db = createPool(process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/preflop', 2);
try {
  const keys = await tx(db, async (c) => {
    await upsertClub(c, 'club-e2e', 'E2E Test Club');
    const k = await seedSimTable(c, { clubId: 'club-e2e', tableId: TABLE, name: 'Tablet E2E · Table 01' });
    // Leftovers from an earlier run: close them so the table starts clean (test table, no bets).
    await c.query(
      `update rounds set state = 'VOID', voided_at = clock_timestamp(), void_reason = 'e2e reset', voided_by = 'system:e2e'
        where table_id = $1 and state in ('OPEN','LOCKED','DEALT','REVIEW','EVIDENCE_REJECTED')`, [TABLE]);
    for (const role of ['dealer', 'floor', 'floor_manager'] as const) {
      const t = tablets[role];
      if (!t?.pem?.includes('BEGIN PUBLIC KEY')) throw new Error(`missing public key for ${role}`);
      // Free the person id if an earlier run gave it to another credential (unique table/person/role).
      await c.query('update staff_credentials set person_id = id where table_id = $1 and person_id = $2 and role = $3 and id <> $4', [TABLE, t.personId, role, k.staff[role].id]);
      await c.query('update staff_credentials set public_key_pem = $2, person_id = $3, revoked = false where id = $1', [k.staff[role].id, t.pem, t.personId]);
    }
    return k;
  });
  writeFileSync(outPath, JSON.stringify(keysToFile(keys), null, 2));
  console.log(JSON.stringify({ tableId: keys.tableId, deviceId: keys.deviceId, credentials: { dealer: keys.staff.dealer.id, floor: keys.staff.floor.id, floor_manager: keys.staff.floor_manager.id } }));
} finally {
  await db.end();
}
