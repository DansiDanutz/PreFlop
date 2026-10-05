import { lookup } from 'node:dns';
import { lookup as lookupAsync } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { type LookupFunction, isIP } from 'node:net';
import { unprocessable } from './errors.ts';

/**
 * Outbound URL guard for partner webhooks (SSRF). Only https (http when WEBHOOK_ALLOW_PRIVATE=true
 * for local development and tests), and every resolved address must be public: no loopback,
 * private, link-local, CGNAT, multicast or unspecified ranges, IPv4 or IPv6, including IPv4
 * embedded in IPv6 in any notation. Delivery resolves the host itself and connects only to an
 * address it has checked (no DNS rebinding between check and connect), and never follows redirects.
 */
export const allowPrivate = () => process.env.WEBHOOK_ALLOW_PRIVATE === 'true';

function privateV4Bytes(a: number, b: number): boolean {
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0) || a >= 224;
}

function privateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return privateV4Bytes(a, b);
}

/** Expands any valid IPv6 text (with `::`, a dotted IPv4 tail or a zone id) into 16 bytes. */
export function v6Bytes(ip: string): number[] | null {
  let x = ip.toLowerCase().replace(/%.*$/, '');
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(x);
  if (dotted) {
    const p = dotted[1]!.split('.').map(Number);
    if (p.some((n) => n > 255)) return null;
    x = x.slice(0, -dotted[1]!.length) + ((p[0]! << 8) | p[1]!).toString(16) + ':' + ((p[2]! << 8) | p[3]!).toString(16);
  }
  const halves = x.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.flatMap((g) => { const n = parseInt(g, 16); return [n >> 8, n & 0xff]; });
}

function privateV6(ip: string): boolean {
  const b = v6Bytes(ip);
  if (!b) return true; // unparseable: refuse
  const zero = (from: number, to: number) => b.slice(from, to).every((v) => v === 0);
  // Embedded IPv4: mapped ::ffff:0:0/96, compatible ::/96, NAT64 64:ff9b::/96, 6to4 2002::/16.
  if (zero(0, 10) && ((b[10] === 0xff && b[11] === 0xff) || (b[10] === 0 && b[11] === 0))) {
    if (zero(0, 16) || (zero(0, 15) && b[15] === 1)) return true; // :: and ::1
    return privateV4Bytes(b[12]!, b[13]!);
  }
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(4, 12)) return privateV4Bytes(b[12]!, b[13]!);
  if (b[0] === 0x20 && b[1] === 0x02) return privateV4Bytes(b[2]!, b[3]!);
  // IPv4-translated ::ffff:0:0:0:0/96 (RFC 2765) and the NAT64 local-use prefix 64:ff9b:1::/48.
  if (zero(0, 8) && b[8] === 0xff && b[9] === 0xff) return privateV4Bytes(b[12]!, b[13]!);
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b[4] === 0x00 && b[5] === 0x01) return true;
  // Teredo 2001::/32 (tunnels to arbitrary hosts), benchmark 2001:2::/48, ORCHID 2001:10::/28,
  // documentation 2001:db8::/32 and the discard prefix 100::/64 are never public destinations.
  if (b[0] === 0x20 && b[1] === 0x01 && ((b[2] === 0x00 && (b[3] === 0x00 || b[3] === 0x02 || (b[3]! & 0xf0) === 0x10)) || (b[2] === 0x0d && b[3] === 0xb8))) return true;
  if (b[0] === 0x01 && b[1] === 0x00 && zero(2, 8)) return true;
  // Unique local fc00::/7, link-local fe80::/10, site-local fec0::/10, multicast ff00::/8.
  return (b[0]! & 0xfe) === 0xfc || (b[0] === 0xfe && (b[1]! & 0x80) === 0x80) || b[0] === 0xff;
}

/** DNS lookups for the URL check have their own deadline: a stalling resolver must not hold a request or the sender. */
export const DNS_TIMEOUT_MS = 5000;
export function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    t.unref?.();
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export const isPrivateAddress = (ip: string) => (isIP(ip) === 6 ? privateV6(ip) : isIP(ip) === 4 ? privateV4(ip) : true);

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw unprocessable('invalid_url', 'not a valid URL'); }
  if (u.protocol !== 'https:' && !(allowPrivate() && u.protocol === 'http:')) throw unprocessable('invalid_url', 'webhooks must use https');
  if (u.username || u.password) throw unprocessable('invalid_url', 'credentials in URLs are not allowed');
  if (allowPrivate()) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await withDeadline(lookupAsync(host, { all: true }), DNS_TIMEOUT_MS, 'DNS lookup').catch(() => []);
  if (!addrs.length) throw unprocessable('invalid_url', 'host does not resolve');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw unprocessable('invalid_url', 'webhook destinations must be public internet addresses');
  return u;
}

/**
 * DNS lookup for outbound webhook sockets: resolves every address, refuses the connection if
 * any is private, and hands the socket only checked addresses. The TLS hostname check still uses
 * the URL's host name.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as { address: string; family: number }[];
    if (!list.length) return callback(Object.assign(new Error(`${hostname} does not resolve`), { code: 'ENOTFOUND' }), '', 0);
    if (!allowPrivate() && list.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error('webhook destination resolved to a private address'), { code: 'EPRIVATE' }), '', 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
};

/**
 * POSTs a webhook body: checked URL, pinned resolution, no redirects. Returns the HTTP status.
 * `timeoutMs` is a deadline for the whole attempt (DNS, connect, TLS, headers), not only an idle
 * socket: a destination that accepts the connection and then trickles bytes cannot hold the sender.
 */
export async function postWebhook(raw: string, headers: Record<string, string>, body: string, timeoutMs = 5000): Promise<number> {
  const started = Date.now();
  const u = await withDeadline(assertPublicUrl(raw), timeoutMs, 'URL check');
  // The request gets what is left of the budget, not a fresh one: a slow URL check and a slow
  // destination together still end within timeoutMs.
  const remaining = timeoutMs - (Date.now() - started);
  if (remaining <= 0) throw new Error('timeout');
  const send = u.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<number>((resolve, reject) => {
    const req = send(u, { method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(body) }, lookup: guardedLookup, timeout: remaining }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    const deadline = setTimeout(() => req.destroy(new Error('timeout')), remaining);
    deadline.unref?.();
    req.on('close', () => clearTimeout(deadline));
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
