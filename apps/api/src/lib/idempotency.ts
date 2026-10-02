import { createHash } from 'node:crypto';
import type { Tx } from './db.ts';
import { unprocessable } from './errors.ts';

export interface StoredResponse {
  status: number;
  body: unknown;
}

/**
 * Generic write idempotency (docs/13 §7): the response is stored in the SAME transaction as the
 * effect and returned verbatim on retry. The same key with a different request → 422.
 */
export async function idempotent(c: Tx, principal: string, key: string, method: string, path: string, raw: Uint8Array | string, fn: () => Promise<StoredResponse>): Promise<StoredResponse> {
  const reqHash = createHash('sha256').update(`${method} ${path}\n`).update(raw).digest('hex');
  const prior = (await c.query<{ request_sha256: string; status: number; body: string }>(
    'select request_sha256, status, body from idempotency_responses where principal = $1 and idempotency_key = $2', [principal, key])).rows[0];
  if (prior) {
    if (prior.request_sha256 !== reqHash) throw unprocessable('idempotency_mismatch', 'this Idempotency-Key was used for a different request');
    return { status: prior.status, body: JSON.parse(prior.body) };
  }
  const res = await fn();
  await c.query(
    'insert into idempotency_responses (principal, idempotency_key, method, path, request_sha256, status, body) values ($1, $2, $3, $4, $5, $6, $7)',
    [principal, key, method, path, reqHash, res.status, JSON.stringify(res.body)]);
  return res;
}
