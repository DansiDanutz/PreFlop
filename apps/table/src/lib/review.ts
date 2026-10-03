import type { Round } from './types.ts';

/**
 * Review deadline (docs/12 §6): a round left in REVIEW is voided and refunded by the server's
 * sweeper at the SLA. The tablet shows the countdown so a floor manager is never surprised by it.
 */
export const REVIEW_SLA_MS = 30 * 60_000;
/** Under this much time left the countdown turns into a warning. */
export const REVIEW_WARN_MS = 2 * 60_000;

/**
 * Deadline of round r in epoch ms, or null when unknown (no countdown is shown then).
 * `review_deadline` wins whenever the server sends the field (null = no deadline). Only when the
 * field is absent is it computed from `review_started_at` + 30 min, and only if that is present.
 */
export function reviewDeadlineMs(r: Pick<Round, 'review_deadline' | 'review_started_at'>): number | null {
  if (r.review_deadline !== undefined) {
    if (!r.review_deadline) return null;
    const t = Date.parse(r.review_deadline);
    return Number.isFinite(t) ? t : null;
  }
  if (r.review_started_at) {
    const t = Date.parse(r.review_started_at);
    return Number.isFinite(t) ? t + REVIEW_SLA_MS : null;
  }
  return null;
}

export interface Countdown {
  level: 'ok' | 'warn' | 'expired';
  /** Milliseconds left (0 once expired). */
  remainingMs: number;
  /** "m:ss" left, or "0:00". */
  label: string;
}

/** "m:ss" (minutes not capped, so 30 min reads "30:00"). Rounds up, so 0:00 only at the deadline. */
export function fmtRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Countdown at `now` (server time: local time + clock offset). Null when there is no deadline. */
export function reviewCountdown(deadline: number | null, now: number): Countdown | null {
  if (deadline === null) return null;
  const remainingMs = Math.max(0, deadline - now);
  const level = remainingMs <= 0 ? 'expired' : remainingMs < REVIEW_WARN_MS ? 'warn' : 'ok';
  return { level, remainingMs, label: fmtRemaining(remainingMs) };
}

export interface TrackedReview { id: string; hand_no: number; deadline: number | null }

/**
 * Rounds this tablet saw in REVIEW that the sweeper has since auto-voided: now VOID, or gone from
 * the latest-three list, with the deadline passed. A round voided or settled before its deadline
 * was decided by a person and is not reported here.
 */
export function autoVoided(tracked: readonly TrackedReview[], rounds: readonly Pick<Round, 'id' | 'state'>[], now: number): TrackedReview[] {
  return tracked.filter((t) => {
    if (t.deadline === null || now < t.deadline) return false;
    const r = rounds.find((x) => x.id === t.id);
    return !r || r.state === 'VOID';
  });
}

/**
 * Updates the set of tracked REVIEW rounds from a fresh state, and returns the ones that were
 * auto-voided (to notify) along with the new tracking list (rounds still in REVIEW, or decided
 * before the deadline, are dropped once they leave REVIEW).
 */
export function trackReviews(tracked: readonly TrackedReview[], rounds: readonly Round[], now: number): { tracked: TrackedReview[]; voided: TrackedReview[] } {
  const voided = autoVoided(tracked, rounds, now);
  const next: TrackedReview[] = [];
  for (const r of rounds) {
    if (r.state !== 'REVIEW') continue;
    const prev = tracked.find((t) => t.id === r.id);
    next.push({ id: r.id, hand_no: r.hand_no, deadline: reviewDeadlineMs(r) ?? prev?.deadline ?? null });
  }
  // A REVIEW round past its deadline that is no longer listed as REVIEW but not yet VOID (e.g. a
  // poll in between) stays tracked until it is resolved one way or the other.
  for (const t of tracked) {
    if (next.some((n) => n.id === t.id) || voided.some((v) => v.id === t.id)) continue;
    const r = rounds.find((x) => x.id === t.id);
    if (r && r.state !== 'SETTLED' && r.state !== 'VOID') next.push(t);
  }
  return { tracked: next, voided };
}

// ------------------------------------------------------------------ manager review alerts

/**
 * What the Review tab badge and the banner on the other tabs show. The manager is never moved to
 * the Review tab automatically (a half-entered flop or a held VOID would be lost).
 */
export function reviewAlert(reviews: readonly Round[], viewed: ReadonlySet<string>, mine: (r: Round) => boolean) {
  const unseen = reviews.filter((r) => !viewed.has(r.id));
  const decidable = reviews.filter((r) => !mine(r));
  // The oldest review has the nearest deadline.
  const oldest = [...reviews].sort((a, b) => a.hand_no - b.hand_no)[0];
  return { count: reviews.length, unseen: unseen.length, decidable: decidable.length, oldest };
}
