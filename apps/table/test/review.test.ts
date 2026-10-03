import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeState } from '../src/lib/state.ts';
import {
  REVIEW_SLA_MS, type TrackedReview, autoVoided, fmtRemaining, reviewAlert, reviewCountdown, reviewDeadlineMs, trackReviews,
} from '../src/lib/review.ts';
import type { Round } from '../src/lib/types.ts';

const T0 = Date.parse('2026-10-03T20:00:00.000Z');
const MIN = 60_000;
const round = (n: number, state: Round['state'], extra: Partial<Round> = {}): Round => ({
  id: `t:h${n}`, hand_no: n, state, step: 'dealing', cut_depth: null, locked_at: null, deal_start_at: null, flop: null, review_reasons: null,
  entries: [], has_dealer_entry: true, has_floor_entry: true, my_entry: null, ...extra,
});
const iso = (ms: number) => new Date(ms).toISOString();

describe('review deadline', () => {
  it('uses review_deadline when the server sends it', () => {
    expect(reviewDeadlineMs({ review_deadline: iso(T0 + 7 * MIN), review_started_at: iso(T0) })).toBe(T0 + 7 * MIN);
  });
  it('null review_deadline means no countdown, even with review_started_at', () => {
    expect(reviewDeadlineMs({ review_deadline: null, review_started_at: iso(T0) })).toBeNull();
  });
  it('falls back to review_started_at + 30 min only when the field is absent', () => {
    expect(reviewDeadlineMs({ review_started_at: iso(T0) })).toBe(T0 + REVIEW_SLA_MS);
    expect(REVIEW_SLA_MS).toBe(30 * MIN);
  });
  it('hides the countdown when neither field is there, or a date is unreadable', () => {
    expect(reviewDeadlineMs({})).toBeNull();
    expect(reviewDeadlineMs({ review_deadline: 'soon' })).toBeNull();
    expect(reviewDeadlineMs({ review_started_at: 'yesterday' })).toBeNull();
    expect(reviewCountdown(null, T0)).toBeNull();
  });
  it('keeps the fields through normalizeState', () => {
    const s = normalizeState({ table: {}, readiness: { ok: true, problems: [] }, rounds: [{ id: 'r', hand_no: 1, state: 'REVIEW', review_deadline: iso(T0) }] }, 'me');
    expect(reviewDeadlineMs(s.rounds[0]!)).toBe(T0);
  });
});

describe('review countdown', () => {
  it('counts down m:ss, rounding up', () => {
    expect(fmtRemaining(30 * MIN)).toBe('30:00');
    expect(fmtRemaining(61_000)).toBe('1:01');
    expect(fmtRemaining(500)).toBe('0:01');
    expect(fmtRemaining(0)).toBe('0:00');
    expect(fmtRemaining(-5_000)).toBe('0:00');
  });
  it('is calm, then warns under 2 minutes, then reports the deadline passed', () => {
    const d = T0 + 30 * MIN;
    expect(reviewCountdown(d, T0)).toEqual({ level: 'ok', remainingMs: 30 * MIN, label: '30:00' });
    expect(reviewCountdown(d, d - 2 * MIN)?.level).toBe('ok');
    expect(reviewCountdown(d, d - 2 * MIN + 1)?.level).toBe('warn');
    expect(reviewCountdown(d, d - 1_000)).toEqual({ level: 'warn', remainingMs: 1_000, label: '0:01' });
    expect(reviewCountdown(d, d)).toEqual({ level: 'expired', remainingMs: 0, label: '0:00' });
    expect(reviewCountdown(d, d + MIN)?.level).toBe('expired');
  });
});

describe('auto-voided rounds', () => {
  const t: TrackedReview = { id: 't:h4', hand_no: 4, deadline: T0 };
  it('reports a tracked review that turned VOID after its deadline', () => {
    expect(autoVoided([t], [round(4, 'VOID')], T0 + 1)).toEqual([t]);
  });
  it('reports one that left the latest-three list after its deadline', () => {
    expect(autoVoided([t], [round(7, 'OPEN')], T0 + 1)).toEqual([t]);
  });
  it('does not report a void or settle before the deadline (a person decided)', () => {
    expect(autoVoided([t], [round(4, 'VOID')], T0 - 1)).toEqual([]);
    expect(autoVoided([t], [round(4, 'SETTLED')], T0 + 1)).toEqual([]);
  });
  it('does not report a round still in REVIEW, or one without a deadline', () => {
    expect(autoVoided([t], [round(4, 'REVIEW')], T0 + 1)).toEqual([]);
    expect(autoVoided([{ ...t, deadline: null }], [round(4, 'VOID')], T0 + 1)).toEqual([]);
  });
  it('tracks REVIEW rounds poll by poll and reports each auto-void once', () => {
    const r = round(4, 'REVIEW', { review_deadline: iso(T0) });
    let x = trackReviews([], [r], T0 - MIN);
    expect(x).toEqual({ tracked: [{ id: 't:h4', hand_no: 4, deadline: T0 }], voided: [] });
    // Deadline passed, sweeper not run yet: still tracked, nothing reported.
    x = trackReviews(x.tracked, [r], T0 + 1_000);
    expect(x.voided).toEqual([]);
    // The server now says VOID and review_deadline null; the remembered deadline is used.
    x = trackReviews(x.tracked, [round(4, 'VOID', { review_deadline: null })], T0 + 5_000);
    expect(x.voided.map((v) => v.hand_no)).toEqual([4]);
    expect(x.tracked).toEqual([]);
    expect(trackReviews(x.tracked, [round(4, 'VOID')], T0 + 9_000).voided).toEqual([]);
  });
  it('drops a review decided by a person', () => {
    const x = trackReviews([], [round(4, 'REVIEW', { review_deadline: iso(T0) })], T0 - MIN);
    expect(trackReviews(x.tracked, [round(4, 'SETTLED', { review_deadline: null })], T0 - 30_000)).toEqual({ tracked: [], voided: [] });
  });
});

describe('manager review alert (no automatic tab switch)', () => {
  const a = round(5, 'REVIEW');
  const b = round(3, 'REVIEW');
  it('counts reviews, the ones not seen yet, and the ones this manager may decide', () => {
    const al = reviewAlert([a, b], new Set([b.id]), (r) => r.id === a.id);
    expect(al).toMatchObject({ count: 2, unseen: 1, decidable: 1 });
    expect(al.oldest?.hand_no).toBe(3); // nearest deadline first
  });
  it('is empty with no reviews', () => {
    expect(reviewAlert([], new Set(), () => false)).toEqual({ count: 0, unseen: 0, decidable: 0, oldest: undefined });
  });
  it('the manager screen changes tab only from a tap', () => {
    // Regression guard for audit 11b: setTab must never run from an effect or a state change.
    const src = readFileSync(new URL('../src/screens/Manager.tsx', import.meta.url), 'utf8');
    const calls = src.split('\n').filter((l) => /\bsetTab\(/.test(l));
    expect(calls.length).toBeGreaterThan(0);
    for (const l of calls) expect(l).toMatch(/onClick=\{\(\) => setTab\(/);
  });
});
