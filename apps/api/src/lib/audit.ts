import { sha256Hex } from '@preflop/odds-engine';
import type { Db, Tx } from './db.ts';

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
      : v;

/**
 * Appends one event to the hash-chained audit log (docs/13 §3). The audit_head row lock
 * serialises writers, so two transactions can never commit events with the same predecessor.
 * The hash is computed in SQL exactly as the spec defines it.
 */
export async function audit(c: Tx, event: Record<string, unknown>): Promise<void> {
  const text = JSON.stringify(sortKeys(event));
  const head = (await c.query<{ hash: string }>('select hash from audit_head where id = 1 for update')).rows[0]!;
  const ins = (await c.query<{ seq: number; hash: string }>(
    `insert into audit_log (prev_hash, hash, event) values ($1, encode(sha256(convert_to($1 || $2, 'UTF8')), 'hex'), $2)
     returning seq, hash`, [head.hash, text])).rows[0]!;
  await c.query('update audit_head set seq = $1, hash = $2 where id = 1', [ins.seq, ins.hash]);
}

/** Re-verifies the whole chain from genesis. Returns the first broken seq, or null. */
export async function verifyAuditChain(db: Db | Tx): Promise<{ ok: boolean; brokenAt: number | null; count: number }> {
  const rows = (await db.query<{ seq: number; prev_hash: string; hash: string; event: string }>('select seq, prev_hash, hash, event from audit_log order by seq')).rows;
  let prev = 'genesis';
  let last = 0;
  for (const r of rows) {
    if (r.prev_hash !== prev || sha256Hex(prev + r.event) !== r.hash) return { ok: false, brokenAt: r.seq, count: rows.length };
    prev = r.hash;
    last = r.seq;
  }
  // A truncated tail would leave a valid prefix: the chain must end exactly at the stored head.
  const head = (await db.query<{ seq: number; hash: string }>('select seq, hash from audit_head where id = 1')).rows[0];
  if (!head || head.hash !== prev || Number(head.seq) !== Number(last)) return { ok: false, brokenAt: last + 1, count: rows.length };
  return { ok: true, brokenAt: null, count: rows.length };
}
