import { createHash } from 'node:crypto';
import { z } from 'zod';
import { unprocessable } from '../lib/errors.ts';

/**
 * The webcam frame the console read a manual flop from (migration 032): a JPEG sent with its
 * SHA-256, which must match the bytes. Kept as evidence of what the staff member confirmed.
 */
export const SNAPSHOT_MAX_BYTES = 512 * 1024;
/** Base64 is 4/3 the size of the bytes; a little slack for padding. */
const BASE64_MAX_CHARS = Math.ceil(SNAPSHOT_MAX_BYTES / 3) * 4 + 4;

export const snapshotInput = z.object({
  image_base64: z.string().min(1).max(BASE64_MAX_CHARS * 2),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** The cards the camera read; the settled cards may differ when the operator corrected one. */
  read_cards: z.array(z.string().regex(/^(10|[2-9TJQKA])[shdc]$/)).length(3),
});
export type SnapshotInput = z.infer<typeof snapshotInput>;
export interface Snapshot { image: Buffer; sha256: string; readCards: string[] }

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const isJpeg = (b: Buffer) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b.at(-2) === 0xff && b.at(-1) === 0xd9;

/** Checks the frame is a JPEG of at most SNAPSHOT_MAX_BYTES whose SHA-256 is the one sent; 422 otherwise. */
export function verifySnapshot(s: SnapshotInput): Snapshot {
  if (s.image_base64.length > BASE64_MAX_CHARS) throw unprocessable('snapshot_too_large', `the flop snapshot is over ${SNAPSHOT_MAX_BYTES / 1024} KB`);
  if (!BASE64.test(s.image_base64)) throw unprocessable('invalid_snapshot', 'the flop snapshot is not base64');
  const image = Buffer.from(s.image_base64, 'base64');
  if (image.length > SNAPSHOT_MAX_BYTES) throw unprocessable('snapshot_too_large', `the flop snapshot is over ${SNAPSHOT_MAX_BYTES / 1024} KB`);
  if (!isJpeg(image)) throw unprocessable('invalid_snapshot', 'the flop snapshot is not a JPEG');
  if (createHash('sha256').update(image).digest('hex') !== s.sha256) throw unprocessable('snapshot_hash_mismatch', 'the flop snapshot does not match its SHA-256');
  return { image, sha256: s.sha256, readCards: s.read_cards };
}
