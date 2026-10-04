import { describe, expect, it } from 'vitest';
import { type CardGuess, type Point, bestMatch, cardLike, crownAgreement, runnerUpMargin, indexBands, inkRuns, isRedInk, orderCorners, pickFlop, portraitCorners } from './vision.ts';

const quad = (x: number, y: number, w: number, h: number): [Point, Point, Point, Point] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const guess = (card: string, confidence: number, x: number): CardGuess => ({ card, confidence, margin: 0.2, corners: quad(x, 100, 70, 100) });

describe('card recognition helpers (docs/19)', () => {
  it('crownAgreement: a tilted spade silhouette is clearly closer to the spade than to the club; a heart to the heart', () => {
    // Ink widths per row (share of 32 px), dumped from the reader on the tilted 10♠ and from the Inter templates.
    const w = (a: number[]) => a.map((n) => n / 32);
    const sample = w([3, 4, 5, 7, 9, 10, 12, 14, 18, 20, 22, 26, 28, 29, 30, 32, 32, 32, 32, 32, 30, 28, 24, 9, 4, 4, 6, 6, 12, 15, 25, 22]);
    const spade = w([2, 2, 4, 4, 8, 9, 10, 12, 16, 18, 21, 23, 26, 29, 30, 31, 32, 32, 32, 32, 32, 32, 30, 26, 20, 4, 5, 8, 10, 15, 21, 27]);
    const club = w([8, 10, 12, 14, 14, 16, 16, 16, 16, 14, 24, 28, 30, 32, 32, 32, 32, 32, 32, 32, 32, 32, 30, 26, 20, 5, 6, 8, 10, 14, 20, 22]);
    const toSpade = crownAgreement(sample, spade), toClub = crownAgreement(sample, club);
    expect(toSpade).toBeGreaterThan(0.9);
    expect(toSpade - toClub).toBeGreaterThan(0.05);
    // a heart starts widest (two lobes), a diamond from a point
    const heart = w([26, 28, 30, 30, 30, 30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2]);
    const diamond = w([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2, 1]);
    const heartish = w([24, 27, 29, 30, 30, 29, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2]);
    expect(crownAgreement(heartish, heart)).toBeGreaterThan(crownAgreement(heartish, diamond) + 0.3);
    // identical silhouettes agree fully; the result is clamped to 0..1
    expect(crownAgreement(spade, spade)).toBe(1);
    expect(crownAgreement([1, 1, 1, 1, 1], [0, 0, 0, 0, 0])).toBe(0);
  });

  it('runnerUpMargin: the gap to the second-best score, 0 when there is no runner-up', () => {
    expect(runnerUpMargin([{ score: 0.9 }, { score: 0.6 }, { score: 0.2 }])).toBeCloseTo(0.3);
    expect(runnerUpMargin([{ score: 0.9 }])).toBe(0);
    expect(runnerUpMargin([{ score: 0.9 }, { score: NaN }])).toBe(0);
    expect(runnerUpMargin([{ score: 0.5 }, { score: 0.5 }])).toBe(0);
  });

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
