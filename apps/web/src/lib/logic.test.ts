import type { Book, MyBet, StreamEvent, TableSummary } from '@preflop/client';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FAVORITES, addFavorite, categoryOf, indexBook, removeFavorite, replaceFavorite, resolveOption, sanitizeFavorites, searchOptions, sectionByMarket,
} from './bets.ts';
import { handClassOf, handNoFromRoundId, isSequence, resultLine, roundLabel } from './flop.ts';
import { applyRoundEvent, openHandNo, phaseOf, tableStatus } from './live.ts';
import { amountLabel, roomOption, roomWallet, stakePresets } from './rooms.ts';
import { groupByRound, summarizeRound } from './rounds.ts';

describe('rooms', () => {
  const opt = { id: 'hand-class:pair', name: 'Any pair', marketId: 'hand-class', marketName: 'Flop hand', description: '', category: 'patterns' as const, oddsCenti: 550, probability: 0.169, offered: true };
  const room = { id: 'r', org_id: 'dn', org_name: 'DN', name: 'R', table_id: 'atlas-04', table_name: 'Table 04', mode: 'diamonds' as const, currency: 'DIAMOND', house: 'organizer' as const,
    rules: { margin_bps: 600, min_stake_minor: 20 }, status: 'active' as const, visibility: 'public' as const, odds: { 'hand-class:pair': 540, 'colour:all-red': null } };

  it('prices a selection with the room odds and hides what the room does not offer', () => {
    expect(roomOption(opt, room)?.oddsCenti).toBe(540);
    expect(roomOption({ ...opt, id: 'colour:all-red' }, room)?.offered).toBe(false);
    expect(roomOption({ ...opt, id: 'straight:yes' }, room)?.offered).toBe(false);
    expect(roomOption(opt, null)).toBe(opt);
  });

  it('finds the closed-loop wallet and labels amounts by currency', () => {
    const wallets = [
      { mode: 'play' as const, currency: 'PLAY', balance_minor: 10000, org_id: null },
      { mode: 'diamonds' as const, currency: 'DIAMOND', balance_minor: 2000, org_id: 'dn', org_name: 'DN' },
    ];
    expect(roomWallet(wallets, room)?.balance_minor).toBe(2000);
    expect(roomWallet(wallets, { ...room, org_id: 'other' })).toBeUndefined();
    expect(amountLabel(100, 'PLAY')).toBe('100 free chips');
    expect(amountLabel(1500, 'CHIP')).toBe('1,500 chips');
    expect(amountLabel(100, 'DIAMOND')).toBe('100 ◆');
    expect(stakePresets(20)).toEqual([50, 100, 250]);
    expect(stakePresets(200)).toEqual([200, 400, 1000]);
  });
});

describe('flop hand class and result line', () => {
  it('classifies every hand class', () => {
    expect(handClassOf(['Kh', 'Kd', '7h'])).toBe('pair');
    expect(handClassOf(['2h', '9h', 'Jh'])).toBe('flush');
    expect(handClassOf(['7h', '8h', '9s'])).toBe('straight');
    expect(handClassOf(['Ah', '5c', '9d'])).toBe('high-card');
    expect(handClassOf(['5c', '5d', '5s'])).toBe('trips');
    expect(handClassOf(['Qs', 'Ks', 'As'])).toBe('straight-flush');
  });

  it('plays the ace high or low but never wraps', () => {
    expect(isSequence(['As', '2d', '3c'])).toBe(true);
    expect(isSequence(['Qs', 'Kd', 'Ac'])).toBe(true);
    expect(isSequence(['Ks', 'Ad', '2c'])).toBe(false);
    expect(isSequence(['Ts', 'Jd', 'Qc'])).toBe(true);
  });

  it('writes the Round complete result line', () => {
    expect(resultLine(['Kh', 'Kd', '7h'])).toBe('A pair.');
    expect(resultLine(['Ah', '5c', '9d'])).toBe('High card.');
    expect(resultLine(['9c', 'Tc', 'Jc'])).toBe('A straight flush.');
  });

  it('formats round numbers like the concepts', () => {
    expect(roundLabel(24)).toBe('Round 024');
    expect(roundLabel(1187)).toBe('Round 1187');
    expect(handNoFromRoundId('green-room:h187')).toBe(187);
    expect(handNoFromRoundId('nope')).toBeNull();
  });
});

describe('browse categories', () => {
  it('maps engine families to categories and splits colours from suits', () => {
    expect(categoryOf('rank-pattern', 'rank-patterns')).toBe('patterns');
    expect(categoryOf('colour', 'suits-colours')).toBe('colors');
    expect(categoryOf('red-count', 'suits-colours')).toBe('colors');
    expect(categoryOf('suit-pattern', 'suits-colours')).toBe('suits');
    expect(categoryOf('suit-count-h', 'suits-colours')).toBe('suits');
    expect(categoryOf('monotone-suit', 'suits-colours')).toBe('suits');
    expect(categoryOf('all-below', 'high-low')).toBe('ranks');
    expect(categoryOf('any-ace', 'face-named')).toBe('ranks');
    expect(categoryOf('straight', 'sequences')).toBe('sequences');
    expect(categoryOf('sum-24', 'totals-parity')).toBe('more');
    expect(categoryOf('combo', 'combined')).toBe('more');
  });

  const book: Book = {
    channel: 'direct', flop_count: 22100, families: {},
    markets: [
      { id: 'rank-pattern', family: 'rank-patterns', name: 'Rank pattern', description: '', first_release: true, exhaustive: true, selections: [
        { id: 'rank-pattern:pair', label: 'Exactly one pair', probability: 0.169, wins: 3744, offered: true, odds_centi: 550 },
      ] },
      { id: 'colour', family: 'suits-colours', name: 'Card colour', description: '', first_release: true, exhaustive: true, selections: [
        { id: 'colour:all-red', label: 'All red', probability: 0.1176, wins: 2600, offered: true, odds_centi: 795 },
        { id: 'colour:mixed', label: 'Mixed colours', probability: 0.76, wins: 16900, offered: true, odds_centi: 123 },
      ] },
    ],
  };

  it('resolves exact equivalents when the book predates hand-class', () => {
    const idx = indexBook(book);
    const pair = resolveOption(idx, 'hand-class:pair');
    expect(pair?.id).toBe('rank-pattern:pair');
    expect(pair?.name).toBe('Any pair');
    expect(pair?.oddsCenti).toBe(550);
    expect(resolveOption(idx, 'hand-class:flush')).toBeUndefined();
  });

  it('searches and sections the catalogue', () => {
    const all = [...indexBook(book).values()];
    expect(searchOptions(all, 'red').map((o) => o.id)).toEqual(['colour:all-red']);
    expect(searchOptions(all, '', 'patterns').map((o) => o.id)).toEqual(['rank-pattern:pair']);
    expect(sectionByMarket(all).map((s) => [s.title, s.items.length])).toEqual([['Rank pattern', 1], ['Card colour', 2]]);
  });
});

describe('favorites', () => {
  it('adds into a free slot and reports when all 6 are full', () => {
    expect(addFavorite(['a'], 'b')).toEqual({ kind: 'added', list: ['a', 'b'] });
    expect(addFavorite(['a'], 'a').kind).toBe('exists');
    const full = addFavorite(DEFAULT_FAVORITES, 'red-count:2');
    expect(full.kind).toBe('full');
    expect(full.list).toHaveLength(6);
  });

  it('replaces one slot in place and keeps the others unchanged', () => {
    const next = replaceFavorite(DEFAULT_FAVORITES, 'suit-pattern:monotone', 'red-count:2');
    expect(next).toEqual(['hand-class:pair', 'colour:all-red', 'colour:all-black', 'red-count:2', 'straight:yes', 'any-ace:yes']);
    expect(replaceFavorite(['a', 'b'], 'zz', 'c')).toEqual(['a', 'b']);
    expect(replaceFavorite(['a', 'b'], 'a', 'b')).toEqual(['b']);
  });

  it('removes and sanitizes stored lists', () => {
    expect(removeFavorite(['a', 'b'], 'a')).toEqual(['b']);
    expect(sanitizeFavorites(['a', 'a', 3, 'b', 'c', 'd', 'e', 'f', 'g'])).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(sanitizeFavorites('nope')).toBeNull();
  });
});

const table = (o: Partial<TableSummary> = {}): TableSummary => ({
  id: 'green-room', name: 'The Green Room', club_id: 'preflop-practice', club_name: 'PreFlop Practice', city: 'Online', kind: 'simulated',
  mode: 'play', currency: 'PLAY', status: 'active', ready: true, problems: [], stream_live: true,
  current_round: { id: 'green-room:h10', hand_no: 10, state: 'OPEN', step: 'open' }, open_round_id: 'green-room:h10',
  last_flop: { round_id: 'green-room:h9', hand_no: 9, cards: ['2c', '3d', '4h'] }, ...o,
});
const ev = (type: string, round: number, data: Record<string, unknown> = {}): StreamEvent => ({ type, table_id: 'green-room', round_id: `green-room:h${round}`, data: { handNo: round, ...data }, at: 0 });

describe('live table status', () => {
  it('derives the lobby status line', () => {
    expect(tableStatus(table()).label).toBe('Predictions open');
    expect(tableStatus(table({ open_round_id: null, current_round: { id: 'x', hand_no: 1, state: 'LOCKED', step: 'locked' } })).label).toBe('Round in progress');
    expect(tableStatus(table({ stream_live: false })).label).toBe('Stream unavailable');
    expect(tableStatus(table({ status: 'paused' })).label).toBe('Paused');
    expect(tableStatus(table({ ready: false })).label).toBe('Predictions open');
    expect(tableStatus(table({ ready: false, open_round_id: null })).label).toBe('Table reconnecting');
  });

  it('applies the lock → dealt → opened → settled sequence', () => {
    let t = table();
    t = applyRoundEvent(t, ev('round.locked', 10));
    expect(t.open_round_id).toBeNull();
    expect(phaseOf(t, false)).toBe('locked');
    t = applyRoundEvent(t, ev('round.dealt', 10, { cards: ['Kh', 'Kd', '7h'] }));
    expect(t.last_flop?.cards).toEqual(['Kh', 'Kd', '7h']);
    expect(phaseOf(t, false)).toBe('reveal');
    t = applyRoundEvent(t, ev('round.opened', 11));
    expect(t.open_round_id).toBe('green-room:h11');
    expect(openHandNo(t)).toBe(11);
    t = applyRoundEvent(t, ev('round.settled', 10, { cards: ['Kh', 'Kd', '7h'] }));
    expect(t.current_round?.id).toBe('green-room:h11');
    expect(phaseOf(t, false)).toBe('open');
    expect(phaseOf(t, true)).toBe('reveal');
  });

  it('ignores other tables', () => {
    const t = table();
    expect(applyRoundEvent(t, { ...ev('round.locked', 10), table_id: 'atlas-04' })).toBe(t);
  });
});

describe('round summary', () => {
  const bet = (o: Partial<MyBet>): MyBet => ({
    bet_id: 'b', round_id: 'r1', selection_id: 'hand-class:pair', stake_minor: 100, odds_centi: 300, potential_payout_minor: 300, mode: 'play', currency: 'PLAY',
    status: 'won', payout_minor: 300, placed_at: '2026-10-02T00:00:00Z', settled_at: null, hand_no: 25, table_id: 't', table_name: 'T', flop: ['Kh', 'Kd', '7h'], ...o,
  });

  it('sums used and returned across bets on one round', () => {
    const s = summarizeRound([bet({}), bet({ bet_id: 'c', status: 'lost', payout_minor: 0, selection_id: 'colour:all-red' })]);
    expect(s).toMatchObject({ usedMinor: 200, returnedMinor: 300, netMinor: 100, status: 'won', handNo: 25 });
    expect(summarizeRound([bet({ status: 'void', payout_minor: 100 })])).toMatchObject({ returnedMinor: 100, netMinor: 0, status: 'void' });
    expect(summarizeRound([bet({ status: 'accepted', payout_minor: null })])?.status).toBe('open');
    expect(summarizeRound([])).toBeNull();
  });

  it('groups bets by round, newest first', () => {
    const g = groupByRound([bet({ round_id: 'a', placed_at: '2026-01-01' }), bet({ round_id: 'b', placed_at: '2026-01-02' }), bet({ round_id: 'a', placed_at: '2026-01-01' })]);
    expect(g.map((x) => [x.roundId, x.bets.length])).toEqual([['b', 1], ['a', 2]]);
  });
});
