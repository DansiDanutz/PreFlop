import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bookEdge, evaluate, organizerBookEdge } from '../src/profitability.ts';
import { SCENARIOS, evaluateAll, renderProfitabilityMarkdown } from '../src/scenarios.ts';

describe('profitability scenarios', () => {
  const results = evaluateAll();

  it.each(results.map((r) => [r.scenario.id, r] as const))('%s reconciles and passes its checks', (_id, r) => {
    expect(r.reconciles).toBe(true);
    for (const c of r.checks) expect(c.ok, c.name).toBe(true);
  });

  it('the house always has the edge in every money mode', () => {
    expect(bookEdge('direct')).toBeGreaterThan(0.05);
    expect(organizerBookEdge(300)).toBeGreaterThan(0.03);
    for (const r of results) if (r.scenario.kind !== 'play') expect(r.playersCostEUR).toBeGreaterThan(0);
  });

  it('a bigger club earns a bigger share (dynamic sharing)', () => {
    const small = results.find((r) => r.scenario.id === 'club-100')!;
    const big = results.find((r) => r.scenario.id === 'club-1000')!;
    expect(big.extra.appliedShare as number).toBeGreaterThan(small.extra.appliedShare as number);
  });

  it('PreFlop earns with zero risk when an organizer is the house', () => {
    const r = results.find((x) => x.scenario.id === 'partner-organizer-house')!;
    expect(r.house).toBe('organizer');
    expect(r.lines.find((l) => l.participant === 'PreFlop')!.eur).toBeGreaterThan(0);
  });

  it('evaluate is deterministic', () => {
    expect(evaluate(SCENARIOS[0]!)).toEqual(evaluate(SCENARIOS[0]!));
  });

  it('docs/profitability.md is up to date (run `pnpm book`)', () => {
    expect(readFileSync(new URL('../../../docs/profitability.md', import.meta.url), 'utf8')).toBe(renderProfitabilityMarkdown(results));
  });
});
