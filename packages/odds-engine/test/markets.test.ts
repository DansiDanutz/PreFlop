import { describe, expect, it } from 'vitest';
import { parseCard } from '../src/cards.ts';
import { ALL_FLOPS, flopFromCards } from '../src/flops.ts';
import { MARKETS, getSelection } from '../src/markets.ts';
import { probabilityGivenKnown, statsFor } from '../src/probability.ts';

const wins = (id: string): number => statsFor(getSelection(id)).wins;
const flop = (...t: [string, string, string]) => flopFromCards(t.map(parseCard) as never);

describe('exact counts (hand-verified combinatorics)', () => {
  it.each([
    ['rank-pattern:pair', 3744], // 13 · C(4,2) · 48
    ['rank-pattern:trips', 52], // 13 · C(4,3)
    ['rank-pattern:no-pair', 18304], // C(13,3) · 4³
    ['suit-pattern:rainbow', 8788], // C(4,3) · 13³
    ['suit-pattern:two-tone', 12168],
    ['suit-pattern:monotone', 1144], // 4 · C(13,3)
    ['colour:all-red', 2600], // C(26,3)
    ['face-count:3', 220], // C(12,3)
    ['any-ace:yes', 4804], // 22100 − C(48,3)
    ['straight:yes', 768], // 12 rank sets · 4³
    ['straight-flush:yes', 48], // 12 · 4
    ['all-below:8', 2024], // C(24,3)
    ['sum-24:exactly', 1300],
    ['pair-of-rank:K', 288], // C(4,2) · 48
    ['contains-card:As', 1275], // C(51,2)
  ])('%s wins on %i flops', (id, n) => expect(wins(id)).toBe(n));

  it('rank total is symmetric around 24', () => {
    expect(wins('sum-24:over')).toBe(wins('sum-24:under'));
    expect(wins('sum-24:over') + wins('sum-24:under') + wins('sum-24:exactly')).toBe(22100);
  });

  it('exhaustive markets partition every flop exactly once', () => {
    for (const m of MARKETS.filter((x) => x.exhaustive))
      for (const f of ALL_FLOPS) expect(m.selections.filter((s) => s.wins(f)).length, `${m.id} on flop ${f.index}`).toBe(1);
  });
});

describe('rule edge cases', () => {
  it('ace plays low only in sequences', () => {
    expect(getSelection('straight:yes').wins(flop('As', '2d', '3c'))).toBe(true);
    expect(getSelection('straight:yes').wins(flop('Qs', 'Kd', 'Ac'))).toBe(true);
    expect(getSelection('straight:yes').wins(flop('Ks', 'Ad', '2c'))).toBe(false);
    expect(getSelection('all-below:6').wins(flop('As', '2d', '3c'))).toBe(false);
    expect(flop('As', '2d', '3c').rankSum).toBe(19);
  });

  it('trips is not a pair and a pair is not trips', () => {
    expect(getSelection('rank-pattern:pair').wins(flop('Ks', 'Kd', 'Kc'))).toBe(false);
    expect(getSelection('pair-of-rank:K').wins(flop('Ks', 'Kd', 'Kc'))).toBe(false);
    expect(getSelection('pair-of-rank:K').wins(flop('Ks', 'Kd', '2c'))).toBe(true);
  });

  it('face cards are J, Q, K only', () => {
    expect(getSelection('face-count:3').wins(flop('Js', 'Qd', 'Kc'))).toBe(true);
    expect(getSelection('face-count:3').wins(flop('Js', 'Qd', 'Ac'))).toBe(false);
  });
});

describe('information leakage (why betting closes before hole cards are dealt)', () => {
  it('one player holding two black cards gains about 12.8% on "all red"', () => {
    const sel = getSelection('colour:all-red');
    const base = statsFor(sel).probability;
    const informed = probabilityGivenKnown(sel, [parseCard('2s'), parseCard('3c')]);
    expect(informed / base).toBeCloseTo(1.128, 3);
    // …which is more than the gross margin charged on that market.
    expect(informed / base - 1).toBeGreaterThan(0.06);
  });
});
