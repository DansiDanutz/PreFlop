import { z } from 'zod';

/**
 * Bounds for caller-controlled JSON fields (application details, organization settings). The
 * global body limit stops multi-megabyte bodies; these stop a 32 KB body from being 16,000 nested
 * arrays or 5,000 keys that every later reader (the adviser scrub, the console) has to walk.
 */
export function jsonDepth(v: unknown, max: number, d = 1): number {
  if (d > max || v === null || typeof v !== 'object') return d;
  let m = d;
  for (const x of Object.values(v as object)) {
    m = Math.max(m, jsonDepth(x, max, d + 1));
    if (m > max) break;
  }
  return m;
}

export interface JsonBounds { maxChars: number; maxDepth: number; maxKeys?: number; maxString?: number }

/** A JSON object field bounded in serialized size, nesting, top-level key count and string length. */
export const BoundedRecord = (o: JsonBounds) => z.record(z.unknown())
  .refine((v) => JSON.stringify(v).length <= o.maxChars, { message: `at most ${o.maxChars} characters as JSON` })
  .refine((v) => jsonDepth(v, o.maxDepth) <= o.maxDepth, { message: `nested at most ${o.maxDepth} levels deep` })
  .refine((v) => o.maxKeys === undefined || Object.keys(v).length <= o.maxKeys, { message: `at most ${o.maxKeys} fields` })
  .refine((v) => o.maxString === undefined || Object.values(v).every((x) => typeof x !== 'string' || x.length <= o.maxString!), { message: `text values of at most ${o.maxString} characters` });

/** Minor-unit amounts travel as JSON numbers and land in bigint columns: positive and within the safe-integer range. */
export const PositiveMinor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
/** An ISO 4217 code or a platform currency (PLAY, CHIP, DIAMOND, USDT, USDC). */
export const CurrencyCode = z.string().min(3).max(8);
