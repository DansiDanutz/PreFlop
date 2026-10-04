/**
 * Card recognition for manual tables (docs/19): the parts that need no OpenCV, so they are unit-tested
 * in Node. The pipeline in reader.ts finds the white card rectangles on the felt, straightens each,
 * reads the corner index (rank glyph over the suit pip) by comparing it with glyphs rendered in this
 * browser, and hands the guesses to pickFlop(). The operator still confirms every card.
 */

export type Point = { x: number; y: number };

export interface CardGuess {
  /** "Ah", "Td", … */
  card: string;
  /** 0..1: the lower of the rank and suit match scores. */
  confidence: number;
  /** The card's four corners in the source image, in order top-left, top-right, bottom-right, bottom-left. */
  corners: [Point, Point, Point, Point];
}

export interface Reading {
  guesses: CardGuess[];
  /** The three best distinct cards, left to right, when at least three were found with enough confidence. */
  flop: string[];
  /** Width and height of the frame that was read. */
  size: { width: number; height: number };
  ms: number;
}

/** Rank glyphs as printed on a card's index ("10", not "T") and the code used in the API. */
export const RANK_GLYPHS: readonly { glyph: string; code: string }[] = [
  { glyph: 'A', code: 'A' }, { glyph: '2', code: '2' }, { glyph: '3', code: '3' }, { glyph: '4', code: '4' },
  { glyph: '5', code: '5' }, { glyph: '6', code: '6' }, { glyph: '7', code: '7' }, { glyph: '8', code: '8' },
  { glyph: '9', code: '9' }, { glyph: '10', code: 'T' }, { glyph: 'J', code: 'J' }, { glyph: 'Q', code: 'Q' }, { glyph: 'K', code: 'K' },
];
export const SUIT_GLYPHS: readonly { glyph: string; code: string; red: boolean }[] = [
  { glyph: '♠', code: 's', red: false }, { glyph: '♥', code: 'h', red: true }, { glyph: '♦', code: 'd', red: true }, { glyph: '♣', code: 'c', red: false },
];

/** A guess below this is shown but never pre-filled. */
export const MIN_CONFIDENCE = 0.45;

/**
 * Orders four corner points top-left, top-right, bottom-right, bottom-left (image coordinates, y down).
 * Top-left has the smallest x+y, bottom-right the largest; of the other two, top-right has the smaller y−x.
 */
export function orderCorners(pts: readonly Point[]): [Point, Point, Point, Point] {
  if (pts.length !== 4) throw new Error('four corners expected');
  const bySum = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const tl = bySum[0]!, br = bySum[3]!;
  const rest = bySum.slice(1, 3).sort((a, b) => (a.y - a.x) - (b.y - b.x));
  return [tl, rest[0]!, br, rest[1]!];
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * A playing card is about 0.7 times as wide as it is tall (63 × 88 mm). Whether the quadrilateral is a
 * card seen in portrait or landscape: its sides' ratio must be near that, in either direction.
 */
export function cardLike(c: readonly [Point, Point, Point, Point], tolerance = 0.18): boolean {
  const w = (dist(c[0], c[1]) + dist(c[3], c[2])) / 2;
  const h = (dist(c[0], c[3]) + dist(c[1], c[2])) / 2;
  if (w < 1 || h < 1) return false;
  const ratio = Math.min(w, h) / Math.max(w, h);
  return Math.abs(ratio - 0.716) <= tolerance;
}

/**
 * Corners rotated so the straightened card is portrait (taller than wide). A card lying on its side has
 * its index at what is now the top-right corner (or bottom-left); the reader tries the opposite corners
 * of the straightened card anyway, so which way it was turned does not matter.
 */
export function portraitCorners(c: readonly [Point, Point, Point, Point]): [Point, Point, Point, Point] {
  const w = (dist(c[0], c[1]) + dist(c[3], c[2])) / 2;
  const h = (dist(c[0], c[3]) + dist(c[1], c[2])) / 2;
  return w > h ? [c[3], c[0], c[1], c[2]] : [c[0], c[1], c[2], c[3]];
}

export const center = (c: readonly Point[]): Point => ({ x: c.reduce((s, p) => s + p.x, 0) / c.length, y: c.reduce((s, p) => s + p.y, 0) / c.length });

/**
 * The flop from the guesses: distinct cards (the best guess of each wins), at least MIN_CONFIDENCE,
 * the three most confident, ordered left to right as they lie on the felt. Fewer than three good
 * guesses → an empty flop: the operator picks by hand rather than from a half reading.
 */
export function pickFlop(guesses: readonly CardGuess[], min = MIN_CONFIDENCE): string[] {
  const best = new Map<string, CardGuess>();
  for (const g of guesses) {
    if (g.confidence < min) continue;
    const prev = best.get(g.card);
    if (!prev || g.confidence > prev.confidence) best.set(g.card, g);
  }
  const top = [...best.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  if (top.length < 3) return [];
  return top.sort((a, b) => center(a.corners).x - center(b.corners).x).map((g) => g.card);
}

/** Row (or column) sums of a binary image → the [start, end) runs of ink, ignoring runs shorter than minLen. */
export function inkRuns(sums: readonly number[], minLen = 2, threshold = 0): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= sums.length; i++) {
    const on = i < sums.length && sums[i]! > threshold;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { if (i - start >= minLen) runs.push([start, i]); start = -1; }
  }
  return runs;
}

/** The rank and suit bands of a corner index: the two tallest ink runs, top one the rank. */
export function indexBands(rowRuns: readonly [number, number][]): { rank: [number, number]; suit: [number, number] } | null {
  if (rowRuns.length < 2) return null;
  const tallest = [...rowRuns].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, 2).sort((a, b) => a[0] - b[0]);
  return { rank: tallest[0]!, suit: tallest[1]! };
}

/** Red (hearts, diamonds) when the ink is clearly redder than it is green or blue. */
export function isRedInk(mean: { r: number; g: number; b: number }): boolean {
  return mean.r > 90 && mean.r > mean.g * 1.35 && mean.r > mean.b * 1.35;
}

/** The best template by normalised correlation; ties and empty inputs resolve to null. */
export function bestMatch<T extends { code: string }>(scores: readonly { template: T; score: number }[]): { template: T; score: number } | null {
  let best: { template: T; score: number } | null = null;
  for (const s of scores) if (Number.isFinite(s.score) && (!best || s.score > best.score)) best = s;
  return best;
}
