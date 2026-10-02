import { SELECTIONS, type Flop, statsFor } from '@preflop/odds-engine';

/**
 * Outcome monitoring (docs/12 §2a): a one-sided Bernoulli CUSUM per selection and table,
 * testing p0 (the exact probability) against p1 = min(0.95, ratio · p0). Each settled flop adds
 * the log-likelihood ratio of its outcome; the statistic is floored at 0. Crossing the threshold
 * pauses the table and raises a critical alert. Calibration (measured, not assumed):
 * - ratio 3 / threshold 7: 327 false alarms per 50,000 fair flops — far too noisy;
 * - ratio 5 / threshold 14: 19 false alarms per 1,000,000 fair flops (one per ~52,600 hands per
 *   table) — the live simulator hit one after 233 hands on one of 5 tables, a ~2% event;
 * - ratio 5 / threshold 16 (current): 2 per 1,000,000 fair flops (one per ~500,000 hands per table,
 *   over a year at 40 hands/hour), and a deck stacked for "all red" every hand is caught in 10 hands.
 * The dealing simulation itself was checked over 300,000 hands (all |z| < 1.5).
 */
export const MONITOR = { ratio: 5, threshold: 16 } as const;

const TRACKED = SELECTIONS.map((s) => {
  const st = statsFor(s);
  const p0 = st.probability;
  const p1 = Math.min(0.95, MONITOR.ratio * p0);
  return { id: s.id, wins: s.wins, up: Math.log(p1 / p0), down: Math.log((1 - p1) / (1 - p0)), p0 };
}).filter((s) => s.p0 > 0 && s.p0 < 0.3); // frequent outcomes are already tightly bounded by the margin

export interface MonitorResult {
  state: Record<string, number>;
  alarms: { selectionId: string; statistic: number }[];
}

export function updateMonitor(state: Record<string, number>, flop: Flop): MonitorResult {
  const next: Record<string, number> = {};
  const alarms: MonitorResult['alarms'] = [];
  for (const s of TRACKED) {
    const v = Math.max(0, (state[s.id] ?? 0) + (s.wins(flop) ? s.up : s.down));
    if (v > 0) next[s.id] = Math.round(v * 1e6) / 1e6;
    if (v >= MONITOR.threshold) alarms.push({ selectionId: s.id, statistic: v });
  }
  return { state: next, alarms };
}
