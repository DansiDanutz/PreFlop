import { describe, expect, it } from 'vitest';
import { MARKETS, SELECTIONS } from '../src/markets.ts';
import { statsFor } from '../src/probability.ts';

/**
 * Independent expected win counts for EVERY selection in the catalogue.
 *
 * Nothing here calls a src predicate or the src flop enumeration. The numbers come from
 * the rules as written in docs/03-market-rules.md, by three separate routes:
 *
 *  1. CLOSED FORMS: binomial coefficients and inclusion–exclusion, one formula per selection
 *     (the `closedForm` table below). This is the authoritative expectation.
 *  2. RANK MULTISETS: for rules that only look at ranks, a deliberately different brute force
 *     iterates rank triples a ≤ b ≤ c (455 multisets) and weights each by the number of suit
 *     choices, Π C(4, multiplicity). Must agree with route 1.
 *  3. GENERATING FUNCTION: rank-total counts are the coefficient of y³xᵗ in
 *     Π_{r=2..14} (1 + y·xʳ)⁴, computed by a subset DP over 52 cards. Must agree with route 2.
 *
 * Only `statsFor(...).wins` (the production enumeration) is compared against these.
 */

// ---------- independent arithmetic ----------

function C(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

const TOTAL = C(52, 3); // 22,100
const RANK_VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const CH: Record<number, string> = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SUIT_KEYS = ['s', 'h', 'd', 'c'];
const range = (lo: number, hi: number): number[] => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
const sumOf = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Route 2: Σ over rank multisets a ≤ b ≤ c of Π C(4, multiplicity), restricted to `rule`. */
function byRanks(rule: (a: number, b: number, c: number) => boolean): number {
  let n = 0;
  for (const a of RANK_VALUES)
    for (const b of RANK_VALUES.filter((x) => x >= a))
      for (const c of RANK_VALUES.filter((x) => x >= b)) {
        if (!rule(a, b, c)) continue;
        if (a === c) n += C(4, 3);
        else if (a === b || b === c) n += C(4, 2) * C(4, 1);
        else n += 4 * 4 * 4;
      }
  return n;
}

/** Route 3: sumCount[t] = number of 3-card subsets of the deck with rank total t. */
const sumCount: number[] = (() => {
  // dp[k][t] = number of k-card subsets seen so far with rank total t
  const dp = Array.from({ length: 4 }, () => new Array<number>(43).fill(0));
  dp[0]![0] = 1;
  for (const r of RANK_VALUES)
    for (let copy = 0; copy < 4; copy++)
      for (let k = 3; k >= 1; k--)
        for (let t = 42; t >= r; t--) dp[k]![t]! += dp[k - 1]![t - r]!;
  return dp[3]!;
})();
const sumIn = (lo: number, hi: number): number => sumOf(range(Math.max(lo, 0), Math.min(hi, 42)).map((t) => sumCount[t]!));

// ---------- route 1: closed forms ----------

const closedForm: Record<string, number> = {};
const put = (id: string, n: number): void => {
  if (id in closedForm) throw new Error(`duplicate expectation ${id}`);
  closedForm[id] = n;
};

// Building blocks.
const TRIPS = 13 * C(4, 3); // rank, then 3 of its 4 suits = 52
const PAIR = 13 * C(4, 2) * 48; // paired rank, 2 of 4 suits, kicker from the 48 other-rank cards = 3,744
const NO_PAIR = C(13, 3) * 4 ** 3; // 3 distinct ranks, any suit each = 18,304
const SEQ_SETS = 12; // A23, 234, …, QKA (no wrap-around)
const STRAIGHT = SEQ_SETS * 4 ** 3; // 768
const STRAIGHT_FLUSH = SEQ_SETS * 4; // 48
const MONOTONE = 4 * C(13, 3); // 1,144 (a monotone flop always has three distinct ranks)
const PAIR_OF_ONE_RANK = C(4, 2) * 48; // 288

// A. Rank patterns
put('rank-pattern:no-pair', NO_PAIR);
put('rank-pattern:pair', PAIR);
put('rank-pattern:trips', TRIPS);
// hand-class: classes are disjoint. Straight flush is taken out of both flush and straight.
put('hand-class:trips', TRIPS);
put('hand-class:pair', PAIR);
put('hand-class:straight-flush', STRAIGHT_FLUSH);
put('hand-class:flush', MONOTONE - STRAIGHT_FLUSH); // 4 · (C(13,3) − 12) = 1,096
put('hand-class:straight', STRAIGHT - STRAIGHT_FLUSH); // 12 · (4³ − 4) = 720
put('hand-class:high-card', (C(13, 3) - SEQ_SETS) * (4 ** 3 - 4)); // non-sequence rank sets × not-all-one-suit = 16,440
put('paired-board:yes', PAIR + TRIPS);
put('paired-board:no', NO_PAIR);
for (const r of RANK_VALUES) put(`pair-of-rank:${CH[r]}`, PAIR_OF_ONE_RANK);
put('pair-height:low', 6 * PAIR_OF_ONE_RANK); // 2..7
put('pair-height:mid', 3 * PAIR_OF_ONE_RANK); // 8..10
put('pair-height:high', 4 * PAIR_OF_ONE_RANK); // J..A
// Kicker in {J,Q,K}, kicker rank ≠ paired rank: 10 non-face paired ranks × 6 × 12 kickers + 3 face paired ranks × 6 × 8.
put('pair-face-kicker:yes', 10 * C(4, 2) * 12 + 3 * C(4, 2) * 8);

// B. Suits and colours
put('suit-pattern:rainbow', C(4, 3) * 13 ** 3); // pick 3 suits, any rank in each
put('suit-pattern:monotone', MONOTONE);
put('suit-pattern:two-tone', 4 * 3 * C(13, 2) * 13); // suit with 2 cards × other suit with 1 = 12,168
for (const s of SUIT_KEYS) put(`monotone-suit:${s}`, C(13, 3));
put('colour:all-red', C(26, 3));
put('colour:all-black', C(26, 3));
put('colour:mixed', TOTAL - 2 * C(26, 3));
for (const n of [0, 1, 2, 3]) put(`red-count:${n}`, C(26, n) * C(26, 3 - n));
for (const s of SUIT_KEYS) for (const n of [0, 1, 2, 3]) put(`suit-count-${s}:${n}`, C(13, n) * C(39, 3 - n));

// C. High / low. A rank x has 4 cards; "strictly below x" = ranks 2..x−1 = 4(x−2) cards.
for (const x of [6, 7, 8, 9, 10, 11]) put(`all-below:${CH[x]}`, C(4 * (x - 2), 3));
for (const x of [7, 8, 9, 10]) put(`all-above:${CH[x]}`, C(4 * (14 - x), 3)); // ranks x+1..14
for (const [lo, hi] of [[5, 9], [6, 10], [7, 11], [8, 12]] as const) put(`all-in-range:${CH[lo]}-${CH[hi]}`, C(4 * (hi - lo + 1), 3));
put('any-above:above-J', TOTAL - C(40, 3)); // complement: no Q, K or A
put('any-above:below-5', TOTAL - C(40, 3)); // complement: no 2, 3 or 4
for (const n of [0, 1, 2, 3]) put(`high-count:${n}`, C(16, n) * C(36, 3 - n)); // 16 cards J..A
// Highest card = x: all cards ≤ x minus all cards ≤ x−1.
put('highest-card:le-8', C(4 * 7, 3));
for (const x of [9, 10, 11, 12, 13, 14]) put(`highest-card:${CH[x]}`, C(4 * (x - 1), 3) - C(4 * (x - 2), 3));
// Lowest card = x: all cards ≥ x minus all cards ≥ x+1.
for (const x of [2, 3, 4, 5, 6]) put(`lowest-card:${CH[x]}`, C(4 * (15 - x), 3) - C(4 * (14 - x), 3));
put('lowest-card:ge-7', C(4 * 8, 3));

// D. Face and named ranks
for (const n of [0, 1, 2, 3]) put(`face-count:${n}`, C(12, n) * C(40, 3 - n));
for (const n of [0, 1, 2, 3]) put(`ace-count:${n}`, C(4, n) * C(48, 3 - n));
put('any-ace:yes', TOTAL - C(48, 3));
put('any-ace:no', C(48, 3));
for (const r of RANK_VALUES) put(`contains-rank:${CH[r]}`, TOTAL - C(48, 3));
for (const r of RANK_VALUES) for (const s of SUIT_KEYS) put(`contains-card:${CH[r]}${s}`, C(51, 2));
put('broadway:yes', C(20, 3));
put('ace-king:yes', TOTAL - 2 * C(48, 3) + C(44, 3)); // inclusion–exclusion on "no A" / "no K"

// E. Sequences
put('straight:yes', STRAIGHT);
put('straight-flush:yes', STRAIGHT_FLUSH);
// No two adjacent ranks. With A next to both K and 2, adjacency is a 13-cycle, so the distinct
// ranks must be an independent set on C13: 1-sets 13, 2-sets C(13,2) − 13, 3-sets 13/10 · C(10,3).
const NOT_CONNECTED = 13 * C(4, 3) + (C(13, 2) - 13) * 2 * C(4, 2) * 4 + ((13 * C(10, 3)) / 10) * 4 ** 3;
put('connected:no', NOT_CONNECTED);
put('connected:yes', TOTAL - NOT_CONNECTED);
// Distinct ranks lo < m < lo+3 (ace high): 10 windows (lo = 2..11) × 2 middle choices × 4³.
put('one-gapper:yes', 10 * 2 * 4 ** 3);
put('exact-straight:A23', 4 ** 3);
for (const lo of range(2, 12)) put(`exact-straight:${CH[lo]}${CH[lo + 1]}${CH[lo + 2]}`, 4 ** 3);
// Spread d ≥ 1: (13 − d) windows × [pair on an end: 2·C(4,2)·4 + distinct with a middle: (d − 1)·4³]; d = 0 is trips.
const spread = (d: number): number => (d === 0 ? TRIPS : (13 - d) * (2 * C(4, 2) * 4 + (d - 1) * 4 ** 3));
put('span:0-4', sumOf(range(0, 4).map(spread)));
put('span:5-8', sumOf(range(5, 8).map(spread)));
put('span:9-12', sumOf(range(9, 12).map(spread)));

// F. Totals (route 3) and parity. Ranks r ↔ 16 − r is a bijection, so total t ↔ 48 − t: over 24 = under 24.
put('sum-24:exactly', sumCount[24]!);
put('sum-24:over', (TOTAL - sumCount[24]!) / 2);
put('sum-24:under', (TOTAL - sumCount[24]!) / 2);
put('sum-20.5:over-20.5', sumIn(21, 42));
put('sum-20.5:under-20.5', sumIn(0, 20));
put('sum-28.5:over-28.5', sumIn(29, 42));
put('sum-28.5:under-28.5', sumIn(0, 28));
for (const [lo, hi] of [[6, 15], [16, 20], [21, 23], [24, 24], [25, 27], [28, 32], [33, 42]] as const) put(`sum-band:${lo}-${hi}`, sumIn(lo, hi));
for (const t of range(6, 42)) put(`sum-exact:${t}`, sumCount[t]!);
// 24 odd-ranked cards (3,5,7,9,J,K), 28 even. The total is odd iff an odd number of cards are odd-ranked.
put('sum-parity:odd', C(24, 1) * C(28, 2) + C(24, 3));
put('sum-parity:even', C(28, 3) + C(24, 2) * C(28, 1));
for (const n of [0, 1, 2, 3]) put(`odd-count:${n}`, C(24, n) * C(28, 3 - n));

// G. Combined
put('combo:pair-all-red', 13 * 1 * 24); // both red cards of the paired rank, red kicker of another rank
put('combo:rainbow-below-9', C(4, 3) * 7 ** 3); // 3 suits, one card of rank 2..8 in each
put('combo:straight-rainbow', SEQ_SETS * 4 * 3 * 2); // distinct suits on the 3 ranks
put('combo:monotone-face', MONOTONE - 4 * C(10, 3)); // minus monotone with only non-face ranks
put('combo:pair-face', PAIR - 10 * C(4, 2) * 36); // minus pairs built only from the 40 non-face cards

// ---------- route 2: rank-only rules restated on a sorted rank triple ----------

type RankRule = (a: number, b: number, c: number) => boolean;
const distinct = (a: number, b: number, c: number): number => new Set([a, b, c]).size;
const isPair: RankRule = (a, b, c) => distinct(a, b, c) === 2;
const pairRank = (a: number, b: number, c: number): number => (isPair(a, b, c) ? b : 0); // middle of a sorted pair
const kicker = (a: number, b: number, c: number): number => (isPair(a, b, c) ? (a === b ? c : a) : 0);
const isRun: RankRule = (a, b, c) => distinct(a, b, c) === 3 && (c - a === 2 || (a === 2 && b === 3 && c === 14));
const cnt = (a: number, b: number, c: number, p: (r: number) => boolean): number => [a, b, c].filter(p).length;
const adjacent: RankRule = (a, b, c) => {
  const rs = [...new Set([a, b, c])];
  return rs.some((x) => rs.some((y) => Math.abs(x - y) === 1 || Math.abs(x - y) === 12));
};

const rankRules: Record<string, RankRule> = {
  'rank-pattern:no-pair': (a, b, c) => distinct(a, b, c) === 3,
  'rank-pattern:pair': isPair,
  'rank-pattern:trips': (a, b, c) => distinct(a, b, c) === 1,
  'hand-class:trips': (a, b, c) => distinct(a, b, c) === 1,
  'hand-class:pair': isPair,
  'paired-board:yes': (a, b, c) => distinct(a, b, c) < 3,
  'paired-board:no': (a, b, c) => distinct(a, b, c) === 3,
  'pair-height:low': (a, b, c) => pairRank(a, b, c) >= 2 && pairRank(a, b, c) <= 7,
  'pair-height:mid': (a, b, c) => pairRank(a, b, c) >= 8 && pairRank(a, b, c) <= 10,
  'pair-height:high': (a, b, c) => pairRank(a, b, c) >= 11,
  'pair-face-kicker:yes': (a, b, c) => kicker(a, b, c) >= 11 && kicker(a, b, c) <= 13,
  'any-above:above-J': (_a, _b, c) => c > 11,
  'any-above:below-5': (a) => a < 5,
  'highest-card:le-8': (_a, _b, c) => c <= 8,
  'lowest-card:ge-7': (a) => a >= 7,
  'any-ace:yes': (_a, _b, c) => c === 14,
  'any-ace:no': (_a, _b, c) => c !== 14,
  'broadway:yes': (a) => a >= 10,
  'ace-king:yes': (a, b, c) => [a, b, c].includes(14) && [a, b, c].includes(13),
  'straight:yes': isRun,
  'connected:yes': adjacent,
  'connected:no': (a, b, c) => !adjacent(a, b, c),
  'one-gapper:yes': (a, b, c) => distinct(a, b, c) === 3 && c - a === 3,
  'exact-straight:A23': (a, b, c) => a === 2 && b === 3 && c === 14,
  'span:0-4': (a, _b, c) => c - a <= 4,
  'span:5-8': (a, _b, c) => c - a >= 5 && c - a <= 8,
  'span:9-12': (a, _b, c) => c - a >= 9,
  'sum-24:over': (a, b, c) => a + b + c > 24,
  'sum-24:under': (a, b, c) => a + b + c < 24,
  'sum-24:exactly': (a, b, c) => a + b + c === 24,
  'sum-20.5:over-20.5': (a, b, c) => a + b + c > 20.5,
  'sum-20.5:under-20.5': (a, b, c) => a + b + c < 20.5,
  'sum-28.5:over-28.5': (a, b, c) => a + b + c > 28.5,
  'sum-28.5:under-28.5': (a, b, c) => a + b + c < 28.5,
  'sum-parity:odd': (a, b, c) => (a + b + c) % 2 === 1,
  'sum-parity:even': (a, b, c) => (a + b + c) % 2 === 0,
};
for (const r of RANK_VALUES) {
  rankRules[`pair-of-rank:${CH[r]}`] = (a, b, c) => pairRank(a, b, c) === r;
  rankRules[`contains-rank:${CH[r]}`] = (a, b, c) => [a, b, c].includes(r);
}
for (const x of [6, 7, 8, 9, 10, 11]) rankRules[`all-below:${CH[x]}`] = (_a, _b, c) => c < x;
for (const x of [7, 8, 9, 10]) rankRules[`all-above:${CH[x]}`] = (a) => a > x;
for (const [lo, hi] of [[5, 9], [6, 10], [7, 11], [8, 12]] as const) rankRules[`all-in-range:${CH[lo]}-${CH[hi]}`] = (a, _b, c) => a >= lo && c <= hi;
for (const n of [0, 1, 2, 3]) {
  rankRules[`high-count:${n}`] = (a, b, c) => cnt(a, b, c, (r) => r >= 11) === n;
  rankRules[`face-count:${n}`] = (a, b, c) => cnt(a, b, c, (r) => r >= 11 && r <= 13) === n;
  rankRules[`ace-count:${n}`] = (a, b, c) => cnt(a, b, c, (r) => r === 14) === n;
  rankRules[`odd-count:${n}`] = (a, b, c) => cnt(a, b, c, (r) => r % 2 === 1) === n;
}
for (const x of [9, 10, 11, 12, 13, 14]) rankRules[`highest-card:${CH[x]}`] = (_a, _b, c) => c === x;
for (const x of [2, 3, 4, 5, 6]) rankRules[`lowest-card:${CH[x]}`] = (a) => a === x;
for (const lo of range(2, 12)) rankRules[`exact-straight:${CH[lo]}${CH[lo + 1]}${CH[lo + 2]}`] = (a, b, c) => a === lo && b === lo + 1 && c === lo + 2;
for (const [lo, hi] of [[6, 15], [16, 20], [21, 23], [24, 24], [25, 27], [28, 32], [33, 42]] as const)
  rankRules[`sum-band:${lo}-${hi}`] = (a, b, c) => a + b + c >= lo && a + b + c <= hi;
for (const t of range(6, 42)) rankRules[`sum-exact:${t}`] = (a, b, c) => a + b + c === t;

// ---------- tests ----------

describe('independent expected counts', () => {
  it('cover every selection in the catalogue, and nothing else', () => {
    const ids = SELECTIONS.map((s) => s.id).sort();
    expect(Object.keys(closedForm).sort()).toEqual(ids);
    expect(ids.length).toBe(250);
  });

  it('closed forms of exhaustive markets add up to 22,100', () => {
    for (const m of MARKETS.filter((x) => x.exhaustive))
      expect(sumOf(m.selections.map((s) => closedForm[s.id]!)), m.id).toBe(TOTAL);
  });

  it('rank-multiset brute force agrees with the closed forms', () => {
    expect(byRanks(() => true)).toBe(TOTAL);
    for (const [id, rule] of Object.entries(rankRules)) expect(byRanks(rule), id).toBe(closedForm[id]);
  });

  it('generating-function totals agree with the rank-multiset brute force', () => {
    for (const t of range(0, 42)) expect(sumCount[t], `total ${t}`).toBe(byRanks((a, b, c) => a + b + c === t));
    // Hand checks: 6 = 2-2-2 → C(4,3); 7 = 2-2-3 → C(4,2)·4; 42 mirrors 6.
    expect([sumCount[6], sumCount[7], sumCount[24], sumCount[42]]).toEqual([4, 24, 1300, 4]);
  });

  it.each(SELECTIONS.map((s) => [s.id, s] as const))('%s matches its independent count', (id, s) => {
    expect(statsFor(s).wins).toBe(closedForm[id]);
  });

  it('spot values of the closed forms', () => {
    expect(closedForm['hand-class:high-card']).toBe(16440);
    expect(closedForm['hand-class:flush']).toBe(1096);
    expect(closedForm['hand-class:straight']).toBe(720);
    expect(closedForm['pair-face-kicker:yes']).toBe(864);
    expect(closedForm['connected:no']).toBe(13156);
    expect(closedForm['one-gapper:yes']).toBe(1280);
    expect(closedForm['combo:pair-all-red']).toBe(312);
    expect(closedForm['combo:monotone-face']).toBe(664);
    expect(closedForm['combo:pair-face']).toBe(1584);
    expect(closedForm['sum-parity:odd']).toBe(11096);
    expect(closedForm['ace-king:yes']).toBe(752);
  });
});
