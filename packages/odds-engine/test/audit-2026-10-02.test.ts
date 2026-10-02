import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DECK, isRed } from '../src/cards.ts';
import {
  type FlopCapture, captureAdmissionProblems, sha256Hex, signCapture, verifyCaptureAuthenticity, verifyCaptureContent,
} from '../src/evidence.ts';
import { RoundExposure } from '../src/exposure.ts';
import { allocateLargestRemainder, poolBreakdown, settleParimutuel } from '../src/fees.ts';
import { flopFromCards } from '../src/flops.ts';
import { GLOBAL_RULES } from '../src/globalRules.ts';
import { betPostings, validateOrganizerHouse } from '../src/houses.ts';
import { getSelection } from '../src/markets.ts';
import { payoutMinor } from '../src/pricing.ts';
import { statsFor } from '../src/probability.ts';
import { CUT_DEPTH } from '../src/tableReadiness.ts';
import { CLUB_POLICY, computeStatement } from '../src/sharing.ts';

/** Regression tests for the external audit of 2026-10-02 (findings F01–F11). */

describe('F01 — the random cut alone does NOT protect against a stacked deck (documented threat)', () => {
  it('a deck stacked by a compromised shuffler wins "all red" for every allowed cut', () => {
    // 9 seats: 18 hole cards + 1 burn are dealt before the flop, so after a cut at depth c the
    // flop is original positions (c+19 … c+21) mod 52. Over cuts 15–37 that covers 25 positions.
    const flopPositions = new Set<number>();
    for (let c = CUT_DEPTH.min; c <= CUT_DEPTH.max; c++) for (let k = 19; k <= 21; k++) flopPositions.add((c + k) % 52);
    expect(flopPositions.size).toBe(25);

    // 25 of the 26 red cards go into those positions; the other 27 cards fill the rest.
    const reds = DECK.filter(isRed);
    const rest = [...reds.slice(25), ...DECK.filter((c) => !isRed(c))];
    const deck = Array.from({ length: 52 }, (_, i) => (flopPositions.has(i) ? reds.shift()! : rest.shift()!));
    expect(new Set(deck.map((c) => c.id)).size).toBe(52);

    const allRed = getSelection('colour:all-red');
    for (let c = CUT_DEPTH.min; c <= CUT_DEPTH.max; c++) {
      const cutDeck = [...deck.slice(c), ...deck.slice(0, c)];
      expect(allRed.wins(flopFromCards([cutDeck[19]!, cutDeck[20]!, cutDeck[21]!]))).toBe(true);
    }
    // Hence docs/12 no longer claims the cut defeats a compromised shuffler; physical
    // randomisation must be independently trusted (docs/12 §1, §6).
  });
});

describe('F07 — money helpers reject invalid values instead of losing precision', () => {
  it('payoutMinor rejects negative or fractional odds and unsafe results', () => {
    expect(() => payoutMinor(100, -100)).toThrow(RangeError);
    expect(() => payoutMinor(100, 99)).toThrow(RangeError);
    expect(() => payoutMinor(100, 250.5)).toThrow(RangeError);
    expect(() => payoutMinor(Number.MAX_SAFE_INTEGER, 36100)).toThrow(RangeError);
    expect(payoutMinor(1000, 238)).toBe(2380);
  });

  it('RoundExposure refuses negative odds, zero stakes and unsafe totals', () => {
    const pair = statsFor(getSelection('rank-pattern:pair'));
    expect(() => new RoundExposure(0).tryAdd(pair, 100, -100)).toThrow(RangeError);
    expect(() => new RoundExposure(1000).tryAdd(pair, 0, 200)).toThrow(RangeError);
    const big = new RoundExposure(Number.MAX_SAFE_INTEGER);
    expect(() => big.tryAdd(pair, Number.MAX_SAFE_INTEGER - 1, 100)).toThrow(RangeError);
    expect(() => new RoundExposure(-1)).toThrow(RangeError);
  });

  it('pool fees cannot exceed the pool, and pools reject duplicate ids and bad stakes', () => {
    const roles = [{ role: 'preflop', party: 'PreFlop', bps: 10000 }];
    expect(() => poolBreakdown(100, 20000, roles)).toThrow(RangeError);
    expect(() => poolBreakdown(100, -1, roles)).toThrow(RangeError);
    expect(poolBreakdown(100, 10000, roles).netPrizePoolMinor).toBe(0);
    expect(() => settleParimutuel([{ betId: 'a', selectionId: 'x', stakeMinor: 1 }, { betId: 'a', selectionId: 'x', stakeMinor: 1 }], new Set(['x']), 1000)).toThrow(/duplicate/);
    expect(() => settleParimutuel([{ betId: 'a', selectionId: 'x', stakeMinor: -5 }], new Set(['x']), 1000)).toThrow(RangeError);
    expect(() => allocateLargestRemainder(10, new Map([['a', -1], ['b', 2]]))).toThrow(RangeError);
    expect(() => allocateLargestRemainder(10, new Map([['a', 0.5]]))).toThrow(RangeError);
  });
});

describe('F08 — organizer houses must name their organizer', () => {
  const base = { mode: 'real-fiat' as const, currency: 'EUR', playerId: 'u1', stakeMinor: 100, oddsCenti: 200, won: false };
  it('rejects a missing or empty organizer id at runtime', () => {
    expect(() => betPostings({ ...base, house: 'organizer' } as never)).toThrow(/organizerId/);
    expect(() => betPostings({ ...base, house: 'organizer', organizerId: '' })).toThrow(/organizerId/);
    expect(() => betPostings({ ...base, house: 'organizer', organizerId: 'PreFlop' })).toThrow(/reserved/);
  });
  it('keeps different organizers in different accounts', () => {
    const a = betPostings({ ...base, house: 'organizer', organizerId: 'roomA' });
    const b = betPostings({ ...base, house: 'organizer', organizerId: 'roomB' });
    expect(a[0]!.to).not.toBe(b[0]!.to);
  });
});

describe('F09 — duplicate share parties are rejected, never silently overwritten', () => {
  it('two entries for the same party throw', () => {
    expect(() => computeStatement({ revenueMinor: 10_000, turnoverMinor: 100_000, parties: [
      { party: 'Club', policy: CLUB_POLICY, metrics: {} }, { party: 'Club', policy: CLUB_POLICY, metrics: {} },
    ] })).toThrow(/duplicate party/);
  });
  it("'PreFlop' cannot be used as an external party", () => {
    expect(() => computeStatement({ revenueMinor: 10_000, turnoverMinor: 100_000, parties: [{ party: 'PreFlop', policy: CLUB_POLICY, metrics: {} }] })).toThrow(/reserved/);
  });
});

describe('F10 — organizer economics are validated at the minimum stake', () => {
  const cfg = { mode: 'real-fiat' as const, marginBps: 600, platformFee: GLOBAL_RULES.platformFee, providerShareBps: 1000 };
  it('passes at a typical stake but fails when the minimum stake is too small for the minimum fee', () => {
    expect(validateOrganizerHouse({ ...cfg, minStakeMinor: 600 }).ok).toBe(true);
    const tiny = validateOrganizerHouse({ ...cfg, minStakeMinor: 2, typicalStakeMinor: 600 });
    expect(tiny.ok).toBe(false);
    expect(tiny.organizerEv).toBeLessThan(0);
    expect(tiny.typicalEv).toBeCloseTo(0.039, 10);
  });
});

describe('F11 — authenticity once on receipt, content at resolution', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const image = new TextEncoder().encode('board');
  const cap: FlopCapture = { deviceId: 'box', tableId: 't', roundId: 'r', handNo: 1, cards: ['Kh', 'Kd', '7h'], source: 'vision',
    imageSha256: sha256Hex(image), capturedAt: 10_000, seq: 8, prevHash: 'h7' };
  const device = { deviceId: 'box', tableId: 't', publicKey, revoked: false };
  const signed = signCapture(cap, privateKey);

  it('an authentic capture still settles after the checkpoint has advanced past it', () => {
    expect(verifyCaptureAuthenticity(signed, { device, expectedTableId: 't', expectedRoundId: 'r', expectedHandNo: 1, lastSeq: 7, lastHash: 'h7' }).authentic).toBe(true);
    // checkpoint now at seq 8 — content verification does not look at seq/chain
    const r = verifyCaptureContent(cap, { lockedAt: 5_000, dealStartAt: 6_000, image, dealerEntry: ['7h', 'Kh', 'Kd'], floorEntry: ['Kd', 'Kh', '7h'] });
    expect(r.decision).toBe('settle');
  });

  it('admission refuses a premature or malformed authentic capture before it can open the next hand', () => {
    expect(captureAdmissionProblems(cap, { lockedAt: 5_000, dealStartAt: undefined }).problems).toContain('deal-start not recorded');
    expect(captureAdmissionProblems({ ...cap, capturedAt: 1_000 }, { lockedAt: 5_000, dealStartAt: 6_000 }).problems).toContain('captured before the round locked / deal started');
    expect(captureAdmissionProblems({ ...cap, cards: ['Kh', 'Kh', '7h'] as never }, { lockedAt: 5_000, dealStartAt: 6_000 }).problems).toContain('duplicate cards in capture');
    expect(captureAdmissionProblems(cap, { lockedAt: 5_000, dealStartAt: 6_000 }).problems).toEqual([]);
  });
});
