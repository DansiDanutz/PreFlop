import { type Card, type Rank, type Suit, cardFromId, isFace, isRed } from './cards.ts';

/**
 * A flop is an unordered set of three distinct cards. Markets never depend on
 * dealing order (docs/03-market-rules.md), so we store the cards sorted by id
 * and precompute the features most markets read.
 */
export interface Flop {
  /** Position in ALL_FLOPS (0..22099), see flopIndex(). */
  readonly index: number;
  /** Cards sorted by ascending id. */
  readonly cards: readonly [Card, Card, Card];
  /** Ranks sorted ascending (ace = 14). */
  readonly ranks: readonly [Rank, Rank, Rank];
  readonly suits: readonly [Suit, Suit, Suit];
  readonly distinctRanks: 1 | 2 | 3;
  readonly distinctSuits: 1 | 2 | 3;
  readonly rankSum: number;
  readonly redCount: number;
  readonly faceCount: number;
}

export const FLOP_COUNT = 22100; // C(52, 3)

const choose2 = (n: number): number => (n * (n - 1)) / 2;
const choose3 = (n: number): number => (n * (n - 1) * (n - 2)) / 6;

/**
 * Combinatorial-number-system index of a 3-card set in colexicographic order:
 * for card ids a < b < c, index = C(c,3) + C(b,2) + a. A bijection onto 0..22099.
 */
export function flopIndex(ids: readonly [number, number, number]): number {
  const [a, b, c] = [...ids].sort((x, y) => x - y) as [number, number, number];
  if (a === b || b === c) throw new RangeError('flop cards must be distinct');
  if (a < 0 || c > 51) throw new RangeError('card id out of range');
  return choose3(c) + choose2(b) + a;
}

function makeFlop(index: number, a: number, b: number, c: number): Flop {
  const cards = [cardFromId(a), cardFromId(b), cardFromId(c)] as const;
  const ranks = cards.map((x) => x.rank).sort((x, y) => x - y) as unknown as [Rank, Rank, Rank];
  const suits = cards.map((x) => x.suit) as unknown as [Suit, Suit, Suit];
  return Object.freeze({
    index,
    cards,
    ranks,
    suits,
    distinctRanks: new Set(ranks).size as 1 | 2 | 3,
    distinctSuits: new Set(suits).size as 1 | 2 | 3,
    rankSum: ranks[0] + ranks[1] + ranks[2],
    redCount: cards.filter(isRed).length,
    faceCount: cards.filter(isFace).length,
  });
}

function enumerate(): readonly Flop[] {
  const out: Flop[] = [];
  for (let c = 2; c < 52; c++)
    for (let b = 1; b < c; b++)
      for (let a = 0; a < b; a++) out.push(makeFlop(out.length, a, b, c));
  return Object.freeze(out);
}

/** Every possible flop, in flopIndex order. With a fair shuffle each is equally likely. */
export const ALL_FLOPS: readonly Flop[] = enumerate();

export function flopFromCards(cards: readonly [Card, Card, Card]): Flop {
  return ALL_FLOPS[flopIndex([cards[0].id, cards[1].id, cards[2].id])]!;
}

export function flopFromIndex(index: number): Flop {
  const flop = ALL_FLOPS[index];
  if (!flop) throw new RangeError(`flop index out of range: ${index}`);
  return flop;
}

