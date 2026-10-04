import { describe, expect, it } from 'vitest';
import { RANKS, SUITS, cardLabel, secondsLeft, toggleCard } from './manualFlop.ts';

describe('manual flop picker', () => {
  it('offers the 52 cards', () => {
    expect(RANKS.length * SUITS.length).toBe(52);
  });
  it('picks up to three distinct cards and unpicks on a second tap', () => {
    let p: string[] = [];
    for (const c of ['Ah', 'Kd', '7c', '2s']) p = toggleCard(p, c);
    expect(p).toEqual(['Ah', 'Kd', '7c']);
    expect(toggleCard(p, 'Kd')).toEqual(['Ah', '7c']);
  });
  it('labels cards with their suit symbol', () => {
    expect(cardLabel('Td')).toBe('10♦');
    expect(cardLabel('As')).toBe('A♠');
  });
  it('counts down to the result deadline', () => {
    const locked = '2026-10-04T10:00:00.000Z';
    expect(secondsLeft(locked, 300_000, Date.parse('2026-10-04T10:01:00.000Z'))).toBe(240);
    expect(secondsLeft(locked, 300_000, Date.parse('2026-10-04T11:00:00.000Z'))).toBe(0);
    expect(secondsLeft(null, 300_000)).toBeNull();
  });
});
