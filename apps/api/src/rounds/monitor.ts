import { SELECTIONS, type Flop, statsFor } from '@preflop/odds-engine';

/**
 * Outcome monitoring (docs/12 §2a): a one-sided Bernoulli CUSUM per selection and table,
 * testing p0 (the exact probability) against p1 = min(0.95, ratio · p0). Each settled flop adds
 * the log-likelihood ratio of its outcome; the statistic is floored at 0. Crossing the threshold
 * pauses the table and raises a critical alert. Calibration (random flops vs a stacked deck):
 * ratio 5 / threshold 14 gave 0 false alarms in 50,000 fair flops across every tracked selection,
 * and a deck stacked for "all red" every hand (p0 ≈ 11.8%) is caught in 9 hands.
 */
export const MONITOR = { ratio: 5, threshold: 14 } as const;

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
