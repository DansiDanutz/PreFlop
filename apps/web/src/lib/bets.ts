import type { Book, BookMarket, BookSelection } from '@preflop/client';

/**
 * Pure bet-catalogue logic: browse categories, the main prediction grid, favorites.
 * Odds always come from GET /v1/book; nothing here invents a price.
 */

// ------------------------------------------------------------------ categories

export type Category = 'patterns' | 'colors' | 'suits' | 'ranks' | 'sequences' | 'more';
export const CATEGORIES: readonly { id: Category | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'colors', label: 'Colors' },
  { id: 'suits', label: 'Suits' },
  { id: 'ranks', label: 'Ranks' },
  { id: 'sequences', label: 'Sequences' },
  { id: 'more', label: 'More' },
];

/** Engine family → Browse-bets category. The suits-colours family splits on the market id. */
export function categoryOf(marketId: string, family: string): Category {
  switch (family) {
    case 'rank-patterns':
      return 'patterns';
    case 'suits-colours':
      return marketId === 'colour' || marketId.startsWith('colour') || marketId.startsWith('red-count') ? 'colors' : 'suits';
    case 'high-low':
    case 'face-named':
      return 'ranks';
    case 'sequences':
      return 'sequences';
    default:
      return 'more';
  }
}

// ------------------------------------------------------------------ catalogue

export interface BetOption {
  id: string;
  name: string;
  marketId: string;
  marketName: string;
  description: string;
  category: Category;
  oddsCenti: number;
  probability: number;
  offered: boolean;
}

/** Friendlier names for the concept's default favorites and the main grid. */
const NICE_NAMES: Record<string, string> = {
  'hand-class:pair': 'Any pair',
  'hand-class:high-card': 'High card',
  'hand-class:flush': 'Flush',
  'hand-class:straight': 'Straight',
  'hand-class:trips': 'Three of a kind',
  'hand-class:straight-flush': 'Straight flush',
  'colour:all-red': 'All red',
  'colour:all-black': 'All black',
  'suit-pattern:monotone': 'Any flush',
  'straight:yes': 'Any straight',
  'any-ace:yes': 'Contains an ace',
};

/**
 * Exact equivalents used when the running backend's book predates a market (e.g. `hand-class`).
 * Each pair describes the SAME set of flops, so the price and the settlement are identical.
 */
export const EQUIVALENT: Record<string, string> = {
  'hand-class:pair': 'rank-pattern:pair',
  'hand-class:trips': 'rank-pattern:trips',
  'hand-class:straight-flush': 'straight-flush:yes',
};

export function indexBook(book: Book | undefined): Map<string, BetOption> {
  const out = new Map<string, BetOption>();
  if (!book) return out;
  for (const m of book.markets) {
    for (const s of m.selections) out.set(s.id, toOption(m, s));
  }
  return out;
}

function toOption(m: BookMarket, s: BookSelection): BetOption {
  return {
    id: s.id,
    name: NICE_NAMES[s.id] ?? s.label,
    marketId: m.id,
    marketName: m.name,
    description: m.description,
    category: categoryOf(m.id, m.family),
    oddsCenti: s.odds_centi,
    probability: s.probability,
    offered: s.offered,
  };
}

/** Looks a selection up, falling back to an exact equivalent. Returns the id to bet on. */
export function resolveOption(index: Map<string, BetOption>, id: string): BetOption | undefined {
  const direct = index.get(id);
  if (direct) return direct;
  const eq = EQUIVALENT[id];
  const alt = eq ? index.get(eq) : undefined;
  return alt ? { ...alt, name: NICE_NAMES[id] ?? alt.name } : undefined;
}

/** Text search over name, market and description; case-insensitive, all words must match. */
export function searchOptions(options: readonly BetOption[], query: string, category: Category | 'all' = 'all'): BetOption[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return options.filter((o) => {
    if (category !== 'all' && o.category !== category) return false;
    const hay = `${o.name} ${o.marketName} ${o.id}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Groups options into sections by market, keeping book order. */
export function sectionByMarket(options: readonly BetOption[]): { title: string; marketId: string; items: BetOption[] }[] {
  const out: { title: string; marketId: string; items: BetOption[] }[] = [];
  for (const o of options) {
    let s = out.find((x) => x.marketId === o.marketId);
    if (!s) out.push((s = { title: o.marketName, marketId: o.marketId, items: [] }));
    s.items.push(o);
  }
  return out;
}

// ------------------------------------------------------------------ main grid (screen 4)

export interface GridTile { id: string; title: string; subtitle: string; icon: 'pair' | 'flush' | 'straight' | 'high-card' }
export const MAIN_GRID: readonly GridTile[] = [
  { id: 'hand-class:pair', title: 'Pair', subtitle: 'Two of a kind', icon: 'pair' },
  { id: 'hand-class:flush', title: 'Flush', subtitle: 'Three of the same suit', icon: 'flush' },
  { id: 'hand-class:straight', title: 'Straight', subtitle: 'Three in sequence', icon: 'straight' },
  { id: 'hand-class:high-card', title: 'High card', subtitle: 'No pair, flush or straight', icon: 'high-card' },
];

// ------------------------------------------------------------------ favorites (screens 5–7)

export const MAX_FAVORITES = 6;
export const DEFAULT_FAVORITES: readonly string[] = [
  'hand-class:pair', 'colour:all-red', 'colour:all-black', 'suit-pattern:monotone', 'straight:yes', 'any-ace:yes',
];

export type AddResult = { kind: 'added'; list: string[] } | { kind: 'exists'; list: string[] } | { kind: 'full'; list: string[] };

/** Adds a favorite if there is a free slot; reports `full` so the UI can open "Replace a favorite". */
export function addFavorite(list: readonly string[], id: string, max = MAX_FAVORITES): AddResult {
  if (list.includes(id)) return { kind: 'exists', list: [...list] };
  if (list.length >= max) return { kind: 'full', list: [...list] };
  return { kind: 'added', list: [...list, id] };
}

/** Replaces one slot in place, keeping the other favorites and their order unchanged. */
export function replaceFavorite(list: readonly string[], oldId: string, newId: string): string[] {
  if (oldId === newId || !list.includes(oldId)) return [...list];
  if (list.includes(newId)) return list.filter((x) => x !== oldId);
  return list.map((x) => (x === oldId ? newId : x));
}

export const removeFavorite = (list: readonly string[], id: string) => list.filter((x) => x !== id);

/** Cleans a stored list: unique, strings only, at most `max`. */
export function sanitizeFavorites(v: unknown, max = MAX_FAVORITES): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) if (typeof x === 'string' && x && !out.includes(x)) out.push(x);
  return out.slice(0, max);
}
