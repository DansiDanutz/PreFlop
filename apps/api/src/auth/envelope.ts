import { type KeyObject, createHash, createPublicKey, randomBytes, sign, verify } from 'node:crypto';
import type { Db } from '../lib/db.ts';
import { forbidden, unauthorized } from '../lib/errors.ts';

/**
 * Signed request envelope for devices and staff (docs/13 §7).
 *
 *   X-PreFlop-Auth: cred=<credential id>, ts=<unix ms>, nonce=<base64url>, sig=<base64 Ed25519>
 *
 * The signature covers the method, the exact path, the sorted query, the timestamp, the
 * single-use nonce, the Idempotency-Key and the SHA-256 of the raw body.
 */
export const SIG_VERSION = 'PREFLOP-SIG-1';
export const MAX_SKEW_MS = 30_000;

export function canonicalQuery(query: string): string {
  if (!query) return '';
  const params = new URLSearchParams(query);
  return [...params.entries()]
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export function signingString(p: { method: string; path: string; query: string; ts: number; nonce: string; idempotencyKey?: string | undefined; body: Uint8Array | string }): string {
  const bodyHash = createHash('sha256').update(p.body).digest('hex');
  return [SIG_VERSION, p.method.toUpperCase(), p.path, canonicalQuery(p.query), String(p.ts), p.nonce, p.idempotencyKey ?? '-', bodyHash].join('\n');
}

/** Client side (Table Box, staff tablet, simulator): builds the X-PreFlop-Auth header. */
export function signRequest(credentialId: string, privateKey: KeyObject, p: { method: string; url: string; idempotencyKey?: string; body?: Uint8Array | string; ts?: number }): string {
  const u = new URL(p.url, 'http://x');
  const ts = p.ts ?? Date.now();
  const nonce = randomBytes(16).toString('base64url');
  const s = signingString({ method: p.method, path: u.pathname, query: u.search.slice(1), ts, nonce, idempotencyKey: p.idempotencyKey, body: p.body ?? '' });
  const sig = sign(null, Buffer.from(s), privateKey).toString('base64');
  return `cred=${credentialId}, ts=${ts}, nonce=${nonce}, sig=${sig}`;
}

export type Principal =
  | { kind: 'device'; id: string; tableId: string; shufflerKeyPem: string | null }
  | { kind: 'staff'; id: string; tableId: string; personId: string; role: 'dealer' | 'floor' | 'floor_manager' };

function parseHeader(h: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of h.split(',')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const keyCache = new Map<string, KeyObject>();
const pubKey = (pem: string): KeyObject => {
  let k = keyCache.get(pem);
  if (!k) { k = createPublicKey(pem); keyCache.set(pem, k); }
  return k;
};

/**
 * Server side, in the spec's order: credential exists and is not revoked → |now − ts| ≤ 30 s →
 * signature verifies → the nonce has never been used (insert into request_nonces).
 */
export async function verifySignedRequest(db: Db, r: { method: string; url: string; header: string | undefined; idempotencyKey?: string | undefined; rawBody: Uint8Array | string; now?: number }): Promise<Principal> {
  if (!r.header) throw unauthorized('unsigned_request', 'X-PreFlop-Auth header required');
  const h = parseHeader(r.header);
  const cred = h.cred, nonce = h.nonce, sig = h.sig, ts = Number(h.ts);
  if (!cred || !nonce || !sig || !Number.isFinite(ts)) throw unauthorized('bad_signature', 'malformed X-PreFlop-Auth header');

  let principal: Principal | undefined;
  let pem: string | undefined;
  const dev = (await db.query<{ id: string; table_id: string; public_key_pem: string; revoked: boolean; shuffler_public_key_pem: string | null }>(
    'select id, table_id, public_key_pem, revoked, shuffler_public_key_pem from devices where id = $1', [cred])).rows[0];
  if (dev) {
    if (dev.revoked) throw unauthorized('credential_revoked');
    principal = { kind: 'device', id: dev.id, tableId: dev.table_id, shufflerKeyPem: dev.shuffler_public_key_pem };
    pem = dev.public_key_pem;
  } else {
    const st = (await db.query<{ id: string; table_id: string; person_id: string; role: 'dealer' | 'floor' | 'floor_manager'; public_key_pem: string; revoked: boolean }>(
      'select id, table_id, person_id, role, public_key_pem, revoked from staff_credentials where id = $1', [cred])).rows[0];
    if (!st) throw unauthorized('unknown_credential');
    if (st.revoked) throw unauthorized('credential_revoked');
    principal = { kind: 'staff', id: st.id, tableId: st.table_id, personId: st.person_id, role: st.role };
    pem = st.public_key_pem;
  }

  const now = r.now ?? Date.now();
  if (Math.abs(now - ts) > MAX_SKEW_MS) throw unauthorized('stale_request', 'timestamp outside the 30 s window');

  const u = new URL(r.url, 'http://x');
  const s = signingString({ method: r.method, path: u.pathname, query: u.search.slice(1), ts, nonce, idempotencyKey: r.idempotencyKey, body: r.rawBody });
  let ok = false;
  try { ok = verify(null, Buffer.from(s), pubKey(pem), Buffer.from(sig, 'base64')); } catch { ok = false; }
  if (!ok) throw unauthorized('bad_signature', 'signature does not verify');

  const ins = await db.query('insert into request_nonces (credential_id, nonce) values ($1, $2) on conflict do nothing', [cred, nonce]);
  if (ins.rowCount !== 1) throw unauthorized('replayed_request', 'nonce already used');
  return principal;
}

/** The `:t` in the path must equal the credential's table (docs/13 §7). */
export function assertTableScope(p: Principal, tableId: string): void {
  if (p.tableId !== tableId) throw forbidden('forbidden_table', 'credential is scoped to another table');
}

export function requireDevice(p: Principal): Extract<Principal, { kind: 'device' }> {
  if (p.kind !== 'device') throw forbidden('forbidden_role', 'device credential required');
  return p;
}

export function requireStaff(p: Principal, ...roles: ('dealer' | 'floor' | 'floor_manager')[]): Extract<Principal, { kind: 'staff' }> {
  if (p.kind !== 'staff') throw forbidden('forbidden_role', 'staff credential required');
  if (roles.length && !roles.includes(p.role)) throw forbidden('forbidden_role', `role ${p.role} may not do this`);
  return p;
}
