/** Card picker logic for manual tables (portals/admin/ManualTables.tsx). Cards are written like "Ah", "Td", "7c". */

export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;
export const SUITS = [
  { id: 's', symbol: '♠', name: 'spades', red: false },
  { id: 'h', symbol: '♥', name: 'hearts', red: true },
  { id: 'd', symbol: '♦', name: 'diamonds', red: true },
  { id: 'c', symbol: '♣', name: 'clubs', red: false },
] as const;

/** Adds a card, or removes it if already picked. A fourth card is ignored: a flop is three cards. */
export function toggleCard(picked: readonly string[], card: string, max = 3): string[] {
  if (picked.includes(card)) return picked.filter((c) => c !== card);
  return picked.length >= max ? [...picked] : [...picked, card];
}

/** "Ah" → "A♥"; "Td" → "10♦". */
export function cardLabel(card: string): string {
  const suit = SUITS.find((s) => s.id === card.slice(-1));
  return `${card.slice(0, -1).replace('T', '10')}${suit?.symbol ?? ''}`;
}

/** Seconds left before an unentered flop is voided and refunded, never below 0. */
export function secondsLeft(lockedAt: string | null, slaMs: number, now = Date.now()): number | null {
  if (!lockedAt) return null;
  return Math.max(0, Math.floor((Date.parse(lockedAt) + slaMs - now) / 1000));
}
