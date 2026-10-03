import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type FlopCapture, type VerifyContext, captureAdmissionProblems, captureShapeProblems, sha256Hex, signCapture, verifyCapture, verifyCaptureAuthenticity,
} from '../src/evidence.ts';

/** External source audit F05: a capture without a valid timestamp must never pass the timing checks. */
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
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
const withTime = (v: unknown) => ({ ...capture, capturedAt: v }) as unknown as FlopCapture;

describe('capturedAt fails closed', () => {
  const bad: [string, unknown][] = [
    ['missing', undefined], ['null', null], ['string', '10000'], ['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY], ['negative', -1], ['fraction', 10_000.5], ['beyond Date range', 8.64e15 + 1], ['unsafe', 2 ** 60],
  ];
  it.each(bad)('%s → rejected by shape, admission and verifyCapture', (_l, v) => {
    const c = withTime(v);
    if (v === undefined) delete (c as { capturedAt?: unknown }).capturedAt;
    expect(captureShapeProblems({ capture: c, signature: 'x' }).join(' ')).toMatch(/capturedAt/);
    expect(captureAdmissionProblems(c, ctx).problems.join(' ')).toMatch(/capturedAt/);
    // signed by the genuine key: still never authentic, never settled
    const s = signCapture(c, privateKey);
    expect(verifyCaptureAuthenticity(s, ctx).authentic).toBe(false);
    expect(verifyCapture(s, ctx).decision).toBe('reject');
  });

  it('a well-formed capture still settles', () => {
    expect(captureShapeProblems(signCapture(capture, privateKey))).toEqual([]);
    expect(verifyCapture(signCapture(capture, privateKey), ctx).decision).toBe('settle');
  });

  it('invalid server timing fails closed too', () => {
    expect(captureAdmissionProblems(capture, { ...ctx, lockedAt: Number.NaN }).problems).toContain('server timing missing or invalid');
    expect(captureAdmissionProblems(capture, { ...ctx, dealStartAt: Number.NaN }).problems).toContain('server timing missing or invalid');
    expect(captureAdmissionProblems(capture, { ...ctx, maxCaptureDelayMs: Number.POSITIVE_INFINITY }).problems).toContain('server timing missing or invalid');
  });
});

describe('every field has its type', () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ['seq string', { seq: '8' }, /seq/], ['seq fraction', { seq: 8.5 }, /seq/], ['handNo zero', { handNo: 0 }, /handNo/],
    ['cards two', { cards: ['Kh', 'Kd'] }, /cards/], ['cards numbers', { cards: [1, 2, 3] }, /cards/], ['source', { source: 'manual' }, /source/],
    ['image hash', { imageSha256: 'ABC' }, /imageSha256/], ['deviceId', { deviceId: 7 }, /deviceId/], ['prevHash', { prevHash: '' }, /prevHash/],
    ['unknown field', { extra: true }, /unknown capture field extra/],
  ];
  it.each(cases)('%s', (_l, o, re) => {
    const c = { ...capture, ...o } as unknown as FlopCapture;
    expect(captureShapeProblems({ capture: c, signature: 'x' }).join(' ')).toMatch(re);
    expect(verifyCaptureAuthenticity(signCapture(c, privateKey), ctx).authentic).toBe(false);
  });
  it('non-object input', () => {
    for (const v of [null, 1, 'x', [], { capture: null, signature: 'x' }, { capture: capture }]) expect(captureShapeProblems(v).length).toBeGreaterThan(0);
  });
});
