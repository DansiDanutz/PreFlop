import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { type Db, type Tx, tx } from './db.ts';
import { badRequest, unprocessable } from './errors.ts';

export interface StoredResponse {
  status: number;
  body: unknown;
}

/**
 * Generic write idempotency (docs/13 §7): the response is stored in the SAME transaction as the
 * effect and returned verbatim on retry. The same key with a different request → 422.
 */
export async function idempotent(c: Tx, principal: string, key: string, method: string, path: string, raw: Uint8Array | string, fn: () => Promise<StoredResponse>): Promise<StoredResponse> {
  const prior = await findStored(c, principal, key, method, path, raw);
  if (prior) return prior;
  const reqHash = requestHash(method, path, raw);
  const res = await fn();
  await c.query(
    'insert into idempotency_responses (principal, idempotency_key, method, path, request_sha256, status, body) values ($1, $2, $3, $4, $5, $6, $7)',
    [principal, key, method, path, reqHash, res.status, JSON.stringify(res.body)]);
  return res;
}

/** The fingerprint of a request under an Idempotency-Key: method, path and the raw body. */
export const requestHash = (method: string, path: string, raw: Uint8Array | string) => createHash('sha256').update(`${method} ${path}\n`).update(raw).digest('hex');

/** The response stored for this (principal, key), or null; the same key with a different request → 422. */
export async function findStored(c: Tx, principal: string, key: string, method: string, path: string, raw: Uint8Array | string): Promise<StoredResponse | null> {
  const prior = (await c.query<{ request_sha256: string; status: number; body: string }>(
    'select request_sha256, status, body from idempotency_responses where principal = $1 and idempotency_key = $2', [principal, key])).rows[0];
  if (!prior) return null;
  if (prior.request_sha256 !== requestHash(method, path, raw)) throw unprocessable('idempotency_mismatch', 'this Idempotency-Key was used for a different request');
  return { status: prior.status, body: JSON.parse(prior.body) };
}

/** The Idempotency-Key header of a money write: 8–200 characters (as POST /v1/bets), else 400. */
export function requireIdempotencyKey(req: FastifyRequest): string {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 8 || key.length > 200) throw badRequest('Idempotency-Key header (8–200 chars) required');
  return key;
}

/**
 * A payment or ledger reference derived from (principal, key) instead of a fresh random id: a
 * retry that slips past the stored response still posts to the same ledger (kind, ref) and the
 * same payment id, which the database accepts only once.
 */
export const keyedRef = (prefix: string, principal: string, key: string): string =>
  `${prefix}_${createHash('sha256').update(`${principal}\u0000${key}`).digest('base64url').slice(0, 24)}`;

/**
 * A money-in/out write that happens at most once per (principal, Idempotency-Key): one transaction,
 * serialised on the key (two concurrent retries queue, the second finds the stored response), the
 * response stored with the effect. `fn` gets the deterministic reference to post under.
 */
export async function idempotentMoneyWrite(db: Db, principal: string, key: string, req: FastifyRequest, prefix: string,
  fn: (c: Tx, ref: string) => Promise<StoredResponse>): Promise<StoredResponse> {
  const ref = keyedRef(prefix, principal, key);
  return tx(db, async (c) => {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`money:${principal}:${key}`]);
    return idempotent(c, principal, key, req.method, req.url, req.rawBody ?? '', () => fn(c, ref));
  });
}
