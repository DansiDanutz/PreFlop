import { describe, expect, it } from 'vitest';
import { STABLE_READS, initialWatch, nextWatch } from './flopWatch.ts';

const feed = (reads: (string[] | null)[]) => {
  let s = initialWatch;
  let out: string[] | null = null;
  for (const r of reads) { const n = nextWatch(s, r); s = n.state; out = n.stable ?? out; }
  return { state: s, stable: out };
};

describe('flop watch', () => {
  it(`reports a flop once the same three cards are read ${STABLE_READS} times in a row`, () => {
    const f = ['Ah', 'Kd', '7c'];
    expect(feed(Array(STABLE_READS - 1).fill(f)).stable).toBeNull();
    expect(feed(Array(STABLE_READS).fill(f)).stable).toEqual(f);
  });

  it('treats the same cards in another order as the same flop', () => {
    expect(feed([['Ah', 'Kd', '7c'], ['7c', 'Ah', 'Kd'], ['Kd', '7c', 'Ah']]).stable).toEqual(['Kd', '7c', 'Ah']);
  });

  it('starts counting again when a read differs, misses a card or sees nothing', () => {
    const f = ['Ah', 'Kd', '7c'];
    expect(feed([f, f, ['Ah', 'Kd', '7s'], f, f]).stable).toBeNull();
    expect(feed([f, f, ['Ah', 'Kd'], f, f]).stable).toBeNull();
    expect(feed([f, f, null, f, f]).stable).toBeNull();
  });

  it('reports a flop only once, even if it keeps being read', () => {
    const f = ['Ah', 'Kd', '7c'];
    let s = initialWatch;
    const reports: (string[] | null)[] = [];
    for (let i = 0; i < STABLE_READS + 3; i++) { const n = nextWatch(s, f); s = n.state; reports.push(n.stable); }
    expect(reports.filter(Boolean)).toHaveLength(1);
  });

  it('never reports the previous hand\'s flop still lying on the felt', () => {
    const old = ['Ah', 'Kd', '7c'];
    let s = initialWatch;
    for (let i = 0; i < STABLE_READS + 2; i++) {
      const n = nextWatch(s, ['7c', 'Kd', 'Ah'], old);
      expect(n.stable).toBeNull();
      s = n.state;
    }
    // the new flop is then reported as usual
    let out: string[] | null = null;
    for (let i = 0; i < STABLE_READS; i++) { const n = nextWatch(s, ['2s', '3s', '4s'], old); s = n.state; out = n.stable ?? out; }
    expect(out).toEqual(['2s', '3s', '4s']);
  });

  it('never mutates the state it is given', () => {
    const s = Object.freeze({ ...initialWatch });
    expect(() => nextWatch(s, ['Ah', 'Kd', '7c'])).not.toThrow();
  });
});
