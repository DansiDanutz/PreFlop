import { describe, expect, it } from 'vitest';
import { type CardGuess, type Point, bestMatch, cardLike, indexBands, inkRuns, isRedInk, orderCorners, pickFlop, portraitCorners } from './vision.ts';

const quad = (x: number, y: number, w: number, h: number): [Point, Point, Point, Point] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const guess = (card: string, confidence: number, x: number): CardGuess => ({ card, confidence, corners: quad(x, 100, 70, 100) });

describe('card recognition helpers (docs/19)', () => {
  it('orders four corners top-left, top-right, bottom-right, bottom-left whatever order they came in', () => {
    const shuffled = [{ x: 170, y: 200 }, { x: 100, y: 100 }, { x: 100, y: 200 }, { x: 170, y: 100 }];
    expect(orderCorners(shuffled)).toEqual([{ x: 100, y: 100 }, { x: 170, y: 100 }, { x: 170, y: 200 }, { x: 100, y: 200 }]);
    // a slightly rotated card
    const tilted = [{ x: 110, y: 95 }, { x: 180, y: 105 }, { x: 170, y: 205 }, { x: 100, y: 195 }];
    expect(orderCorners([tilted[2]!, tilted[0]!, tilted[3]!, tilted[1]!])).toEqual(tilted);
    expect(() => orderCorners(tilted.slice(0, 3))).toThrow(/four corners/);
  });

  it('accepts card proportions in portrait or landscape and rejects chips, hands and the table', () => {
    expect(cardLike(quad(0, 0, 63, 88))).toBe(true);
    expect(cardLike(quad(0, 0, 88, 63))).toBe(true);
    expect(cardLike(quad(0, 0, 80, 80))).toBe(false); // a square chip stack
    expect(cardLike(quad(0, 0, 300, 90))).toBe(false); // a banner
    expect(cardLike(quad(0, 0, 0, 0))).toBe(false);
  });

  it('turns a landscape card portrait so the index corner is read, and leaves a portrait one alone', () => {
    const portrait = quad(10, 10, 70, 100);
    expect(portraitCorners(portrait)).toEqual(portrait);
    const landscape = quad(10, 10, 100, 70);
    const turned = portraitCorners(landscape);
    expect(turned).toEqual([landscape[3], landscape[0], landscape[1], landscape[2]]);
    expect(cardLike(turned)).toBe(true);
  });

  it('pickFlop: the three best distinct cards, left to right, or nothing when fewer than three are sure', () => {
    const g = [guess('Kd', 0.9, 400), guess('Ah', 0.8, 100), guess('7c', 0.7, 250), guess('Ah', 0.5, 105), guess('2s', 0.3, 600)];
    expect(pickFlop(g)).toEqual(['Ah', '7c', 'Kd']); // the duplicate Ah is one card, 2s is below the bar
    expect(pickFlop([guess('Ah', 0.9, 1), guess('Kd', 0.9, 2)])).toEqual([]);
    expect(pickFlop([guess('Ah', 0.9, 1), guess('Kd', 0.9, 2), guess('7c', 0.4, 3)])).toEqual([]);
    // four sure cards: the three most confident, then by position
    expect(pickFlop([guess('Ah', 0.9, 300), guess('Kd', 0.95, 100), guess('7c', 0.6, 200), guess('2s', 0.5, 50)])).toEqual(['Kd', '7c', 'Ah']);
  });

  it('inkRuns and indexBands find the rank glyph over the suit pip', () => {
    //                 rank ink 2..7        gap     pip ink 10..14       speck
    const rows = [0, 0, 5, 9, 9, 8, 3, 0, 0, 0, 4, 7, 7, 4, 0, 0, 1, 0];
    expect(inkRuns(rows, 2)).toEqual([[2, 7], [10, 14]]); // the 1-row speck is ignored
    expect(inkRuns(rows, 1)).toEqual([[2, 7], [10, 14], [16, 17]]);
    expect(indexBands(inkRuns(rows, 1))).toEqual({ rank: [2, 7], suit: [10, 14] });
    expect(indexBands([[2, 7]])).toBeNull();
  });

  it('red ink is clearly redder than green and blue; grey or black is not', () => {
    expect(isRedInk({ r: 180, g: 40, b: 50 })).toBe(true);
    expect(isRedInk({ r: 60, g: 60, b: 60 })).toBe(false);
    expect(isRedInk({ r: 120, g: 110, b: 100 })).toBe(false); // a shadow on white
  });

  it('bestMatch picks the highest finite score', () => {
    const t = (code: string) => ({ code });
    expect(bestMatch([{ template: t('A'), score: 0.4 }, { template: t('K'), score: NaN }, { template: t('Q'), score: 0.7 }])?.template.code).toBe('Q');
    expect(bestMatch([])).toBeNull();
  });
});
