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

/** What the server knows when a capture ARRIVES (authenticity is checked once, on receipt). */
export interface AuthenticityContext {
  readonly device: RegisteredDevice | undefined;
  readonly expectedTableId: string;
  readonly expectedRoundId: string;
  readonly expectedHandNo: number;
  /** The device checkpoint BEFORE this capture: the last authentic record's seq and hash. */
  readonly lastSeq: number;
  readonly lastHash: string;
}

/** Server-stamped hand timing, used for admission and content checks. */
export interface TimingContext {
  readonly lockedAt: number;
  /** Undefined while deal-start has not been recorded — a capture is never admitted before it. */
  readonly dealStartAt: number | undefined;
  /** Largest allowed gap between deal-start and capture (ms). */
  readonly maxCaptureDelayMs?: number;
  /** Allowed clock skew between Table Box and server (ms). */
  readonly maxSkewMs?: number;
}

/** What the server knows at RESOLUTION time (after the checkpoint has already advanced). */
export interface ContentContext extends TimingContext {
  /** Image bytes as uploaded, to check against the signed hash. Required: no image, no settlement. */
  readonly image: Uint8Array | undefined;
  /** Independent manual entries of the same flop. Both are required before settlement. */
  readonly dealerEntry: readonly string[] | undefined;
  readonly floorEntry: readonly string[] | undefined;
}

export type VerifyContext = AuthenticityContext & ContentContext;

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

/** Largest timestamp a JavaScript Date can hold (ms): beyond it a "time" is meaningless. */
export const MAX_TIMESTAMP_MS = 8.64e15;
const CAPTURE_KEYS = ['deviceId', 'tableId', 'roundId', 'handNo', 'cards', 'source', 'imageSha256', 'capturedAt', 'seq', 'prevHash'] as const;
const isTimestamp = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_TIMESTAMP_MS;
const isText = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/**
 * Structural check of a signed capture as it arrives (any JSON). Every field must be present with
 * its type — a missing, null, string, fractional or out-of-range number never reaches a
 * comparison where it could fail open (`undefined < x` is false). Unknown fields are refused too:
 * the canonical form signs every key, so nothing unchecked can ride along. Empty = well-formed.
 */
export function captureShapeProblems(s: unknown): string[] {
  if (!s || typeof s !== 'object') return ['signed capture must be an object'];
  const { capture: c, signature } = s as { capture?: unknown; signature?: unknown };
  const problems: string[] = [];
  if (!isText(signature, 500)) problems.push('signature must be a base64 string');
  if (!c || typeof c !== 'object' || Array.isArray(c)) return [...problems, 'capture must be an object'];
  const o = c as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(CAPTURE_KEYS as readonly string[]).includes(k)) problems.push(`unknown capture field ${k}`);
  for (const k of ['deviceId', 'tableId', 'roundId'] as const) if (!isText(o[k])) problems.push(`${k} must be a non-empty string`);
  if (!isText(o.prevHash)) problems.push('prevHash must be a non-empty string');
  if (!(typeof o.handNo === 'number' && Number.isSafeInteger(o.handNo) && o.handNo >= 1)) problems.push('handNo must be a positive integer');
  if (!(typeof o.seq === 'number' && Number.isSafeInteger(o.seq) && o.seq >= 1)) problems.push('seq must be a positive integer');
  if (!isTimestamp(o.capturedAt)) problems.push('capturedAt must be an integer timestamp in ms (0 … 8.64e15)');
  if (!(Array.isArray(o.cards) && o.cards.length === 3 && o.cards.every((x) => isText(x, 3)))) problems.push('cards must be three card strings');
  if (o.source !== 'vision' && o.source !== 'rfid') problems.push('source must be vision or rfid');
  if (!(typeof o.imageSha256 === 'string' && /^[0-9a-f]{64}$/.test(o.imageSha256))) problems.push('imageSha256 must be 64 lowercase hex characters');
  return problems;
}

/**
 * Stage 1 — on receipt. Is this record really from the registered Table Box, for this
 * round, and the next link in its chain? Run ONCE, against the checkpoint before the capture.
 * A structurally invalid record is never authentic (fail closed).
 */
export function verifyCaptureAuthenticity(s: SignedCapture, ctx: AuthenticityContext): { authentic: boolean; problems: string[] } {
  const shape = captureShapeProblems(s);
  if (shape.length) return { authentic: false, problems: shape };
  const c = s.capture;
  const problems: string[] = [];
  const d = ctx.device;
  if (!d) problems.push('unknown device');
  else {
    if (d.revoked) problems.push('device key revoked');
    if (d.deviceId !== c.deviceId) problems.push('device id mismatch');
    if (d.tableId !== c.tableId) problems.push('device is not bound to this table');
    let sigOk = false;
    try { sigOk = verify(null, Buffer.from(canonical(c)), d.publicKey, Buffer.from(s.signature, 'base64')); } catch { sigOk = false; }
    if (!sigOk) problems.push('invalid signature');
  }
  if (c.tableId !== ctx.expectedTableId || c.roundId !== ctx.expectedRoundId || c.handNo !== ctx.expectedHandNo) problems.push('capture is for a different table, round or hand');
  if (c.seq !== ctx.lastSeq + 1) problems.push(`sequence gap or replay (got ${c.seq}, expected ${ctx.lastSeq + 1})`);
  if (c.prevHash !== ctx.lastHash) problems.push('hash chain broken');
  return { authentic: problems.length === 0, problems };
}

/**
 * Admission — checks on the signed record itself that must pass BEFORE an authentic capture may
 * move the round to DEALT or open betting on the next hand: deal-start recorded, capture timed
 * after the lock and deal-start and within the deadline, and three valid, distinct cards.
 */
export function captureAdmissionProblems(c: FlopCapture, t: TimingContext): { problems: string[]; cards?: [Card, Card, Card] } {
  const problems: string[] = [];
  const skew = t.maxSkewMs ?? 2000;
  const delay = t.maxCaptureDelayMs ?? 180_000;
  // Fail closed: every comparison below is false for NaN/undefined, which would admit the capture.
  if (!isTimestamp(c.capturedAt)) problems.push('capturedAt missing or not a valid timestamp');
  else if (!isTimestamp(t.lockedAt) || (t.dealStartAt !== undefined && !isTimestamp(t.dealStartAt))
    || !Number.isSafeInteger(skew) || skew < 0 || !Number.isSafeInteger(delay) || delay < 0) problems.push('server timing missing or invalid');
  else if (t.dealStartAt === undefined) problems.push('deal-start not recorded');
  else {
    if (c.capturedAt + skew < t.dealStartAt || c.capturedAt + skew < t.lockedAt) problems.push('captured before the round locked / deal started');
    if (c.capturedAt > t.dealStartAt + delay + skew) problems.push('captured too long after deal-start');
  }
  let cards: Card[] | undefined;
  try {
    if (!Array.isArray(c.cards) || c.cards.length !== 3) throw new Error('count');
    cards = c.cards.map(parseCard);
    if (new Set(cards.map((x) => x.id)).size !== 3) problems.push('duplicate cards in capture');
  } catch {
    problems.push('unreadable cards in capture');
    cards = undefined;
  }
  return problems.length || !cards ? { problems } : { problems, cards: cards as [Card, Card, Card] };
}

/**
 * Stage 2 — at resolution. Content only: admission, image hash, 3-way match. It never
 * re-checks sequence or chain, because the device checkpoint has already moved past this record.
 */
export function verifyCaptureContent(c: FlopCapture, ctx: ContentContext): VerifyResult {
  const adm = captureAdmissionProblems(c, ctx);
  const reject = [...adm.problems];
  if (!ctx.image) reject.push('evidence image missing');
  else if (sha256Hex(ctx.image) !== c.imageSha256) reject.push('image does not match the signed hash');
  if (reject.length || !adm.cards) return { decision: 'reject', problems: reject };

  const review: string[] = [];
  if (!ctx.dealerEntry) review.push('dealer entry missing');
  else if (!sameCards(c.cards, ctx.dealerEntry)) review.push('camera reading differs from dealer entry');
  if (!ctx.floorEntry) review.push('floor entry missing');
  else if (!sameCards(c.cards, ctx.floorEntry)) review.push('camera reading differs from floor entry');
  if (review.length) return { decision: 'review', problems: review };
  return { decision: 'settle', problems: [], flop: flopFromCards(adm.cards) };
}

/** Both stages in one call, for standalone use (e.g. audits re-verifying an archived capture). */
export function verifyCapture(s: SignedCapture, ctx: VerifyContext): VerifyResult {
  const a = verifyCaptureAuthenticity(s, ctx);
  const content = verifyCaptureContent(s.capture, ctx);
  if (!a.authentic) return { decision: 'reject', problems: [...a.problems, ...(content.decision === 'reject' ? content.problems : [])] };
  return content;
}
