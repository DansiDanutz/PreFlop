import { type KeyObject, createHash, sign, verify } from 'node:crypto';
import { type Card, parseCard } from './cards.ts';
import { type Flop, flopFromCards } from './flops.ts';

/**
 * Signed flop evidence — the flop capture is what settles every bet, so it is
 * treated like money (docs/12 §5).
 *
 * The PreFlop Table Box (a locked, PreFlop-owned device at each table) reads the
 * flop from the board camera, hashes the full-resolution image, and signs a
 * capture record with an Ed25519 key that never leaves its TPM. Records form a
 * hash chain per device, so a missing, replayed or reordered capture is detected.
 *
 * The server settles a round only when the record verifies AND the camera's
 * reading matches the dealer's (and, when present, the floor's) independent entry.
 */

export interface FlopCapture {
  readonly deviceId: string;
  readonly tableId: string;
  readonly roundId: string;
  readonly handNo: number;
  /** Cards read by the board camera (or board-only RFID), e.g. ["Kh","Kd","7h"]. */
  readonly cards: readonly [string, string, string];
  readonly source: 'vision' | 'rfid';
  /** SHA-256 (hex) of the full-resolution board image; the image is uploaded separately. */
  readonly imageSha256: string;
  /** Table Box clock (ms since epoch), NTP/PTP-disciplined. */
  readonly capturedAt: number;
  /** Per-device sequence number, +1 for every capture. */
  readonly seq: number;
  /** captureHash of this device's previous record ("genesis" for the first). */
  readonly prevHash: string;
}

export interface SignedCapture {
  readonly capture: FlopCapture;
  /** Ed25519 signature (base64) over the canonical capture. */
  readonly signature: string;
}

/** Deterministic serialisation: keys sorted, no whitespace. */
export function canonical(c: FlopCapture): string {
  const sortKeys = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sortKeys)
      : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
        : v;
  return JSON.stringify(sortKeys(c));
}

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

export const captureHash = (c: FlopCapture): string => sha256Hex(canonical(c));

/** Runs on the Table Box (in production the private key lives in the TPM). */
export function signCapture(c: FlopCapture, privateKey: KeyObject): SignedCapture {
  return { capture: c, signature: sign(null, Buffer.from(canonical(c)), privateKey).toString('base64') };
}

export interface RegisteredDevice {
  readonly deviceId: string;
  readonly tableId: string;
  readonly publicKey: KeyObject;
  readonly revoked: boolean;
}

export interface VerifyContext {
  readonly device: RegisteredDevice | undefined;
  readonly expectedTableId: string;
  readonly expectedRoundId: string;
  readonly expectedHandNo: number;
  /** Server-stamped times of the round's lock and deal-start. */
  readonly lockedAt: number;
  readonly dealStartAt: number;
  /** Last accepted record for this device (chain continuity). */
  readonly lastSeq: number;
  readonly lastHash: string;
  /** Image bytes as uploaded, to check against the signed hash. Required: no image, no settlement. */
  readonly image: Uint8Array | undefined;
  /** Independent manual entries of the same flop. Both are required before settlement. */
  readonly dealerEntry: readonly string[] | undefined;
  readonly floorEntry: readonly string[] | undefined;
  /** Largest allowed gap between deal-start and capture (ms). */
  readonly maxCaptureDelayMs?: number;
  /** Allowed clock skew between Table Box and server (ms). */
  readonly maxSkewMs?: number;
}

export interface VerifyResult {
  /** 'settle' = verified and confirmed; 'review' = authentic but readings disagree; 'reject' = not trustworthy. */
  readonly decision: 'settle' | 'review' | 'reject';
  readonly problems: readonly string[];
  readonly flop?: Flop;
}

const sameCards = (a: readonly string[], b: readonly string[]): boolean => {
  try {
    const norm = (x: readonly string[]) => x.map((t) => parseCard(t).id).sort((p, q) => p - q).join(',');
    return a.length === 3 && b.length === 3 && norm(a) === norm(b);
  } catch {
    return false;
  }
};

export function verifyCapture(s: SignedCapture, ctx: VerifyContext): VerifyResult {
  const c = s.capture;
  const reject: string[] = [];
  const d = ctx.device;
  if (!d) reject.push('unknown device');
  else {
    if (d.revoked) reject.push('device key revoked');
    if (d.deviceId !== c.deviceId) reject.push('device id mismatch');
    if (d.tableId !== c.tableId) reject.push('device is not bound to this table');
    let sigOk = false;
    try { sigOk = verify(null, Buffer.from(canonical(c)), d.publicKey, Buffer.from(s.signature, 'base64')); } catch { sigOk = false; }
    if (!sigOk) reject.push('invalid signature');
  }
  if (c.tableId !== ctx.expectedTableId || c.roundId !== ctx.expectedRoundId || c.handNo !== ctx.expectedHandNo) reject.push('capture is for a different table, round or hand');
  if (c.seq !== ctx.lastSeq + 1) reject.push(`sequence gap or replay (got ${c.seq}, expected ${ctx.lastSeq + 1})`);
  if (c.prevHash !== ctx.lastHash) reject.push('hash chain broken');
  const skew = ctx.maxSkewMs ?? 2000;
  if (c.capturedAt + skew < ctx.dealStartAt || c.capturedAt + skew < ctx.lockedAt) reject.push('captured before the round locked / deal started');
  if (c.capturedAt > ctx.dealStartAt + (ctx.maxCaptureDelayMs ?? 180_000) + skew) reject.push('captured too long after deal-start');
  if (!ctx.image) reject.push('evidence image missing');
  else if (sha256Hex(ctx.image) !== c.imageSha256) reject.push('image does not match the signed hash');
  let cards: Card[] = [];
  try {
    cards = c.cards.map(parseCard);
    if (new Set(cards.map((x) => x.id)).size !== 3) reject.push('duplicate cards in capture');
  } catch {
    reject.push('unreadable cards in capture');
  }
  if (reject.length) return { decision: 'reject', problems: reject };

  const review: string[] = [];
  if (!ctx.dealerEntry) review.push('dealer entry missing');
  else if (!sameCards(c.cards, ctx.dealerEntry)) review.push('camera reading differs from dealer entry');
  if (!ctx.floorEntry) review.push('floor entry missing');
  else if (!sameCards(c.cards, ctx.floorEntry)) review.push('camera reading differs from floor entry');
  if (review.length) return { decision: 'review', problems: review };
  return { decision: 'settle', problems: [], flop: flopFromCards(cards as [Card, Card, Card]) };
}
