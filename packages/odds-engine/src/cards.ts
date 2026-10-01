/**
 * Card conventions used by every PreFlop market (see docs/03-market-rules.md):
 *
 * - Ranks are numbered 2..14 with J=11, Q=12, K=13 and A=14 (ace high) everywhere,
 *   including rank sums and thresholds.
 * - The only place an ace also plays low is the sequence ("straight") family,
 *   where A-2-3 counts as three consecutive ranks.
 * - "Red" means hearts or diamonds; "black" means spades or clubs.
 * - "Face cards" are J, Q, K only (the plan's "all images"). Broadway is 10..A.
 */

export const SUITS = ['s', 'h', 'd', 'c'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
  /** Stable id 0..51: (rank - 2) * 4 + suit index. */
  readonly id: number;
}

export const SUIT_NAMES: Record<Suit, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
export const SUIT_SYMBOLS: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

const RANK_CHARS: Record<Rank, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

export function rankChar(rank: Rank): string {
  return RANK_CHARS[rank];
}

export const DECK: readonly Card[] = RANKS.flatMap((rank) =>
  SUITS.map((suit, si) => Object.freeze({ rank, suit, id: (rank - 2) * 4 + si })),
);

export function cardFromId(id: number): Card {
  const card = DECK[id];
  if (!card) throw new RangeError(`card id out of range: ${id}`);
  return card;
}

/** Parses "As", "Td", "10h", "7c" (case-insensitive rank, lowercase suit). */
export function parseCard(text: string): Card {
  const m = /^(10|[2-9TJQKA])([shdc])$/i.exec(text.trim());
  if (!m) throw new SyntaxError(`invalid card: ${text}`);
  const r = m[1]!.toUpperCase();
  const rank = (r === '10' ? 10 : RANKS.find((x) => RANK_CHARS[x] === r)) as Rank;
  const suit = m[2]!.toLowerCase() as Suit;
  return DECK[(rank - 2) * 4 + SUITS.indexOf(suit)]!;
}

export function formatCard(card: Card): string {
  return `${RANK_CHARS[card.rank]}${card.suit}`;
}

export const isRed = (c: Card): boolean => c.suit === 'h' || c.suit === 'd';
export const isFace = (c: Card): boolean => c.rank >= 11 && c.rank <= 13;
export const isBroadway = (c: Card): boolean => c.rank >= 10;
export const isOddRank = (c: Card): boolean => c.rank % 2 === 1;
