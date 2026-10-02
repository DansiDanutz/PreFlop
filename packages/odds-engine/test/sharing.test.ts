import { describe, expect, it } from 'vitest';
import {
  CLUB_POLICY, PARTNER_POLICY, type SharePolicy, computeShare, computeStatement, maxAffordableShare, tierBps,
} from '../src/sharing.ts';

const tiers = [{ from: 0, bps: 1000 }, { from: 100, bps: 2000 }, { from: 300, bps: 3000 }];

describe('tier ladders', () => {
  it('whole-volume applies the highest tier reached', () => {
    expect(tierBps(0, tiers, 'whole-volume')).toBe(1000);
    expect(tierBps(99, tiers, 'whole-volume')).toBe(1000);
    expect(tierBps(100, tiers, 'whole-volume')).toBe(2000);
    expect(tierBps(1000, tiers, 'whole-volume')).toBe(3000);
  });

  it('progressive equals the volume-weighted sum of its bands (no cliffs)', () => {
    // 100 @10% + 200 @20% + 100 @30% over 400
    expect(tierBps(400, tiers, 'progressive')).toBeCloseTo((100 * 1000 + 200 * 2000 + 100 * 3000) / 400, 10);
    expect(tierBps(50, tiers, 'progressive')).toBe(1000);
    // continuous across a boundary
    expect(tierBps(100.0001, tiers, 'progressive') - tierBps(100, tiers, 'progressive')).toBeLessThan(0.01);
  });

  it('rejects malformed ladders', () => {
    expect(() => tierBps(1, [{ from: 5, bps: 1 }], 'whole-volume')).toThrow();
    expect(() => tierBps(1, [{ from: 0, bps: 1 }, { from: 0, bps: 2 }], 'whole-volume')).toThrow();
  });
});

describe('dynamic shares', () => {
  it('a club with 100 players and 20k hands earns content + distribution', () => {
    const s = computeShare(CLUB_POLICY, { handsDealt: 20_000, activePlayers: 100 });
    expect(s.components.distribution).toBe(1500);
    expect(s.components.content).toBeCloseTo((10_000 * 500 + 10_000 * 800) / 20_000, 10);
    expect(s.bps).toBeCloseTo(1500 + 650, 10);
  });

  it('more players and hands means a bigger share, but never above the cap', () => {
    const small = computeShare(CLUB_POLICY, { handsDealt: 20_000, activePlayers: 100 }).bps;
    const big = computeShare(CLUB_POLICY, { handsDealt: 100_000, activePlayers: 5000 }).bps;
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThanOrEqual(CLUB_POLICY.capBps);
  });

  it('partner share grows with turnover', () => {
    const lo = computeShare(PARTNER_POLICY, { turnoverMinor: 50_000_000 }).bps;
    const hi = computeShare(PARTNER_POLICY, { turnoverMinor: 5_000_000_000 }).bps;
    expect(lo).toBe(2000);
    expect(hi).toBeGreaterThan(3000);
  });
});

describe('statements', () => {
  const greedy: SharePolicy = { id: 'g', description: '', base: 'ggr', floorBps: 0, capBps: 10000,
    components: [{ name: 'x', metric: 'activePlayers', mode: 'whole-volume', tiers: [{ from: 0, bps: 9000 }] }] };

  it('allocates every unit exactly once', () => {
    const st = computeStatement({ revenueMinor: 1_000_003, turnoverMinor: 10_000_000, parties: [
      { party: 'Club', policy: CLUB_POLICY, metrics: { handsDealt: 20_000, activePlayers: 100 } },
      { party: 'Partner', policy: PARTNER_POLICY, metrics: { turnoverMinor: 10_000_000 } },
    ] });
    const sum = [...st.amounts.values()].reduce((a, b) => a + b, 0) + st.preflopMinor;
    expect(sum).toBe(1_000_003);
  });

  it('guardrail caps shares so PreFlop keeps its net target', () => {
    const turnover = 100_000_000;
    const ggr = 7_000_000; // 7% edge
    const g = { promotionsShare: 0.1, turnoverCostRate: 0.01, netTarget: 0.025 };
    const st = computeStatement({ revenueMinor: ggr, turnoverMinor: turnover, parties: [{ party: 'Greedy', policy: greedy, metrics: {} }], guardrail: g });
    expect(st.capped).toBe(true);
    expect(st.appliedShare).toBeCloseTo(maxAffordableShare(0.07, 0.1, 0.01, 0.025), 10);
    const preflopNet = st.preflopMinor - ggr * g.promotionsShare - turnover * g.turnoverCostRate;
    expect(preflopNet).toBeGreaterThanOrEqual(turnover * g.netTarget - 2);
  });

  it('a losing month pays no shares and carries the loss forward', () => {
    const st = computeStatement({ revenueMinor: -5000, turnoverMinor: 100_000, parties: [{ party: 'Club', policy: CLUB_POLICY, metrics: {} }] });
    expect(st.amounts.get('Club')).toBe(0);
    expect(st.carryForwardMinor).toBe(5000);
    const next = computeStatement({ revenueMinor: 20_000, turnoverMinor: 200_000, carriedLossMinor: 5000, parties: [{ party: 'Club', policy: CLUB_POLICY, metrics: {} }] });
    expect(next.amounts.get('Club')! + next.preflopMinor).toBe(15_000);
  });
});
