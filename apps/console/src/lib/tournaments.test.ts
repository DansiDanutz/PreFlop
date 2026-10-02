import { describe, expect, it } from 'vitest';
import { formatCountdown, formatMinutes, parseSplit, payoutRows, previewLine, rankLabels, validateTournamentForm, type TournamentForm } from './tournaments.ts';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const local = (ms: number) => { const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

const form = (over: Partial<TournamentForm> = {}): TournamentForm => ({
  name: 'Friday Flop Sprint', description: '', mode: 'play', currency: 'PLAY', buy_in: '1000', fee_pct: '10', added: '',
  starting_stack: '10000', bets_allowed: '20', min_stake: '', max_stake: '', starts: local(NOW + 3_600_000), duration_minutes: '60',
  late_reg_minutes: '', min_entries: '', max_entries: '', split: '50, 30, 20', ...over,
});

describe('tournament form validation', () => {
  it('builds the TournamentInput with bps, ISO start and defaults', () => {
    const { errors, input } = validateTournamentForm(form({ added: '5000', max_stake: '2500' }), { admin: true, now: NOW });
    expect(errors).toEqual({});
    expect(input).toMatchObject({
      name: 'Friday Flop Sprint', mode: 'play', currency: 'PLAY', buy_in_minor: 1000, fee_bps: 1000, added_minor: 5000,
      starting_stack: 10_000, bets_allowed: 20, min_stake: 1, max_stake: 2500, duration_minutes: 60, late_reg_minutes: 0,
      min_entries: 2, max_entries: null, payout_bps: [5000, 3000, 2000],
    });
    expect(input!.starts_at).toBe(new Date(NOW + 3_600_000).toISOString());
    expect(input).not.toHaveProperty('description');
  });

  it('charges no fee on a freeroll', () => {
    expect(validateTournamentForm(form({ buy_in: '0', fee_pct: '15' }), { admin: true, now: NOW }).input!.fee_bps).toBe(0);
  });

  it('keeps chips and diamonds in the organization portals and real money with the team', () => {
    expect(validateTournamentForm(form({ mode: 'diamonds', currency: 'DIAMOND' }), { admin: true, now: NOW }).errors.mode).toMatch(/organization/);
    expect(validateTournamentForm(form({ mode: 'play' }), { admin: false, now: NOW }).errors.mode).toBeTruthy();
    expect(validateTournamentForm(form({ mode: 'diamonds', currency: 'DIAMOND' }), { admin: false, now: NOW }).input).not.toBeNull();
    expect(validateTournamentForm(form({ mode: 'real-fiat', currency: 'EUR' }), { admin: true, now: NOW }).input).not.toBeNull();
  });

  it('reports every bound with a clear message', () => {
    const { errors, input } = validateTournamentForm(form({
      name: 'ab', fee_pct: '25', bets_allowed: '501', duration_minutes: '4', starts: local(NOW - 60_000),
      min_stake: '20000', max_entries: '1', min_entries: '2', split: '50, 30',
    }), { admin: true, now: NOW });
    expect(input).toBeNull();
    expect(errors.name).toMatch(/3 characters/);
    expect(errors.fee_pct).toMatch(/20%/);
    expect(errors.bets_allowed).toMatch(/1 and 500/);
    expect(errors.duration_minutes).toMatch(/5 minutes/);
    expect(errors.starts).toMatch(/future/);
    expect(errors.min_stake).toMatch(/starting stack/);
    expect(errors.max_entries).toMatch(/minimum entries/);
    expect(errors.split).toMatch(/add up to 100 \(now 80\)/);
  });

  it('checks stakes, late registration and paid places against the field', () => {
    expect(validateTournamentForm(form({ min_stake: '100', max_stake: '50' }), { admin: true, now: NOW }).errors.max_stake).toBeTruthy();
    expect(validateTournamentForm(form({ late_reg_minutes: '60' }), { admin: true, now: NOW }).errors.late_reg_minutes).toBeTruthy();
    expect(validateTournamentForm(form({ max_entries: '2', min_entries: '2' }), { admin: true, now: NOW }).errors.split).toMatch(/3 paid places/);
    expect(validateTournamentForm(form({ bets_allowed: '1.5' }), { admin: true, now: NOW }).errors.bets_allowed).toBeTruthy();
  });

  it('parses payout splits', () => {
    expect(parseSplit('50, 30, 20')).toEqual([5000, 3000, 2000]);
    expect(parseSplit('40 25 15 10 10')).toEqual([4000, 2500, 1500, 1000, 1000]);
    expect(parseSplit('60% / 40%')).toEqual([6000, 4000]);
    expect(parseSplit('33.33, 33.33, 33.34')).toEqual([3333, 3333, 3334]);
    expect(parseSplit('50, 0')).toBeNull();
    expect(parseSplit('abc')).toBeNull();
    expect(parseSplit('')).toBeNull();
  });
});

describe('tournament display helpers', () => {
  it('labels tied ranks with "="', () => {
    expect(rankLabels([{ rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: 3 }, { rank: 5 }])).toEqual(['1', '2', '=3', '=3', '5']);
  });

  it('projects payouts that always sum to the pool', () => {
    const rows = payoutRows(10_001, [5000, 3000, 2000]);
    expect(rows.map((r) => r.amount_minor)).toEqual([5001, 3000, 2000]);
    expect(rows.reduce((a, r) => a + r.amount_minor, 0)).toBe(10_001);
  });

  it('scales the shares up when fewer players entered than places are paid', () => {
    const rows = payoutRows(1000, [5000, 3000, 2000], 2);
    expect(rows.map((r) => r.bps)).toEqual([6250, 3750]);
    expect(rows.map((r) => r.amount_minor)).toEqual([625, 375]);
    expect(payoutRows(1000, [])).toEqual([]);
  });

  it('formats durations and countdowns', () => {
    expect(formatMinutes(15)).toBe('15m');
    expect(formatMinutes(90)).toBe('1h 30m');
    expect(formatMinutes(1440)).toBe('1d');
    expect(formatMinutes(10_080)).toBe('7d');
    expect(formatCountdown(-5)).toBe('0s');
    expect(formatCountdown(249_000)).toBe('4m 09s');
    expect(formatCountdown(3_900_000)).toBe('1h 05m');
    expect(formatCountdown(183_600_000)).toBe('2d 03h');
  });

  it('writes the preview line', () => {
    expect(previewLine({ starting_stack: 10_000, bets_allowed: 20, buy_in_minor: 1000, added_minor: 0, places: 3, endsLabel: '14:30' }))
      .toBe('Each player: 10,000 points and 20 bets. Ends 14:30. Prize pool grows with every entry; top 3 paid.');
    expect(previewLine({ starting_stack: 500, bets_allowed: 1, buy_in_minor: 0, added_minor: 0, places: 1, endsLabel: '09:00' }))
      .toBe('Each player: 500 points and 1 bet. Ends 09:00. Freeroll with no prize pool: badges only.');
    expect(previewLine({ starting_stack: 500, bets_allowed: 5, buy_in_minor: 0, added_minor: 100, addedLabel: '100', places: 1, endsLabel: '09:00' }))
      .toBe('Each player: 500 points and 5 bets. Ends 09:00. Freeroll: a fixed prize pool of 100; winner takes all.');
  });
});
