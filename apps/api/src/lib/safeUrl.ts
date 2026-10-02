import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { unprocessable } from './errors.ts';

/**
 * Outbound URL guard for partner webhooks (SSRF). Only https (http when WEBHOOK_ALLOW_PRIVATE=true
 * for local development and tests), and every resolved address must be public: no loopback,
 * private, link-local, CGNAT, multicast or unspecified ranges, IPv4 or IPv6. Deliveries never
 * follow redirects, so a public host cannot bounce the request inward.
 */
export const allowPrivate = () => process.env.WEBHOOK_ALLOW_PRIVATE === 'true';

function privateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function privateV6(ip: string): boolean {
  const x = ip.toLowerCase();
  if (x === '::' || x === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
  if (mapped) return privateV4(mapped[1]!);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
}

export const isPrivateAddress = (ip: string) => (isIP(ip) === 6 ? privateV6(ip) : privateV4(ip));

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw unprocessable('invalid_url', 'not a valid URL'); }
  if (u.protocol !== 'https:' && !(allowPrivate() && u.protocol === 'http:')) throw unprocessable('invalid_url', 'webhooks must use https');
  if (u.username || u.password) throw unprocessable('invalid_url', 'credentials in URLs are not allowed');
  if (allowPrivate()) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw unprocessable('invalid_url', 'host does not resolve');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw unprocessable('invalid_url', 'webhook destinations must be public internet addresses');
  return u;
}
