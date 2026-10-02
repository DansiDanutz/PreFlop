import { describe, expect, it } from 'vitest';
import { DECK, formatCard, parseCard } from '../src/cards.ts';
import { ALL_FLOPS, FLOP_COUNT, flopFromCards, flopIndex } from '../src/flops.ts';

describe('deck and flops', () => {
  it('has 52 unique cards that round-trip through text', () => {
    expect(DECK).toHaveLength(52);
    expect(new Set(DECK.map(formatCard)).size).toBe(52);
    for (const c of DECK) expect(parseCard(formatCard(c))).toBe(c);
    expect(parseCard('10h')).toBe(parseCard('Th'));
  });

  it('enumerates exactly C(52,3) = 22,100 distinct flops', () => {
    expect(FLOP_COUNT).toBe(22100);
    expect(ALL_FLOPS).toHaveLength(22100);
    const keys = new Set(ALL_FLOPS.map((f) => f.cards.map((c) => c.id).join(',')));
    expect(keys.size).toBe(22100);
  });

  it('flopIndex is a bijection, independent of dealing order', () => {
    ALL_FLOPS.forEach((f, i) => {
      expect(f.index).toBe(i);
      const [a, b, c] = f.cards.map((x) => x.id) as [number, number, number];
      expect(flopIndex([a, b, c])).toBe(i);
      expect(flopIndex([c, a, b])).toBe(i);
    });
    const f = flopFromCards([parseCard('Kd'), parseCard('2s'), parseCard('Ah')]);
    expect(f.ranks).toEqual([2, 13, 14]);
  });

  it('rejects duplicate cards', () => {
    expect(() => flopIndex([3, 3, 7])).toThrow();
  });
});
