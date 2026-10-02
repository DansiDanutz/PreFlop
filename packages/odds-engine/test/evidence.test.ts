import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type FlopCapture, type VerifyContext, captureHash, sha256Hex, signCapture, verifyCapture } from '../src/evidence.ts';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const attacker = generateKeyPairSync('ed25519');
const image = new TextEncoder().encode('board-image-bytes');

const capture: FlopCapture = {
  deviceId: 'box-7', tableId: 't1', roundId: 'r42', handNo: 42, cards: ['Kh', 'Kd', '7h'], source: 'vision',
  imageSha256: sha256Hex(image), capturedAt: 10_000, seq: 8, prevHash: 'abc',
};
const ctx: VerifyContext = {
  device: { deviceId: 'box-7', tableId: 't1', publicKey, revoked: false },
  expectedTableId: 't1', expectedRoundId: 'r42', expectedHandNo: 42,
  lockedAt: 5_000, dealStartAt: 6_000, lastSeq: 7, lastHash: 'abc', image,
  dealerEntry: ['7h', 'Kd', 'Kh'], floorEntry: ['Kd', '7h', 'Kh'],
};

describe('signed flop evidence', () => {
  it('settles a genuine, confirmed capture', () => {
    const r = verifyCapture(signCapture(capture, privateKey), ctx);
    expect(r.decision).toBe('settle');
    expect(r.flop?.ranks).toEqual([7, 13, 13]);
  });

  it('rejects edited cards after signing', () => {
    const s = signCapture(capture, privateKey);
    const forged = { ...s, capture: { ...capture, cards: ['Ah', 'Ad', 'As'] as const } };
    expect(verifyCapture(forged, ctx).problems).toContain('invalid signature');
  });

  it('rejects a capture signed by any other key, or by a revoked device', () => {
    expect(verifyCapture(signCapture(capture, attacker.privateKey), ctx).decision).toBe('reject');
    expect(verifyCapture(signCapture(capture, privateKey), { ...ctx, device: { ...ctx.device!, revoked: true } }).problems).toContain('device key revoked');
  });

  it('rejects a swapped image', () => {
    const r = verifyCapture(signCapture(capture, privateKey), { ...ctx, image: new TextEncoder().encode('other') });
    expect(r.problems).toContain('image does not match the signed hash');
  });

  it('rejects replays, gaps and captures from before the lock', () => {
    expect(verifyCapture(signCapture({ ...capture, seq: 7 }, privateKey), ctx).decision).toBe('reject');
    expect(verifyCapture(signCapture({ ...capture, prevHash: 'zzz' }, privateKey), ctx).problems).toContain('hash chain broken');
    expect(verifyCapture(signCapture({ ...capture, capturedAt: 1_000 }, privateKey), ctx).decision).toBe('reject');
    expect(verifyCapture(signCapture({ ...capture, roundId: 'r41' }, privateKey), ctx).decision).toBe('reject');
  });

  it('sends disagreements with the dealer or floor to manual review, never to settlement', () => {
    const r = verifyCapture(signCapture(capture, privateKey), { ...ctx, dealerEntry: ['Kh', 'Kd', '8h'] });
    expect(r.decision).toBe('review');
    expect(r.flop).toBeUndefined();
  });

  it('chains records: the next capture must reference this one', () => {
    const next = { ...capture, seq: 9, prevHash: captureHash(capture), roundId: 'r43', handNo: 43 };
    const r = verifyCapture(signCapture(next, privateKey), { ...ctx, expectedRoundId: 'r43', expectedHandNo: 43, lastSeq: 8, lastHash: captureHash(capture) });
    expect(r.decision).toBe('settle');
  });
});
