/**
 * Browser side of the signed request envelope (docs/13 §7). Must produce the exact bytes that
 * apps/api/src/auth/envelope.ts `signingString()` verifies:
 *
 *   PREFLOP-SIG-1\n<METHOD>\n<path>\n<canonical query>\n<ts>\n<nonce>\n<Idempotency-Key or "-">\n<hex SHA-256 of raw body>
 *
 * Uses only WebCrypto (globalThis.crypto), so it runs unchanged in the browser and in Node tests.
 */
export const SIG_VERSION = 'PREFLOP-SIG-1';

const enc = new TextEncoder();

/** Keys sorted (then values), each percent-encoded with encodeURIComponent, joined by &. */
export function canonicalQuery(query: string): string {
  if (!query) return '';
  const params = new URLSearchParams(query);
  return [...params.entries()]
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export const toBytes = (body: Uint8Array | string): Uint8Array => (typeof body === 'string' ? enc.encode(body) : body);

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = toBytes(data);
  return hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

export interface SigningInput {
  method: string;
  path: string;
  query: string;
  ts: number;
  nonce: string;
  idempotencyKey?: string | undefined;
  body: Uint8Array | string;
}

export async function signingString(p: SigningInput): Promise<string> {
  const bodyHash = await sha256Hex(p.body);
  return [SIG_VERSION, p.method.toUpperCase(), p.path, canonicalQuery(p.query), String(p.ts), p.nonce, p.idempotencyKey ?? '-', bodyHash].join('\n');
}

export function base64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export const base64url = (bytes: Uint8Array) => base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 128-bit single-use nonce, base64url without padding. */
export function newNonce(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** A fresh Idempotency-Key for one user action (reused verbatim on every retry of that action). */
export function newIdempotencyKey(): string {
  return `tab-${Date.now().toString(36)}-${base64url(crypto.getRandomValues(new Uint8Array(12)))}`;
}

/**
 * Signs one request and returns the X-PreFlop-Auth header value. `url` may be absolute or
 * relative; the path and query are taken from it exactly as the browser will send them.
 */
export async function authHeader(credentialId: string, privateKey: CryptoKey, p: {
  method: string; url: string; idempotencyKey?: string | undefined; body?: string; ts?: number; nonce?: string;
}): Promise<{ header: string; signed: string }> {
  const u = new URL(p.url, 'http://x');
  const ts = p.ts ?? Date.now();
  const nonce = p.nonce ?? newNonce();
  const signed = await signingString({ method: p.method, path: u.pathname, query: u.search.slice(1), ts, nonce, idempotencyKey: p.idempotencyKey, body: p.body ?? '' });
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, enc.encode(signed)));
  return { header: `cred=${credentialId}, ts=${ts}, nonce=${nonce}, sig=${base64(sig)}`, signed };
}

// ------------------------------------------------------------------ keys

/** Ed25519 key pair whose private half can never be exported (extractable: false). */
export async function generateCredentialKey(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
}

/** Public key only: SPKI DER → PEM "-----BEGIN PUBLIC KEY-----". */
export async function publicKeyPem(publicKey: CryptoKey): Promise<string> {
  const der = new Uint8Array(await crypto.subtle.exportKey('spki', publicKey));
  const b64 = base64(der);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}

/** First 16 hex chars of SHA-256 over the SPKI bytes, grouped for reading aloud. */
export async function publicKeyFingerprint(publicKey: CryptoKey): Promise<string> {
  const der = new Uint8Array(await crypto.subtle.exportKey('spki', publicKey));
  return (await sha256Hex(der)).slice(0, 16);
}

export const groupFingerprint = (fp: string) => fp.match(/.{1,4}/g)?.join(' ') ?? fp;
