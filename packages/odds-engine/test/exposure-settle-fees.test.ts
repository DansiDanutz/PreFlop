import { describe, expect, it } from 'vitest';
import { parseCard } from '../src/cards.ts';
import { ALL_FLOPS, flopFromCards } from '../src/flops.ts';
import { getSelection } from '../src/markets.ts';
import { RoundExposure } from '../src/exposure.ts';
import { allocateLargestRemainder, mergeRoles, poolBreakdown, settleParimutuel } from '../src/fees.ts';
import { payoutMinor, price } from '../src/pricing.ts';
import { statsFor } from '../src/probability.ts';
import { settle } from '../src/settle.ts';

const st = (id: string) => statsFor(getSelection(id));
const odds = (id: string) => price(st(id), 'direct').oddsCenti;

describe('exposure engine', () => {
  it('matches a brute-force worst case over all flops, including correlated bets', () => {
    const exp = new RoundExposure(10_000_000);
    const bets: [string, number][] = [['rank-pattern:pair', 5000], ['pair-of-rank:K', 1000], ['suit-pattern:rainbow', 20000], ['colour:all-red', 3000]];
    for (const [id, stake] of bets) expect(exp.tryAdd(st(id), stake, odds(id))).toBe(true);

    let worst = 0;
    for (const f of ALL_FLOPS) {
      let net = 0;
      for (const [id, stake] of bets) net += stake - (getSelection(id).wins(f) ? payoutMinor(stake, odds(id)) : 0);
      expect(exp.houseNetFor(f.index)).toBe(net);
      worst = Math.max(worst, -net);
    }
    expect(exp.worstCase().lossMinor).toBe(worst);
  });

  it('rejects a bet that would breach the round loss limit and leaves state unchanged', () => {
    const exp = new RoundExposure(100_000);
    expect(exp.tryAdd(st('rank-pattern:trips'), 100, odds('rank-pattern:trips'))).toBe(true);
    const before = exp.worstCase().lossMinor;
    expect(exp.tryAdd(st('rank-pattern:trips'), 1000, odds('rank-pattern:trips'))).toBe(false);
    expect(exp.worstCase().lossMinor).toBe(before);
    exp.remove(st('rank-pattern:trips'), 100, odds('rank-pattern:trips'));
    expect(exp.worstCase().lossMinor).toBe(0);
  });

  it('opposite sides of an exhaustive market hedge each other', () => {
    const exp = new RoundExposure(0);
    // Equal stakes on over and under: worst case is the flop where one side wins.
    const o = odds('sum-24:over');
    expect(exp.lossIfAdded(st('sum-24:over'), 1000, o)).toBe(payoutMinor(1000, o) - 1000);
  });
});

describe('settlement', () => {
  const flop = flopFromCards([parseCard('Kh'), parseCard('Kd'), parseCard('7h')]);
  it('agrees with the selection predicate and pays locked odds', () => {
    expect(settle({ betId: 'b1', selectionId: 'pair-of-rank:K', stakeMinor: 1000, oddsCenti: 6900 }, flop))
      .toEqual({ betId: 'b1', status: 'won', payoutMinor: 69000 });
    expect(settle({ betId: 'b2', selectionId: 'suit-pattern:rainbow', stakeMinor: 1000, oddsCenti: 238 }, flop).status).toBe('lost');
    expect(settle({ betId: 'b3', selectionId: 'colour:all-red', stakeMinor: 1000, oddsCenti: 780 }, flop).status).toBe('won');
  });
  it('refunds the stake when the round is void', () => {
    expect(settle({ betId: 'b4', selectionId: 'colour:all-red', stakeMinor: 1234, oddsCenti: 780 }, null, 'no flop dealt'))
      .toEqual({ betId: 'b4', status: 'void', payoutMinor: 1234, reason: 'no flop dealt' });
  });
});

describe('fees and pools (P = B − F)', () => {
  it('allocations always sum exactly', () => {
    const out = allocateLargestRemainder(100, new Map([['a', 1], ['b', 1], ['c', 1]]));
    expect([...out.values()]).toEqual([34, 33, 33]);
  });

  it('a club holding provider and organizer roles is paid once, combined', () => {
    const merged = mergeRoles([
      { role: 'preflop', party: 'PreFlop', bps: 5000 },
      { role: 'provider', party: 'Club X', bps: 2000 },
      { role: 'organizer', party: 'Club X', bps: 3000 },
    ]);
    expect([...merged.entries()]).toEqual([['PreFlop', 5000], ['Club X', 5000]]);
  });

  it('buy-ins reconcile to net prize pool plus fee, fee to its recipients', () => {
    const b = poolBreakdown(1_000_001, 1571, [
      { role: 'preflop', party: 'PreFlop', bps: 3500 },
      { role: 'provider', party: 'Club Y', bps: 2000 },
      { role: 'organizer', party: 'User Z', bps: 4500 },
    ]);
    expect(b.netPrizePoolMinor + b.feeMinor).toBe(b.buyInsMinor);
    expect([...b.feeByParty.values()].reduce((a, x) => a + x, 0)).toBe(b.feeMinor);
    expect(b.feeByParty.get('User Z')!).toBeGreaterThan(b.feeByParty.get('PreFlop')!);
  });

  it('parimutuel pays winners pro rata after the fee; no winner means a full refund', () => {
    const bets = [
      { betId: 'a', selectionId: 'suit-pattern:rainbow', stakeMinor: 300 },
      { betId: 'b', selectionId: 'suit-pattern:rainbow', stakeMinor: 100 },
      { betId: 'c', selectionId: 'suit-pattern:monotone', stakeMinor: 600 },
    ];
    const r = settleParimutuel(bets, new Set(['suit-pattern:rainbow']), 1000);
    expect(r.feeMinor).toBe(100);
    expect(r.payouts.get('a')).toBe(675);
    expect(r.payouts.get('b')).toBe(225);
    expect(r.payouts.get('c')).toBe(0);
    const none = settleParimutuel(bets, new Set(['suit-pattern:two-tone']), 1000);
    expect(none.refunded).toBe(true);
    expect(none.feeMinor).toBe(0);
  });
});
