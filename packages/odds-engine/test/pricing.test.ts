import { describe, expect, it } from 'vitest';
import { type Channel, type CostModel, DEFAULT_COST_MODEL } from '../src/costModel.ts';
import { netEdge, requiredGrossMargin } from '../src/economics.ts';
import { FLOP_COUNT } from '../src/flops.ts';
import { getSelection } from '../src/markets.ts';
import { MIN_ODDS_CENTI, floorToTick, payoutMinor, price, satisfiesMargin, tierFor } from '../src/pricing.ts';
import { allStats, statsFor } from '../src/probability.ts';

const CHANNELS: Channel[] = ['direct', 'club', 'partner'];

describe('house edge invariant', () => {
  for (const ch of CHANNELS)
    it(`every offered selection on ${ch} pays at most (1 − margin) and at least the tier floor`, () => {
      let offered = 0;
      for (const st of allStats()) {
        const p = price(st, ch);
        expect(satisfiesMargin(p), st.selection.id).toBe(true);
        if (!p.offered) continue;
        offered++;
        // exact rational check: p · odds ≤ 1 − tier floor
        expect(p.oddsCenti * st.wins * 100).toBeLessThanOrEqual((10000 - tierFor(st.probability).marginBps) * FLOP_COUNT);
        expect(p.grossEdge).toBeGreaterThan(0.05 - 1e-12);
        expect(p.oddsCenti).toBeGreaterThanOrEqual(MIN_ODDS_CENTI);
      }
      expect(offered).toBeGreaterThan(200);
    });
});

describe('net EV after costs (revenue shares, payments, KYC, promotions, ops)', () => {
  for (const ch of CHANNELS)
    it(`every offered selection on ${ch} keeps PreFlop at or above the net target`, () => {
      for (const st of allStats()) {
        const p = price(st, ch);
        if (p.offered) expect(p.netEdge, st.selection.id).toBeGreaterThanOrEqual(DEFAULT_COST_MODEL.netTargetMargin - 1e-12);
      }
    });

  it('the required margin formula matches the worked example in the docs', () => {
    const ch = { ...DEFAULT_COST_MODEL.channels.direct, revenueShares: { club: 0.4 }, promotionsShareOfGGR: 0.1,
      paymentFeeOnDeposits: 0, kycAndChargebacksPerTurnover: 0, variableOpsPerTurnover: 0.005 };
    expect(requiredGrossMargin(ch, 0.03)).toBeCloseTo(0.07, 12);
    expect(netEdge(0.07, ch)).toBeCloseTo(0.03, 12);
  });

  it('a flat 5% margin loses money once a club takes half the GGR', () => {
    expect(netEdge(0.05, DEFAULT_COST_MODEL.channels.club)).toBeLessThan(DEFAULT_COST_MODEL.netTargetMargin);
  });

  it('raising costs raises the margin and lowers the odds', () => {
    const pricey: CostModel = { ...DEFAULT_COST_MODEL, netTargetMargin: 0.06 };
    const st = statsFor(getSelection('suit-pattern:rainbow'));
    expect(price(st, 'direct', pricey).odds).toBeLessThan(price(st, 'direct').odds);
  });

  it('contest channels are never priced as fixed odds', () => {
    expect(price(statsFor(getSelection('suit-pattern:rainbow')), 'contest-user').offered).toBe(false);
  });
});

describe('ladder and payouts', () => {
  it('rounds odds down onto the ladder', () => {
    expect(floorToTick(238)).toBe(238);
    expect(floorToTick(1776)).toBe(1770);
    expect(floorToTick(39125)).toBe(39100);
  });

  it('pays in integer minor units, rounded down', () => {
    expect(payoutMinor(1000, 238)).toBe(2380);
    expect(payoutMinor(333, 215)).toBe(715); // 715.95 → 715
    expect(payoutMinor(Number.MAX_SAFE_INTEGER, 100)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('does not offer outcomes beyond the fair-odds cap', () => {
    const p = price(statsFor(getSelection('sum-exact:6')), 'direct');
    expect(p.offered).toBe(false);
  });
});
