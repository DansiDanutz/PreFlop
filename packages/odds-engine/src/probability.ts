import type { Card } from './cards.ts';
import { ALL_FLOPS, FLOP_COUNT } from './flops.ts';
import { type Selection, SELECTIONS } from './markets.ts';

/**
 * Exact probabilities by full enumeration of the 22,100 equally likely flops.
 * No simulation: every number here is a ratio of integers.
 */
export interface SelectionStats {
  readonly selection: Selection;
  /** Number of flops on which the selection wins. */
  readonly wins: number;
  /** wins / 22100. */
  readonly probability: number;
  /** Indices (into ALL_FLOPS) of the winning flops — the payout pattern used by the exposure engine. */
  readonly winningFlops: Uint16Array;
}

const cache = new Map<string, SelectionStats>();

export function statsFor(selection: Selection): SelectionStats {
  const hit = cache.get(selection.id);
  if (hit) return hit;
  const idx: number[] = [];
  for (const f of ALL_FLOPS) if (selection.wins(f)) idx.push(f.index);
  const stats: SelectionStats = Object.freeze({
    selection,
    wins: idx.length,
    probability: idx.length / FLOP_COUNT,
    winningFlops: Uint16Array.from(idx),
  });
  cache.set(selection.id, stats);
  return stats;
}

export function allStats(): readonly SelectionStats[] {
  return SELECTIONS.map(statsFor);
}

/**
 * Probability that the selection wins given that the `known` cards are NOT in
 * the flop (e.g. a table player's own hole cards). Used to quantify the
 * information edge a bettor would get if betting stayed open after the deal.
 */
export function probabilityGivenKnown(selection: Selection, known: readonly Card[]): number {
  const excluded = new Set(known.map((c) => c.id));
  let total = 0;
  let wins = 0;
  for (const f of ALL_FLOPS) {
    if (f.cards.some((c) => excluded.has(c.id))) continue;
    total++;
    if (selection.wins(f)) wins++;
  }
  return wins / total;
}
