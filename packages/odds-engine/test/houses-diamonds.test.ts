import { describe, expect, it } from 'vitest';
import { dilution, quoteDiamonds, splitDiamondBet, validateDiamondRules } from '../src/diamonds.ts';
import { GLOBAL_RULES } from '../src/globalRules.ts';
import { OrganizerCollateral, balances, betPostings, platformFeeMinor, validateOrganizerHouse } from '../src/houses.ts';
import { getSelection } from '../src/markets.ts';
import { MODES, assertHouseAllowed } from '../src/modes.ts';
import { payoutMinor, price } from '../src/pricing.ts';
import { statsFor } from '../src/probability.ts';

const st = (id: string) => statsFor(getSelection(id));

describe('play modes', () => {
  it('only real money cashes out; play money never charges fees', () => {
    expect(Object.values(MODES).filter((m) => m.cashOut).map((m) => m.mode)).toEqual(['real-fiat', 'real-crypto']);
    expect(MODES.play.feesApply).toBe(false);
    expect(MODES['real-crypto'].currencies).toEqual(['USDT', 'USDC']);
    expect(platformFeeMinor('play', 10_000, GLOBAL_RULES.platformFee)).toBe(0);
  });
  it('diamonds cannot use PreFlop as the house', () => {
    expect(() => assertHouseAllowed('diamonds', 'preflop')).toThrow();
    expect(() => assertHouseAllowed('diamonds', 'organizer')).not.toThrow();
  });
});

describe('who pays the winnings', () => {
  const odds = price(st('suit-pattern:rainbow'), 'direct').oddsCenti;

  it('PreFlop house: stake to PreFlop bankroll, payout from it, ledger balances', () => {
    const p = betPostings({ mode: 'real-fiat', house: 'preflop', playerId: 'u1', stakeMinor: 1000, oddsCenti: odds, won: true });
    const b = balances(p);
    expect([...b.values()].reduce((a, x) => a + x, 0)).toBe(0);
    expect(b.get('PreFlop:bankroll:real-fiat')).toBe(1000 - payoutMinor(1000, odds));
    expect(b.get('u1:wallet:real-fiat')).toBe(payoutMinor(1000, odds) - 1000);
  });

  it('organizer house: organizer collateral pays, PreFlop only receives its fee', () => {
    const p = betPostings({ mode: 'real-crypto', house: 'organizer', organizerId: 'bookie', playerId: 'u2', stakeMinor: 5_000_000, oddsCenti: odds, won: true });
    const b = balances(p);
    expect([...b.values()].reduce((a, x) => a + x, 0)).toBe(0);
    const fee = platformFeeMinor('real-crypto', 5_000_000, GLOBAL_RULES.platformFee);
    expect(b.get('PreFlop:platform-fees:real-crypto')).toBe(fee);
    expect(b.get('bookie:collateral:real-crypto')).toBe(5_000_000 - fee - payoutMinor(5_000_000, odds));
    expect(b.has('PreFlop:bankroll:real-crypto')).toBe(false);
  });

  it('play money: no fee lines at all', () => {
    const p = betPostings({ mode: 'play', house: 'preflop', playerId: 'u3', stakeMinor: 100, oddsCenti: odds, won: false });
    expect(p.every((x) => x.memo !== 'platform fee')).toBe(true);
  });

  it('rejects organizer configs that would lose money after fees', () => {
    const ok = validateOrganizerHouse({ mode: 'real-fiat', marginBps: 600, platformFee: GLOBAL_RULES.platformFee, providerShareBps: 1000, typicalStakeMinor: 600 });
    expect(ok.ok).toBe(true);
    expect(ok.organizerEv).toBeCloseTo(0.06 * 0.9 - 0.015, 10);
    const bad = validateOrganizerHouse({ mode: 'real-fiat', marginBps: 300, platformFee: GLOBAL_RULES.platformFee, providerShareBps: 5000, typicalStakeMinor: 600 });
    expect(bad.ok).toBe(false);
    expect(validateOrganizerHouse({ mode: 'play', marginBps: 600, platformFee: GLOBAL_RULES.platformFee, providerShareBps: 0, typicalStakeMinor: 100 }).ok).toBe(false);
  });

  it('collateral blocks bets the organizer could not pay', () => {
    const c = new OrganizerCollateral(100_000);
    const trips = st('rank-pattern:trips');
    const o = price(trips, 'direct').oddsCenti; // 361.00
    expect(c.tryBet('r1', trips, 200, o)).toBe(true); // worst case 200·361 − 200 = 72,000
    expect(c.tryBet('r2', trips, 100, o)).toBe(false); // another 36,000 on a second table would exceed 100,000
    expect(c.availableMinor()).toBe(100_000 - 72_000);
    const net = c.settleRound('r1', 0); // flop index 0 = 2s 2h 2d → trips
    expect(net).toBe(200 - payoutMinor(200, o));
    expect(c.balance).toBe(100_000 + net);
  });
});

describe('diamonds', () => {
  const rules = { rakeBps: 300, minStake: 20, rakeShares: [
    { role: 'organizer', party: 'Org', bps: 8000 }, { role: 'co-host', party: 'Host', bps: 2000 },
  ] };

  it('every bet splits exactly: stake = PreFlop fee + rake + at risk', () => {
    for (const stake of [20, 21, 99, 100, 1234, 1_000_000]) {
      const s = splitDiamondBet(stake, rules);
      expect(s.preflopFee + s.rake + s.atRisk).toBe(stake);
      expect([...s.rakeByParty.values()].reduce((a, b) => a + b, 0)).toBe(s.rake);
      expect(s.preflopFee).toBe(GLOBAL_RULES.diamonds.preflopFeePerBet);
    }
    expect(() => splitDiamondBet(19, rules)).toThrow();
  });

  it('organizer rules must stay inside the global bounds', () => {
    expect(validateDiamondRules(rules)).toEqual([]);
    expect(validateDiamondRules({ ...rules, rakeBps: 5000 })).toHaveLength(1);
    expect(validateDiamondRules({ ...rules, minStake: 5 })).toHaveLength(1);
  });

  it('volume discounts on diamond packs', () => {
    expect(quoteDiamonds(10_000).cents).toBe(10_000);
    expect(quoteDiamonds(1_000_000).cents).toBe(800_000);
  });

  it('dilution tracker: fees sink diamonds and predict the rebuy', () => {
    const d = dilution({ bought: 1_000_000, bets: 10_000, stakes: 1_000_000, preflopFees: 10_000, rakeToOrganizer: 24_000, rakeToOthers: 6_000, houseNet: 20_000 });
    expect(d.circulating).toBe(984_000);
    expect(d.sinkRate).toBeCloseTo(0.016, 10);
    expect(d.consumedPerBet).toBeCloseTo(1.6, 10);
    expect(d.betsUntilEmpty).toBe(615_000);
  });
});

describe('mode funding rules', () => {
  it('play money is reset by the player; chips can be transferred by clubs and organizers; diamonds can be bought with crypto', () => {
    expect(MODES.play.playerCanReset).toBe(true);
    expect(MODES.play.purchasableWith).toEqual([]);
    expect(MODES['virtual-chips'].transferableBy).toEqual(['club', 'organizer']);
    expect(MODES.diamonds.purchasableWith).toEqual(expect.arrayContaining(['USDT', 'USDC']));
  });
});
