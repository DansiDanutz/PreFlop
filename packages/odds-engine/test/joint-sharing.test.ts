import { describe, expect, it } from 'vitest';
import { DEFAULT_COST_MODEL } from '../src/costModel.ts';
import { turnoverCostRate } from '../src/economics.ts';
import {
  CLUB_POLICY, PARTNER_POLICY, PROVIDER_POLICY, STABLECOIN_EUR_RATE, type Entitlement, type RevenueCell,
  carryForward, computeJointStatement, computeShare, computeStatement, tierBps, tierTurnoverEurCents,
} from '../src/sharing.ts';

const T = DEFAULT_COST_MODEL.netTargetMargin;
const ch = DEFAULT_COST_MODEL.channels;
const directCell = (id: string, revenueMinor: number, turnoverMinor: number): RevenueCell =>
  ({ id, revenueMinor, turnoverMinor, promotionsShare: ch.club.promotionsShareOfGGR, turnoverCostRate: turnoverCostRate(ch.club) });
const partnerCell = (id: string, revenueMinor: number, turnoverMinor: number): RevenueCell =>
  ({ id, revenueMinor, turnoverMinor, promotionsShare: ch.partner.promotionsShareOfGGR, turnoverCostRate: turnoverCostRate(ch.partner) });

/** PreFlop's net on a set of cells after paying `paid` in shares. */
const preflopNet = (cells: readonly RevenueCell[], paid: number) =>
  cells.reduce((a, c) => a + c.revenueMinor - c.promotionsShare * Math.max(0, c.revenueMinor) - c.turnoverCostRate * c.turnoverMinor, 0) - paid;
const turnoverOf = (cells: readonly RevenueCell[]) => cells.reduce((a, c) => a + c.turnoverMinor, 0);

describe('joint statements (club + partner on the same GGR)', () => {
  it('audit example: 100bn turnover / 5bn GGR / 100k hands / 2k players: independent statements breached the floor, the joint one does not', () => {
    const turnover = 100_000_000_000, ggr = 5_000_000_000;
    // Before: two independent statements on the same GGR, each under its own guardrail.
    const club = computeStatement({ revenueMinor: ggr, turnoverMinor: turnover, parties: [{ party: 'C', policy: CLUB_POLICY, metrics: { handsDealt: 100_000, activePlayers: 2_000 } }],
      guardrail: { promotionsShare: ch.club.promotionsShareOfGGR, turnoverCostRate: turnoverCostRate(ch.club), netTarget: T } });
    const partner = computeStatement({ revenueMinor: ggr, turnoverMinor: turnover, parties: [{ party: 'P', policy: PARTNER_POLICY, metrics: { turnoverMinor: turnover } }],
      guardrail: { promotionsShare: ch.partner.promotionsShareOfGGR, turnoverCostRate: turnoverCostRate(ch.partner), netTarget: T } });
    const oldPaid = club.amounts.get('C')! + partner.amounts.get('P')!;
    expect(club.amounts.get('C')).toBe(1_125_000_000);
    expect(partner.amounts.get('P')).toBe(1_743_500_000);
    const oldNet = ggr - oldPaid - turnoverCostRate(ch.partner) * turnover;
    expect(oldNet).toBeCloseTo(1_831_500_000, 0);
    expect(oldNet).toBeLessThan(T * turnover);

    // After: the traffic is the partner's, so the club earns the provider (content) policy, and both
    // entitlements are computed together under one cap.
    const cells = [partnerCell('C|P', ggr, turnover)];
    const st = computeJointStatement({ netTarget: T, cells, entitlements: [
      { party: 'C', policy: PROVIDER_POLICY, metrics: { handsDealt: 100_000 }, cells: ['C|P'] },
      { party: 'P', policy: PARTNER_POLICY, metrics: { turnoverMinor: tierTurnoverEurCents('EUR', turnover) }, cells: ['C|P'] },
    ] });
    const c = st.entitlements.find((e) => e.party === 'C')!, p = st.entitlements.find((e) => e.party === 'P')!;
    expect(c.rateBps).toBeCloseTo(990, 6); // content only, never the distribution tier
    expect(st.pools[0]!.capped).toBe(true);
    expect(c.amountMinor + p.amountMinor).toBeLessThanOrEqual(2_200_000_000);
    expect(c.amountMinor + p.amountMinor).toBeGreaterThanOrEqual(2_200_000_000 - 2);
    expect(preflopNet(cells, c.amountMinor + p.amountMinor)).toBeGreaterThanOrEqual(T * turnover);

    // Even if the club were (wrongly) given its full club policy on the same GGR, the joint cap still holds the floor.
    const greedy = computeJointStatement({ netTarget: T, cells, entitlements: [
      { party: 'C', policy: CLUB_POLICY, metrics: { handsDealt: 100_000, activePlayers: 2_000 }, cells: ['C|P'] },
      { party: 'P', policy: PARTNER_POLICY, metrics: { turnoverMinor: turnover }, cells: ['C|P'] },
    ] });
    expect(preflopNet(cells, greedy.pools[0]!.paidMinor)).toBeGreaterThanOrEqual(T * turnover);
  });

  it('a club with direct and partner traffic: one pool, one cap, floor kept on the combined GGR', () => {
    const cells = [directCell('C|', 2_000_000_000, 40_000_000_000), partnerCell('C|P', 3_000_000_000, 60_000_000_000)];
    const st = computeJointStatement({ netTarget: T, cells, entitlements: [
      { party: 'C', policy: CLUB_POLICY, metrics: { handsDealt: 100_000, activePlayers: 2_000 }, cells: ['C|'] },
      { party: 'C', policy: PROVIDER_POLICY, metrics: { handsDealt: 100_000 }, cells: ['C|P'] },
      { party: 'P', policy: PARTNER_POLICY, metrics: { turnoverMinor: 60_000_000_000 }, cells: ['C|P'] },
    ] });
    expect(st.pools).toHaveLength(1);
    expect(st.pools[0]!.capped).toBe(true);
    const paid = st.entitlements.reduce((a, e) => a + e.amountMinor, 0);
    expect(paid).toBe(st.pools[0]!.paidMinor);
    expect(preflopNet(cells, paid)).toBeGreaterThanOrEqual(T * turnoverOf(cells));
  });

  it('a losing partner bucket at the same club reduces the joint budget (adjustments are netted)', () => {
    const win = directCell('C|', 1_000_000, 10_000_000);
    const lose = partnerCell('C|P', -600_000, 10_000_000);
    const ents: Entitlement[] = [
      { party: 'C', policy: CLUB_POLICY, metrics: { handsDealt: 70_000, activePlayers: 600 }, cells: ['C|'] },
      { party: 'C', policy: PROVIDER_POLICY, metrics: { handsDealt: 70_000 }, cells: ['C|P'] },
      { party: 'P', policy: PARTNER_POLICY, metrics: { turnoverMinor: 10_000_000 }, cells: ['C|P'] },
    ];
    const st = computeJointStatement({ netTarget: T, cells: [win, lose], entitlements: ents });
    const paid = st.entitlements.reduce((a, e) => a + e.amountMinor, 0);
    expect(st.pools[0]!.shortfallMinor > 0 ? paid === 0 : preflopNet([win, lose], paid) >= T * 20_000_000).toBe(true);
    expect(st.entitlements.find((e) => e.policyId === 'partner')!.carryForwardMinor).toBe(600_000);
    expect(st.entitlements.find((e) => e.policyId === 'provider')!.amountMinor).toBe(0);
    // Without the losing bucket the club would have been paid more.
    const alone = computeJointStatement({ netTarget: T, cells: [win], entitlements: [ents[0]!] });
    expect(alone.entitlements[0]!.amountMinor).toBeGreaterThan(st.entitlements[0]!.amountMinor);
  });

  it('pools do not leak: an unrelated club is not capped by another partner', () => {
    const cells = [directCell('A|', 500_000, 5_000_000), partnerCell('B|P', -1_000_000, 50_000_000)];
    const st = computeJointStatement({ netTarget: T, cells, entitlements: [
      { party: 'A', policy: CLUB_POLICY, metrics: { handsDealt: 1_000, activePlayers: 30 }, cells: ['A|'] },
      { party: 'B', policy: PROVIDER_POLICY, metrics: { handsDealt: 1_000 }, cells: ['B|P'] },
      { party: 'P', policy: PARTNER_POLICY, metrics: { turnoverMinor: 50_000_000 }, cells: ['B|P'] },
    ] });
    expect(st.pools).toHaveLength(2);
    const a = st.entitlements[0]!;
    expect(a.capped).toBe(false);
    expect(a.amountMinor).toBe(Math.floor(a.nominalMinor + 1e-6));
  });

  it('rejects duplicate entitlements, unknown cells and the reserved PreFlop party', () => {
    const cells = [directCell('A|', 1, 1)];
    const e = { party: 'A', policy: CLUB_POLICY, metrics: {}, cells: ['A|'] };
    expect(() => computeJointStatement({ netTarget: T, cells, entitlements: [e, e] })).toThrow(/duplicate/);
    expect(() => computeJointStatement({ netTarget: T, cells, entitlements: [{ ...e, cells: ['X'] }] })).toThrow(/unknown cell/);
    expect(() => computeJointStatement({ netTarget: T, cells, entitlements: [{ ...e, party: 'PreFlop' }] })).toThrow();
  });

  it('randomised: combined payouts never breach the floor of any pool (overlap, losses, carried losses)', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let trial = 0; trial < 400; trial++) {
      const clubs = ['A', 'B', 'C'].slice(0, 1 + Math.floor(rnd() * 3));
      const partners = ['P', 'Q'].slice(0, Math.floor(rnd() * 3));
      const cells: RevenueCell[] = [];
      const ents: Entitlement[] = [];
      for (const club of clubs) {
        const hands = Math.floor(rnd() * 120_000);
        const turnover = Math.floor(rnd() * 1e9);
        cells.push(directCell(`${club}|`, Math.floor(turnover * (rnd() * 0.16 - 0.04)), turnover));
        ents.push({ party: club, policy: CLUB_POLICY, metrics: { handsDealt: hands, activePlayers: Math.floor(rnd() * 3000) }, cells: [`${club}|`], carriedLossMinor: rnd() < 0.2 ? Math.floor(rnd() * 1e7) : 0 });
        const pc = partners.filter(() => rnd() < 0.7);
        for (const p of pc) { const t = Math.floor(rnd() * 2e9); cells.push(partnerCell(`${club}|${p}`, Math.floor(t * (rnd() * 0.14 - 0.03)), t)); }
        if (pc.length) ents.push({ party: club, policy: PROVIDER_POLICY, metrics: { handsDealt: hands }, cells: pc.map((p) => `${club}|${p}`) });
      }
      for (const p of partners) {
        const mine = cells.filter((c) => c.id.endsWith(`|${p}`));
        if (mine.length) ents.push({ party: p, policy: PARTNER_POLICY, metrics: { turnoverMinor: turnoverOf(mine) }, cells: mine.map((c) => c.id) });
      }
      const st = computeJointStatement({ netTarget: T, cells, entitlements: ents });
      for (const pool of st.pools) {
        const pc = cells.filter((c) => pool.cells.includes(c.id));
        const paid = st.entitlements.filter((e) => e.pool === pool.pool).reduce((a, e) => a + e.amountMinor, 0);
        expect(paid).toBe(pool.paidMinor);
        expect(paid).toBeLessThanOrEqual(pool.budgetMinor);
        if (pool.shortfallMinor > 0) expect(paid).toBe(0);
        else expect(preflopNet(pc, paid)).toBeGreaterThanOrEqual(T * pool.turnoverMinor - 1e-3);
      }
      for (const e of st.entitlements) {
        expect(e.amountMinor).toBeGreaterThanOrEqual(0);
        expect(e.amountMinor).toBeLessThanOrEqual(Math.max(0, e.nominalMinor) + 1e-6);
      }
    }
  });
});

describe('turnover tiers in one unit (EUR cents)', () => {
  it('stablecoins count 1:1 with the euro (explicit policy assumption)', () => expect(STABLECOIN_EUR_RATE).toBe(1));

  it('equivalent EUR / USDT / USDC turnover reaches the same tier at every boundary', () => {
    const ladder = PARTNER_POLICY.components[0]!.tiers;
    const bps = (v: number) => computeShare(PARTNER_POLICY, { turnoverMinor: v }).bps;
    for (const { from } of ladder) for (const cents of [from, Math.max(0, from - 1), from + 1]) {
      const eur = tierTurnoverEurCents('EUR', cents);
      const usdt = tierTurnoverEurCents('USDT', cents * 10_000); // 6-digit micro-units
      const usdc = tierTurnoverEurCents('USDC', cents * 10_000);
      expect([eur, usdt, usdc]).toEqual([cents, cents, cents]);
      expect(bps(usdt)).toBe(bps(eur));
      expect(bps(usdc)).toBe(bps(eur));
      expect(tierBps(usdt, ladder, 'whole-volume')).toBe(tierBps(eur, ladder, 'whole-volume'));
    }
  });

  it('one micro-unit below a boundary stays below it; raw micro-units would have jumped tiers', () => {
    expect(tierTurnoverEurCents('USDT', 100_000_000 * 10_000 - 1)).toBe(99_999_999);
    expect(tierTurnoverEurCents('USDC', 2_000_000_000 * 10_000 - 1)).toBe(1_999_999_999);
    const usdt10k = 10_000 * 1_000_000; // 10,000 USDT
    expect(computeShare(PARTNER_POLICY, { turnoverMinor: tierTurnoverEurCents('USDT', usdt10k) }).bps).toBe(2000);
    // Compared raw (the old bug) it looked like €100M of turnover.
    expect(computeShare(PARTNER_POLICY, { turnoverMinor: usdt10k }).bps).toBeGreaterThan(2000);
  });

  it('chips count at their list price; play money and diamonds never lift a tier', () => {
    expect(tierTurnoverEurCents('CHIP', 100)).toBe(100); // 100 chips = €1
    expect(tierTurnoverEurCents('PLAY', 1e12)).toBe(0);
    expect(tierTurnoverEurCents('DIAMOND', 1e12)).toBe(0);
    expect(() => tierTurnoverEurCents('EUR', -1)).toThrow();
  });
});

describe('loss carry-forward', () => {
  it('loss, then partial recovery, then profit', () => {
    expect(carryForward([-10_000])).toBe(10_000);
    expect(carryForward([-10_000, 4_000])).toBe(6_000);
    expect(carryForward([-10_000, 4_000, 9_000])).toBe(0);
    const cells = [directCell('C|', 9_000, 100_000)];
    const st = computeJointStatement({ netTarget: T, cells, entitlements: [{ party: 'C', policy: CLUB_POLICY, metrics: {}, cells: ['C|'], carriedLossMinor: carryForward([-10_000, 4_000]) }] });
    expect(st.entitlements[0]!.shareableMinor).toBe(3_000);
    expect(st.entitlements[0]!.carryForwardMinor).toBe(0);
  });
});
