/** Rounds in review: deadlines, urgency and the evidence comparison. */

/** Under this much time left a review is flagged as urgent. */
export const REVIEW_WARN_MS = 2 * 60_000;

export interface TimeLeft { ms: number | null; label: string; tone: 'danger' | 'warn' | 'normal' | 'muted' }

/** Remaining time until `review_deadline` (ISO or null), as "12 min", "1:05" (under 2 minutes) or "Overdue". */
export function timeLeft(deadline: string | null | undefined, now: number): TimeLeft {
  const at = deadline ? Date.parse(deadline) : Number.NaN;
  if (!Number.isFinite(at)) return { ms: null, label: '—', tone: 'muted' };
  const ms = at - now;
  if (ms <= 0) return { ms, label: 'Overdue', tone: 'danger' };
  const s = Math.ceil(ms / 1000);
  if (ms < REVIEW_WARN_MS) return { ms, label: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, tone: 'warn' };
  if (s < 3600) return { ms, label: `${Math.ceil(s / 60)} min`, tone: 'normal' };
  return { ms, label: `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`, tone: 'normal' };
}

/** Sort key for urgency: earliest deadline first; rounds without a deadline after all others. */
export const urgencyKey = (r: { review_deadline?: string | null | undefined }): number | null => {
  const at = r.review_deadline ? Date.parse(r.review_deadline) : Number.NaN;
  return Number.isFinite(at) ? at : null;
};

/** Most urgent first (deadline, then the oldest lock). */
export function byUrgency<R extends { review_deadline?: string | null | undefined; locked_at?: string | null | undefined }>(rows: readonly R[]): R[] {
  return [...rows].sort((a, b) => {
    const x = urgencyKey(a);
    const y = urgencyKey(b);
    if (x !== y) return x === null ? 1 : y === null ? -1 : x - y;
    return String(a.locked_at ?? '').localeCompare(String(b.locked_at ?? ''));
  });
}

/**
 * True when two flops hold the same three cards in any order. A flop is a set: the dealer may key
 * the cards in a different order from the capture without that being a discrepancy.
 */
export function sameCards(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (xs: readonly string[]) => xs.map((c) => c.trim().toUpperCase()).sort().join(',');
  return norm(a) === norm(b);
}
