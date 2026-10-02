import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// Server implementation, imported read-only: the browser must produce identical bytes.
import { canonicalQuery as serverCanonicalQuery, signingString as serverSigningString } from '../../api/src/auth/envelope.ts';
import {
  authHeader, canonicalQuery, generateCredentialKey, newIdempotencyKey, newNonce, publicKeyFingerprint, publicKeyPem, sha256Hex, signingString,
} from '../src/lib/envelope.ts';

const cases: { name: string; method: string; path: string; query: string; body: string | Uint8Array; idem?: string }[] = [
  { name: 'signed GET, no query, empty body', method: 'GET', path: '/v1/provider/tables/tablet-e2e/state', query: '', body: '' },
  { name: 'GET with unsorted query', method: 'get', path: '/v1/provider/tables/t1/state', query: 'z=1&a=2&m=x%20y&a=1', body: '' },
  { name: 'query needing percent-encoding', method: 'GET', path: '/v1/x', query: 'name=Ana%20%C3%96&k%2Bey=a%2Fb&emoji=%F0%9F%83%8F&plus=a+b', body: '' },
  { name: 'POST start with {}', method: 'POST', path: '/v1/provider/tables/tablet-e2e/hands/7/start', query: '', body: '{}', idem: 'tab-abc-123' },
  { name: 'POST flop body', method: 'POST', path: '/v1/provider/tables/tablet-e2e/hands/7/flop', query: '', body: JSON.stringify({ cards: ['Kh', 'Td', '7c'] }), idem: newIdempotencyKey() },
  { name: 'POST unicode body', method: 'POST', path: '/v1/provider/tables/t/pause', query: '', body: JSON.stringify({ reason: 'Pauză — dealer schimbat ♠♥ 🃏' }), idem: 'k-ü' },
  { name: 'review path with encoded round id', method: 'POST', path: '/v1/provider/rounds/tablet-e2e%3Ah3/review', query: '', body: '{"action":"void","reason":"misdeal"}', idem: 'k1' },
  { name: 'raw bytes body', method: 'PUT', path: '/v1/a', query: 'b=2&a=1', body: new Uint8Array([0, 1, 2, 250, 255]), idem: 'img' },
];

describe('browser signing string == server signingString()', () => {
  for (const c of cases) {
    it(c.name, async () => {
      const ts = 1_790_000_000_123;
      const nonce = newNonce();
      const p = { method: c.method, path: c.path, query: c.query, ts, nonce, idempotencyKey: c.idem, body: c.body };
      expect(await signingString(p)).toBe(serverSigningString(p));
      expect(canonicalQuery(c.query)).toBe(serverCanonicalQuery(c.query));
    });
  }

  it('authHeader signs the path and query exactly as a URL sends them', async () => {
    const kp = await generateCredentialKey();
    const body = JSON.stringify({ cards: ['As', '2d', 'Qc'] });
    const url = 'http://localhost:4000/v1/provider/tables/t%201/hands/3/flop?b=2&a=%C3%A9';
    const { header, signed } = await authHeader('cred-x', kp.privateKey, { method: 'POST', url, idempotencyKey: 'idem-1', body, ts: 1700000000000, nonce: 'n0nce' });
    const u = new URL(url);
    expect(signed).toBe(serverSigningString({ method: 'POST', path: u.pathname, query: u.search.slice(1), ts: 1700000000000, nonce: 'n0nce', idempotencyKey: 'idem-1', body }));
    expect(header).toMatch(/^cred=cred-x, ts=1700000000000, nonce=n0nce, sig=[A-Za-z0-9+/]+=*$/);
  });

  it('empty-body hash is SHA-256("")', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('nonce is 16 random bytes base64url without padding', () => {
    const n = newNonce();
    expect(n).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(n, 'base64url').length).toBe(16);
    expect(newNonce()).not.toBe(n);
  });
});

describe('WebCrypto Ed25519 key', () => {
  it('private key is not extractable; only the public key exports', async () => {
    const kp = await generateCredentialKey();
    expect(kp.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', kp.privateKey)).rejects.toThrow();
    const pem = await publicKeyPem(kp.publicKey);
    expect(pem.startsWith('-----BEGIN PUBLIC KEY-----\n')).toBe(true);
    expect(pem.trimEnd().endsWith('-----END PUBLIC KEY-----')).toBe(true);
    expect(createPublicKey(pem).asymmetricKeyType).toBe('ed25519');
  });

  it('fingerprint is the first 16 hex of SHA-256(spki)', async () => {
    const kp = await generateCredentialKey();
    const spki = createPublicKey(await publicKeyPem(kp.publicKey)).export({ type: 'spki', format: 'der' });
    const { createHash } = await import('node:crypto');
    expect(await publicKeyFingerprint(kp.publicKey)).toBe(createHash('sha256').update(spki).digest('hex').slice(0, 16));
  });

  it('a WebCrypto signature verifies with node:crypto verify(null, …) against the exported PEM', async () => {
    const kp = await generateCredentialKey();
    const pem = await publicKeyPem(kp.publicKey);
    const body = JSON.stringify({ cards: ['Kh', 'Td', '7c'], note: 'ünïcødé ♣' });
    const url = '/v1/provider/tables/tablet-e2e/hands/12/flop';
    const { header } = await authHeader('cred-1', kp.privateKey, { method: 'POST', url, idempotencyKey: 'idem-42', body });
    const h = Object.fromEntries(header.split(',').map((x) => { const i = x.indexOf('='); return [x.slice(0, i).trim(), x.slice(i + 1).trim()]; }));
    const s = serverSigningString({ method: 'POST', path: url, query: '', ts: Number(h.ts), nonce: h.nonce!, idempotencyKey: 'idem-42', body: Buffer.from(body) });
    expect(verify(null, Buffer.from(s), createPublicKey(pem), Buffer.from(h.sig!, 'base64'))).toBe(true);
    // Any change to the signed request breaks it.
    const tampered = serverSigningString({ method: 'POST', path: url.replace('/12/', '/13/'), query: '', ts: Number(h.ts), nonce: h.nonce!, idempotencyKey: 'idem-42', body });
    expect(verify(null, Buffer.from(tampered), createPublicKey(pem), Buffer.from(h.sig!, 'base64'))).toBe(false);
  });
});
