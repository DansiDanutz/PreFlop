/**
 * Watching the webcam for the flop (docs/19): the console reads a frame about once a second while
 * betting is closed. A dealer's hand moving over the cards gives partial or wrong reads, so a flop is
 * reported only when the same three cards are read STABLE_READS times in a row, and only once.
 */
export const STABLE_READS = 3;
/** How often the console reads a frame while it watches. */
export const WATCH_INTERVAL_MS = 1000;

export interface WatchState { key: string | null; count: number; reported: boolean }
export const initialWatch: WatchState = { key: null, count: 0, reported: false };

/** The same three cards in any order give the same key; anything but three cards gives none. */
const keyOf = (flop: readonly string[] | null) => (flop && flop.length === 3 ? [...flop].sort().join(',') : null);

/**
 * `previous` is the last settled flop at this table: cards still lying on the felt from the hand before
 * are never reported as the new flop, however often they are read.
 */
export function nextWatch(s: WatchState, flop: readonly string[] | null, previous: readonly string[] | null = null): { state: WatchState; stable: string[] | null } {
  const key = keyOf(flop);
  if (!key || key === keyOf(previous)) return { state: initialWatch, stable: null };
  const count = key === s.key ? s.count + 1 : 1;
  const reported = key === s.key && s.reported;
  if (count >= STABLE_READS && !reported) return { state: { key, count, reported: true }, stable: [...flop!] };
  return { state: { key, count, reported }, stable: null };
}
