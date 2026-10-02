/**
 * Pure helpers about a dealt flop. The definitions follow docs/03 §1 (ace high or low in a
 * sequence, no wrap-around) and the engine's `hand-class` market.
 */

export type HandClass = 'high-card' | 'pair' | 'flush' | 'straight' | 'trips' | 'straight-flush';

const RANK_VALUE: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };

export function rankValue(code: string): number {
  const r = code.slice(0, -1).toUpperCase().replace('10', 'T');
  const v = RANK_VALUE[r];
  if (v === undefined) throw new Error(`bad card ${code}`);
  return v;
}

export const suitOf = (code: string) => code.slice(-1).toLowerCase();

/** Three distinct ranks in a row; the ace plays high (Q-K-A) or low (A-2-3), never K-A-2. */
export function isSequence(cards: readonly string[]): boolean {
  const v = cards.map(rankValue).sort((a, b) => a - b);
  if (new Set(v).size !== 3) return false;
  if (v[2]! - v[0]! === 2) return true;
  return v[0] === 2 && v[1] === 3 && v[2] === 14;
}

/** The best three-card poker hand a flop makes. Every flop is exactly one class. */
export function handClassOf(cards: readonly string[]): HandClass {
  if (cards.length !== 3) throw new Error('a flop has three cards');
  const ranks = new Set(cards.map(rankValue)).size;
  const suits = new Set(cards.map(suitOf)).size;
  const seq = isSequence(cards);
  if (ranks === 1) return 'trips';
  if (ranks === 2) return 'pair';
  if (seq && suits === 1) return 'straight-flush';
  if (seq) return 'straight';
  if (suits === 1) return 'flush';
  return 'high-card';
}

const RESULT_LINE: Record<HandClass, string> = {
  'high-card': 'High card.',
  pair: 'A pair.',
  flush: 'A flush.',
  straight: 'A straight.',
  trips: 'Three of a kind.',
  'straight-flush': 'A straight flush.',
};

/** The big result line on the Round complete sheet, e.g. "A pair.". */
export const resultLine = (cards: readonly string[]) => RESULT_LINE[handClassOf(cards)];

/** "Round 024" style numbering from the concepts. */
export const roundLabel = (handNo: number | null | undefined) => (handNo == null ? 'Round —' : `Round ${String(handNo).padStart(3, '0')}`);

/** Hand number from a round id like "green-room:h187" (used only when the API gave no hand_no). */
export function handNoFromRoundId(id: string | null | undefined): number | null {
  const m = id ? /:h(\d+)$/.exec(id) : null;
  return m ? Number(m[1]) : null;
}
