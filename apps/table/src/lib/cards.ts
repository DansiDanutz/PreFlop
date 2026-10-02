export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;
export const SUITS = ['s', 'h', 'd', 'c'] as const;
export type Suit = (typeof SUITS)[number];

export const SUIT_SYMBOL: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUIT_NAME: Record<Suit, string> = { s: 'Spades', h: 'Hearts', d: 'Diamonds', c: 'Clubs' };
export const isRed = (code: string) => code.endsWith('h') || code.endsWith('d');

const CARD = /^(?:[2-9TJQKA])[shdc]$/;
export const isCard = (c: string) => CARD.test(c);

/** A valid flop: exactly three distinct cards such as "Kh", "Td", "7c". */
export function isValidFlop(cards: readonly string[]): boolean {
  return cards.length === 3 && cards.every(isCard) && new Set(cards).size === 3;
}

/** Human form "K♥ 10♦ 7♣". */
export const pretty = (code: string) => `${code.slice(0, -1).replace('T', '10')}${SUIT_SYMBOL[code.slice(-1) as Suit] ?? ''}`;
export const prettyFlop = (cards: readonly string[]) => cards.map(pretty).join('  ');

/** Same three cards regardless of order. */
export function sameFlop(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((c) => s.has(c));
}
