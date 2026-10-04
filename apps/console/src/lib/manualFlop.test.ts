import { describe, expect, it } from 'vitest';
import { RANKS, SUITS, cardLabel, scaledSize, secondsLeft, splitDataUrl, toggleCard } from './manualFlop.ts';

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
  it('scales a webcam frame to at most 1280 px on the long side', () => {
    expect(scaledSize(1920, 1080)).toEqual({ width: 1280, height: 720 });
    expect(scaledSize(640, 480)).toEqual({ width: 640, height: 480 });
  });
  it('splits a canvas data URL into what the API takes', () => {
    expect(splitDataUrl('data:image/jpeg;base64,/9j/4AAQ==')).toEqual({ mediaType: 'image/jpeg', base64: '/9j/4AAQ==' });
    expect(splitDataUrl('data:text/plain;base64,QUJD')).toBeNull();
  });
});
