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

/** Fit a webcam frame inside `max` pixels on its longer side, keeping the aspect ratio. */
export function scaledSize(width: number, height: number, max = 1280): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** A canvas data URL → the media type and bare base64 the API takes. */
export function splitDataUrl(url: string): { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(url);
  return m ? { mediaType: m[1] as 'image/jpeg' | 'image/png' | 'image/webp', base64: m[2]! } : null;
}
