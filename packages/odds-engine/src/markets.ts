import { type Rank, type Suit, RANKS, SUITS, SUIT_NAMES, DECK, formatCard, isBroadway, isOddRank, rankChar } from './cards.ts';
import type { Flop } from './flops.ts';

/**
 * The PreFlop market catalogue. Every selection is a pure predicate over an
 * unordered flop, so the same code prices it (by enumeration) and settles it.
 * Catalogue numbers refer to section 7 of the business plan (docs/00-business-plan.md).
 */

export type Family =
  | 'rank-patterns'
  | 'suits-colours'
  | 'high-low'
  | 'face-named'
  | 'sequences'
  | 'totals-parity'
  | 'combined';

export const FAMILY_NAMES: Record<Family, string> = {
  'rank-patterns': 'A. Rank patterns',
  'suits-colours': 'B. Suits and colours',
  'high-low': 'C. High / low and rank ranges',
  'face-named': 'D. Face cards and named ranks',
  sequences: 'E. Sequences and gaps',
  'totals-parity': 'F. Totals and parity',
  combined: 'G. Combined conditions',
};

export interface Selection {
  /** Globally unique, stable id: `<marketId>:<key>`. Used by the API, ledger and settlement. */
  readonly id: string;
  readonly marketId: string;
  readonly label: string;
  readonly wins: (flop: Flop) => boolean;
}

export interface Market {
  readonly id: string;
  readonly family: Family;
  readonly name: string;
  readonly description: string;
  /** Business-plan catalogue item numbers this market covers. */
  readonly catalogueRefs: readonly number[];
  /** Part of the proposed first-release set (plan section 7). */
  readonly firstRelease: boolean;
  /** True when exactly one selection wins on every flop (used to report the book's overround). */
  readonly exhaustive: boolean;
  readonly selections: readonly Selection[];
}

type SelectionSpec = readonly [key: string, label: string, wins: (f: Flop) => boolean];

interface MarketSpec {
  id: string;
  family: Family;
  name: string;
  description: string;
  refs: number[];
  firstRelease?: boolean;
  exhaustive?: boolean;
  selections: SelectionSpec[];
}

function market(spec: MarketSpec): Market {
  return Object.freeze({
    id: spec.id,
    family: spec.family,
    name: spec.name,
    description: spec.description,
    catalogueRefs: spec.refs,
    firstRelease: spec.firstRelease ?? false,
    exhaustive: spec.exhaustive ?? false,
    selections: spec.selections.map(([key, label, wins]) =>
      Object.freeze({ id: `${spec.id}:${key}`, marketId: spec.id, label, wins }),
    ),
  });
}

// ---------- shared flop helpers ----------

const has = (f: Flop, pred: (r: Rank) => boolean): boolean => f.ranks.some(pred);
const all = (f: Flop, pred: (r: Rank) => boolean): boolean => f.ranks.every(pred);
const count = (f: Flop, pred: (r: Rank) => boolean): number => f.ranks.filter(pred).length;
const suitCount = (f: Flop, s: Suit): number => f.suits.filter((x) => x === s).length;

/** The rank that appears twice when the flop is exactly paired (middle of the sorted ranks). */
export const pairedRank = (f: Flop): Rank | undefined => (f.distinctRanks === 2 ? f.ranks[1] : undefined);
/** The unpaired card's rank on an exactly-paired flop. */
const kickerRank = (f: Flop): Rank | undefined =>
  f.distinctRanks === 2 ? (f.ranks[0] === f.ranks[1] ? f.ranks[2] : f.ranks[0]) : undefined;

/**
 * Three consecutive distinct ranks. Ace plays high (Q-K-A) or low (A-2-3);
 * there is no wrap-around (K-A-2 is not a sequence).
 */
export function isSequence(f: Flop): boolean {
  if (f.distinctRanks !== 3) return false;
  const [a, b, c] = f.ranks;
  return c - a === 2 || (a === 2 && b === 3 && c === 14);
}

/** Any two flop ranks differ by exactly one (ace adjacent to both K and 2). */
export function hasAdjacentRanks(f: Flop): boolean {
  const rs = [...new Set(f.ranks)];
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const d = Math.abs(rs[i]! - rs[j]!);
      if (d === 1 || d === 12) return true; // 12 = A(14) next to 2
    }
  return false;
}

const span = (f: Flop): number => f.ranks[2] - f.ranks[0];
const R = (r: Rank): string => rankChar(r);
const between = (lo: number, hi: number) => (n: number) => n >= lo && n <= hi;

// ---------- the catalogue ----------

function build(): readonly Market[] {
  const m: Market[] = [];

  // A. Rank patterns
  m.push(
    market({
      id: 'rank-pattern', family: 'rank-patterns', name: 'Rank pattern', refs: [1, 2, 3], firstRelease: true, exhaustive: true,
      description: 'How many distinct ranks the flop has.',
      selections: [
        ['no-pair', 'Three different ranks', (f) => f.distinctRanks === 3],
        ['pair', 'Exactly one pair', (f) => f.distinctRanks === 2],
        ['trips', 'Three of a kind', (f) => f.distinctRanks === 1],
      ],
    }),
    market({
      id: 'hand-class', family: 'rank-patterns', name: 'Flop hand', refs: [1, 2, 3, 31, 32], firstRelease: true, exhaustive: true,
      description: 'The best three-card poker hand the flop makes (the app\'s main prediction grid). Every flop is exactly one of these.',
      selections: [
        ['high-card', 'High card: no pair, flush or straight', (f) => f.distinctRanks === 3 && f.distinctSuits > 1 && !isSequence(f)],
        ['pair', 'Pair: two of a kind', (f) => f.distinctRanks === 2],
        ['flush', 'Flush: three of the same suit, not in sequence', (f) => f.distinctSuits === 1 && !isSequence(f)],
        ['straight', 'Straight: three in sequence, not all one suit', (f) => isSequence(f) && f.distinctSuits > 1],
        ['trips', 'Three of a kind', (f) => f.distinctRanks === 1],
        ['straight-flush', 'Straight flush', (f) => isSequence(f) && f.distinctSuits === 1],
      ],
    }),
    market({
      id: 'paired-board', family: 'rank-patterns', name: 'Paired board', refs: [1, 2], exhaustive: true,
      description: 'Whether any rank appears at least twice (a pair or trips).',
      selections: [
        ['yes', 'Board is paired (pair or trips)', (f) => f.distinctRanks <= 2],
        ['no', 'Board is unpaired', (f) => f.distinctRanks === 3],
      ],
    }),
    market({
      id: 'pair-of-rank', family: 'rank-patterns', name: 'Pair of a named rank', refs: [4],
      description: 'Exactly two cards of the chosen rank (trips do not count).',
      selections: RANKS.map((r) => [`${R(r)}`, `Pair of ${R(r)}s`, (f: Flop) => pairedRank(f) === r] as const),
    }),
    market({
      id: 'pair-height', family: 'rank-patterns', name: 'Paired rank low / high', refs: [5],
      description: 'Exactly one pair, with the paired rank in the chosen band.',
      selections: [
        ['low', 'Pair of 2s to 7s', (f) => between(2, 7)(pairedRank(f) ?? 0)],
        ['mid', 'Pair of 8s to 10s', (f) => between(8, 10)(pairedRank(f) ?? 0)],
        ['high', 'Pair of Js to As', (f) => between(11, 14)(pairedRank(f) ?? 0)],
      ],
    }),
    market({
      id: 'pair-face-kicker', family: 'rank-patterns', name: 'Pair with a face-card kicker', refs: [6],
      description: 'Exactly one pair and the unpaired card is J, Q or K.',
      selections: [['yes', 'Pair + face kicker', (f) => between(11, 13)(kickerRank(f) ?? 0)]],
    }),
  );

  // B. Suits and colours
  m.push(
    market({
      id: 'suit-pattern', family: 'suits-colours', name: 'Suit pattern', refs: [7, 8, 9], firstRelease: true, exhaustive: true,
      description: 'Number of distinct suits on the flop.',
      selections: [
        ['rainbow', 'Rainbow (three suits)', (f) => f.distinctSuits === 3],
        ['two-tone', 'Two-tone (exactly two suits)', (f) => f.distinctSuits === 2],
        ['monotone', 'Monotone (one suit)', (f) => f.distinctSuits === 1],
      ],
    }),
    market({
      id: 'monotone-suit', family: 'suits-colours', name: 'All one named suit', refs: [10],
      description: 'All three cards are of the chosen suit.',
      selections: SUITS.map((s) => [s, `All ${SUIT_NAMES[s]}`, (f: Flop) => suitCount(f, s) === 3] as const),
    }),
    market({
      id: 'colour', family: 'suits-colours', name: 'Card colour', refs: [11], firstRelease: true, exhaustive: true,
      description: 'Red = hearts and diamonds, black = spades and clubs.',
      selections: [
        ['all-red', 'All red', (f) => f.redCount === 3],
        ['all-black', 'All black', (f) => f.redCount === 0],
        ['mixed', 'Mixed colours', (f) => f.redCount === 1 || f.redCount === 2],
      ],
    }),
    market({
      id: 'red-count', family: 'suits-colours', name: 'Number of red cards', refs: [12], exhaustive: true,
      description: 'Exactly N red cards (hearts or diamonds).',
      selections: [0, 1, 2, 3].map((n) => [`${n}`, `Exactly ${n} red`, (f: Flop) => f.redCount === n] as const),
    }),
    ...SUITS.map((s) =>
      market({
        id: `suit-count-${s}`, family: 'suits-colours', name: `Number of ${SUIT_NAMES[s]}`, refs: [13], exhaustive: true,
        description: `Exactly N ${SUIT_NAMES[s]} on the flop.`,
        selections: [0, 1, 2, 3].map((n) => [`${n}`, `Exactly ${n} ${n === 1 ? SUIT_NAMES[s].slice(0, -1) : SUIT_NAMES[s]}`, (f: Flop) => suitCount(f, s) === n] as const),
      }),
    ),
  );

  // C. High / low and rank ranges
  m.push(
    market({
      id: 'all-below', family: 'high-low', name: 'All cards below X', refs: [14], firstRelease: true,
      description: 'Every card is strictly below the chosen rank (ace is high).',
      selections: ([6, 7, 8, 9, 10, 11] as Rank[]).map((x) => [`${R(x)}`, `All below ${R(x)}`, (f: Flop) => all(f, (r) => r < x)] as const),
    }),
    market({
      id: 'all-above', family: 'high-low', name: 'All cards above X', refs: [15],
      description: 'Every card is strictly above the chosen rank (ace is high).',
      selections: ([7, 8, 9, 10] as Rank[]).map((x) => [`${R(x)}`, `All above ${R(x)}`, (f: Flop) => all(f, (r) => r > x)] as const),
    }),
    market({
      id: 'all-in-range', family: 'high-low', name: 'All cards in a range', refs: [16],
      description: 'Every card is within the inclusive rank interval.',
      selections: ([[5, 9], [6, 10], [7, 11], [8, 12]] as const).map(
        ([lo, hi]) => [`${R(lo)}-${R(hi)}`, `All between ${R(lo)} and ${R(hi)}`, (f: Flop) => all(f, between(lo, hi))] as const,
      ),
    }),
    market({
      id: 'any-above', family: 'high-low', name: 'At least one card above / below X', refs: [17],
      description: 'At least one card strictly above (or below) the chosen rank.',
      selections: [
        ['above-J', 'At least one above J (Q, K or A)', (f) => has(f, (r) => r > 11)],
        ['below-5', 'At least one below 5 (2, 3 or 4)', (f) => has(f, (r) => r < 5)],
      ],
    }),
    market({
      id: 'high-count', family: 'high-low', name: 'Number of high cards (J or higher)', refs: [18], exhaustive: true,
      description: 'Exactly N cards ranked J, Q, K or A.',
      selections: [0, 1, 2, 3].map((n) => [`${n}`, `Exactly ${n} J-or-higher`, (f: Flop) => count(f, (r) => r >= 11) === n] as const),
    }),
    market({
      id: 'highest-card', family: 'high-low', name: 'Highest card', refs: [19], exhaustive: true,
      description: 'The rank of the highest card on the flop (ace is high).',
      selections: [
        ['le-8', '8 or lower', (f) => f.ranks[2] <= 8],
        ...([9, 10, 11, 12, 13, 14] as Rank[]).map((x) => [`${R(x)}`, `${R(x)} high`, (f: Flop) => f.ranks[2] === x] as const),
      ],
    }),
    market({
      id: 'lowest-card', family: 'high-low', name: 'Lowest card', refs: [20], exhaustive: true,
      description: 'The rank of the lowest card on the flop (ace is high).',
      selections: [
        ...([2, 3, 4, 5, 6] as Rank[]).map((x) => [`${R(x)}`, `Lowest card ${R(x)}`, (f: Flop) => f.ranks[0] === x] as const),
        ['ge-7', 'Lowest card 7 or higher', (f) => f.ranks[0] >= 7],
      ],
    }),
  );

  // D. Face cards and named ranks
  m.push(
    market({
      id: 'face-count', family: 'face-named', name: 'Number of face cards', refs: [21, 22, 23], firstRelease: true, exhaustive: true,
      description: 'Exactly N face cards (J, Q, K). Three = "all images".',
      selections: [0, 1, 2, 3].map((n) => [`${n}`, n === 3 ? 'All face cards (3)' : `Exactly ${n} face card${n === 1 ? '' : 's'}`, (f: Flop) => f.faceCount === n] as const),
    }),
    market({
      id: 'ace-count', family: 'face-named', name: 'Number of aces', refs: [24, 25, 26], exhaustive: true,
      description: 'Exactly N aces on the flop.',
      selections: [0, 1, 2, 3].map((n) => [`${n}`, `Exactly ${n} ace${n === 1 ? '' : 's'}`, (f: Flop) => count(f, (r) => r === 14) === n] as const),
    }),
    market({
      id: 'any-ace', family: 'face-named', name: 'Any ace', refs: [24, 25], exhaustive: true,
      description: 'At least one ace / no ace.',
      selections: [
        ['yes', 'At least one ace', (f) => has(f, (r) => r === 14)],
        ['no', 'No ace', (f) => !has(f, (r) => r === 14)],
      ],
    }),
    market({
      id: 'contains-rank', family: 'face-named', name: 'Contains a named rank', refs: [27],
      description: 'At least one card of the chosen rank.',
      selections: RANKS.map((r) => [`${R(r)}`, `Contains a ${R(r)}`, (f: Flop) => has(f, (x) => x === r)] as const),
    }),
    market({
      id: 'contains-card', family: 'face-named', name: 'Contains an exact card', refs: [28],
      description: 'The chosen card is one of the three flop cards.',
      selections: DECK.map((c) => [formatCard(c), `Contains ${formatCard(c)}`, (f: Flop) => f.cards.some((x) => x.id === c.id)] as const),
    }),
    market({
      id: 'broadway', family: 'face-named', name: 'All Broadway', refs: [29],
      description: 'Every card is 10, J, Q, K or A.',
      selections: [['yes', 'All Broadway', (f) => f.cards.every(isBroadway)]],
    }),
    market({
      id: 'ace-king', family: 'face-named', name: 'Ace and King', refs: [30],
      description: 'The flop contains at least one ace and at least one king.',
      selections: [['yes', 'Contains A and K', (f) => has(f, (r) => r === 14) && has(f, (r) => r === 13)]],
    }),
  );

  // E. Sequences and gaps
  m.push(
    market({
      id: 'straight', family: 'sequences', name: 'Three-card straight', refs: [31],
      description: 'Three consecutive distinct ranks. A-2-3 and Q-K-A count; K-A-2 does not.',
      selections: [['yes', 'Straight', isSequence]],
    }),
    market({
      id: 'straight-flush', family: 'sequences', name: 'Three-card straight flush', refs: [32],
      description: 'Three consecutive ranks, all of the same suit.',
      selections: [['yes', 'Straight flush', (f) => isSequence(f) && f.distinctSuits === 1]],
    }),
    market({
      id: 'connected', family: 'sequences', name: 'Connected ranks', refs: [33, 34], exhaustive: true,
      description: 'Whether any two cards are adjacent in rank (A is adjacent to K and 2).',
      selections: [
        ['yes', 'At least two adjacent ranks', hasAdjacentRanks],
        ['no', 'No adjacent ranks', (f) => !hasAdjacentRanks(f)],
      ],
    }),
    market({
      id: 'one-gapper', family: 'sequences', name: 'One-gap sequence', refs: [35],
      description: 'Three distinct ranks spanning four ranks with one gap, e.g. 5-6-8 or 5-7-8 (ace high only).',
      selections: [['yes', 'One-gap run', (f) => f.distinctRanks === 3 && span(f) === 3]],
    }),
    market({
      id: 'exact-straight', family: 'sequences', name: 'Exact straight', refs: [36],
      description: 'The flop ranks are exactly the chosen consecutive set, any suits.',
      selections: [
        ['A23', 'Exactly A-2-3', (f) => f.ranks[0] === 2 && f.ranks[1] === 3 && f.ranks[2] === 14],
        ...([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as Rank[]).map((lo) => {
          const key = `${R(lo)}${R((lo + 1) as Rank)}${R((lo + 2) as Rank)}`;
          return [key, `Exactly ${R(lo)}-${R((lo + 1) as Rank)}-${R((lo + 2) as Rank)}`,
            (f: Flop) => f.ranks[0] === lo && f.ranks[1] === lo + 1 && f.ranks[2] === lo + 2] as const;
        }),
      ],
    }),
    market({
      id: 'span', family: 'sequences', name: 'Rank spread (highest minus lowest)', refs: [37], exhaustive: true,
      description: 'Highest rank minus lowest rank, ace high (0 = trips, maximum 12).',
      selections: [
        ['0-4', 'Spread 0 to 4', (f) => span(f) <= 4],
        ['5-8', 'Spread 5 to 8', (f) => between(5, 8)(span(f))],
        ['9-12', 'Spread 9 to 12', (f) => span(f) >= 9],
      ],
    }),
  );

  // F. Totals and parity — rank values 2..14 (J=11, Q=12, K=13, A=14), total 6..42, mean 24.
  const ou = (line: number): SelectionSpec[] => [
    [`over-${line}`, `Over ${line}`, (f) => f.rankSum > line],
    [`under-${line}`, `Under ${line}`, (f) => f.rankSum < line],
  ];
  m.push(
    market({
      id: 'sum-24', family: 'totals-parity', name: 'Total over / under (24 loses both)', refs: [38], firstRelease: true, exhaustive: true,
      description: 'Rank total over 24 or under 24. A total of exactly 24 (5.9%) loses both sides; it can be backed separately.',
      selections: [
        ['over', 'Over 24 (25+)', (f) => f.rankSum > 24],
        ['under', 'Under 24 (23-)', (f) => f.rankSum < 24],
        ['exactly', 'Exactly 24', (f) => f.rankSum === 24],
      ],
    }),
    market({ id: 'sum-20.5', family: 'totals-parity', name: 'Total over / under 20.5', refs: [38], exhaustive: true, description: 'Rank total line 20.5.', selections: ou(20.5) }),
    market({ id: 'sum-28.5', family: 'totals-parity', name: 'Total over / under 28.5', refs: [38], exhaustive: true, description: 'Rank total line 28.5.', selections: ou(28.5) }),
    market({
      id: 'sum-band', family: 'totals-parity', name: 'Total band', refs: [39], exhaustive: true,
      description: 'Rank total within the inclusive band.',
      selections: ([[6, 15], [16, 20], [21, 23], [24, 24], [25, 27], [28, 32], [33, 42]] as const).map(
        ([lo, hi]) => [`${lo}-${hi}`, lo === hi ? `Exactly ${lo}` : `${lo} to ${hi}`, (f: Flop) => between(lo, hi)(f.rankSum)] as const,
      ),
    }),
    market({
      id: 'sum-exact', family: 'totals-parity', name: 'Exact total', refs: [40], exhaustive: true,
      description: 'Rank total equals the chosen number (6..42). Extreme totals are too rare to offer.',
      selections: Array.from({ length: 37 }, (_, i) => i + 6).map((t) => [`${t}`, `Total ${t}`, (f: Flop) => f.rankSum === t] as const),
    }),
    market({
      id: 'sum-parity', family: 'totals-parity', name: 'Total odd / even', refs: [41, 42], exhaustive: true,
      description: 'Parity of the rank total.',
      selections: [
        ['odd', 'Odd total', (f) => f.rankSum % 2 === 1],
        ['even', 'Even total', (f) => f.rankSum % 2 === 0],
      ],
    }),
    market({
      id: 'odd-count', family: 'totals-parity', name: 'Number of odd-ranked cards', refs: [43], exhaustive: true,
      description: 'Exactly N cards with an odd rank value (3, 5, 7, 9, J=11, K=13).',
      selections: [0, 1, 2, 3].map((n) => [`${n}`, `Exactly ${n} odd`, (f: Flop) => f.cards.filter(isOddRank).length === n] as const),
    }),
  );

  // G. Combined conditions — priced on their joint probability, never as a product of parts.
  m.push(
    market({
      id: 'combo', family: 'combined', name: 'Combined conditions', refs: [44, 45, 46],
      description: 'Both conditions must hold. Probabilities are counted jointly over all flops.',
      selections: [
        ['pair-all-red', 'Pair and all red', (f) => f.distinctRanks === 2 && f.redCount === 3],
        ['rainbow-below-9', 'Rainbow and all below 9', (f) => f.distinctSuits === 3 && all(f, (r) => r < 9)],
        ['straight-rainbow', 'Straight and rainbow', (f) => isSequence(f) && f.distinctSuits === 3],
        ['monotone-face', 'Monotone with a face card', (f) => f.distinctSuits === 1 && f.faceCount > 0],
        ['pair-face', 'Pair and at least one face card', (f) => f.distinctRanks === 2 && f.faceCount > 0],
      ],
    }),
  );

  // Guard against accidental id collisions — ids are API contracts.
  const ids = new Set<string>();
  for (const mk of m)
    for (const s of mk.selections) {
      if (ids.has(s.id)) throw new Error(`duplicate selection id ${s.id}`);
      ids.add(s.id);
    }
  return Object.freeze(m);
}

export const MARKETS: readonly Market[] = build();

export const SELECTIONS: readonly Selection[] = MARKETS.flatMap((m) => m.selections);

const byId = new Map(SELECTIONS.map((s) => [s.id, s]));

export function getSelection(id: string): Selection {
  const s = byId.get(id);
  if (!s) throw new RangeError(`unknown selection: ${id}`);
  return s;
}

