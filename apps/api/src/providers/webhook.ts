import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../lib/errors.ts';

/**
 * Reference webhook authentication for adapters whose provider signs deliveries with an HMAC over
 * the raw body (most do, Stripe-style): header `<name>: t=<unix seconds>,v1=<hex hmac-sha256>` where
 * the signed text is `<t>.<raw body>`. The timestamp bounds replays. A provider with its own scheme
 * implements `webhook` directly; this helper is for the common case and for the contract tests.
 */
export interface HmacWebhookOptions {
  secret: string;
  /** Header carrying the signature (lower case). */
  header?: string;
  /** Accepted clock skew, seconds (default 300). */
  toleranceS?: number;
  now?: () => number;
}

export const badSignature = (why: string) => new ApiError(401, 'bad_signature', `webhook rejected: ${why}`);

export function signWebhook(secret: string, rawBody: Buffer | string, timestampS: number): string {
  const mac = createHmac('sha256', secret).update(`${timestampS}.`).update(rawBody).digest('hex');
  return `t=${timestampS},v1=${mac}`;
}

/** Verifies the signature header and returns the parsed JSON body. */
export function verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer, o: HmacWebhookOptions): unknown {
  const name = (o.header ?? 'x-preflop-signature').toLowerCase();
  const h = headers[name];
  if (typeof h !== 'string') throw badSignature(`missing ${name} header`);
  const parts = Object.fromEntries(h.split(',').map((kv) => kv.split('=', 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isSafeInteger(t) || t <= 0 || !/^[0-9a-f]{64}$/.test(parts.v1 ?? '')) throw badSignature('malformed signature');
  const now = (o.now ?? (() => Math.floor(Date.now() / 1000)))();
  if (Math.abs(now - t) > (o.toleranceS ?? 300)) throw badSignature('timestamp outside tolerance');
  const expected = createHmac('sha256', o.secret).update(`${t}.`).update(rawBody).digest();
  const given = Buffer.from(parts.v1!, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw badSignature('signature mismatch');
  try { return JSON.parse(rawBody.toString('utf8')); } catch { throw badSignature('body is not JSON'); }
}
