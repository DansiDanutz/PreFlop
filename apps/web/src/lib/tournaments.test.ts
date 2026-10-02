import { ApiError } from '@preflop/client';
import { describe, expect, it } from 'vitest';
import {
  buyInText, countdownAnnouncement, durationText, formatCountdown, ordinal, pendingText, potentialReturn, quickStake, rankChangeText, rankLabel, rankLabels,
  stakeError, tournamentClock, tournamentErrorText,
} from './tournaments.ts';

describe('tournament clock', () => {
  const t = { status: 'running' as const, starts_at: '2026-10-02T12:00:00Z', ends_at: '2026-10-02T13:00:00Z' };
  const at = (iso: string) => Date.parse(iso);

  it('formats countdowns by size and rounds up', () => {
    expect(formatCountdown(724_000)).toBe('12:04');
    expect(formatCountdown(195_400)).toBe('03:16');
    expect(formatCountdown(3_724_000)).toBe('1:02:04');
    expect(formatCountdown(2 * 86_400_000 + 3 * 3_600_000)).toBe('2d 03h');
    expect(formatCountdown(-5)).toBe('00:00');
  });

  it('crosses start and end on the server clock', () => {
    expect(tournamentClock(t, at('2026-10-02T11:47:56Z'))).toEqual({ phase: 'upcoming', ms: 724_000, text: 'Starts in 12:04' });
    expect(tournamentClock(t, at('2026-10-02T12:56:45Z')).text).toBe('Ends in 03:15');
    expect(tournamentClock(t, at('2026-10-02T13:00:01Z')).phase).toBe('settling');
    expect(tournamentClock({ ...t, status: 'completed' }, 0).text).toBe('Finished');
    expect(tournamentClock({ ...t, status: 'cancelled' }, 0).phase).toBe('cancelled');
  });

  it('announces the time left at a polite rate', () => {
    expect(countdownAnnouncement(37 * 60_000)).toBe('About 35 minutes left');
    expect(countdownAnnouncement(37 * 60_000 + 59_000)).toBe('About 35 minutes left');
    expect(countdownAnnouncement(3 * 60_000 + 10_000)).toBe('3 minutes left');
    expect(countdownAnnouncement(20_000)).toBe('Less than a minute left');
    expect(countdownAnnouncement(150 * 60_000)).toBe('About 2 hours left');
    expect(countdownAnnouncement(null)).toBe('');
  });
});

describe('tie ranks', () => {
  it('marks shared ranks with "="', () => {
    expect(rankLabels([1, 2, 3, 3, 5])).toEqual(['1', '2', '=3', '=3', '5']);
    expect(rankLabel(3, [1, 3, 3])).toBe('=3');
    expect(rankLabel(1, [1, 3, 3])).toBe('1');
  });

  it('writes ordinals and rank changes', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
    expect(rankChangeText(5, 3)).toBe('You moved up to 3rd.');
    expect(rankChangeText(2, 4, true)).toBe('You dropped to joint 4th.');
    expect(rankChangeText(3, 3)).toBeNull();
    expect(rankChangeText(null, 3)).toBeNull();
  });
});

describe('stake chips', () => {
  it('keeps every chip within min, max and the stack', () => {
    expect(quickStake('min', 1000, 10, null)).toBe(10);
    expect(quickStake('10', 1000, 10, null)).toBe(100);
    expect(quickStake('25', 1000, 10, null)).toBe(250);
    expect(quickStake('50', 1000, 10, 300)).toBe(300);
    expect(quickStake('all', 1000, 10, 300)).toBe(300);
    expect(quickStake('all', 1000, 10, null)).toBe(1000);
    expect(quickStake('10', 50, 10, null)).toBe(10);
    expect(quickStake('min', 5, 10, null)).toBeNull();
  });

  it('validates a typed stake', () => {
    expect(stakeError(100, 1000, 10, 500)).toBeNull();
    expect(stakeError(5, 1000, 10, null)).toBe('The minimum stake is 10 points.');
    expect(stakeError(600, 1000, 10, 500)).toBe('The maximum stake is 500 points.');
    expect(stakeError(1200, 1000, 10, null)).toBe('More than your stack of 1,000 points.');
    expect(stakeError(0, 1000, 10, null)).toBe('Enter a stake in whole points.');
    expect(potentialReturn(250, 550)).toBe(1375);
  });
});

describe('tournament wording', () => {
  it('describes buy-ins, durations and pending bets', () => {
    expect(buyInText({ buy_in_minor: 0, currency: 'PLAY' })).toBe('Freeroll');
    expect(buyInText({ buy_in_minor: 500, currency: 'PLAY' })).toBe('500 free chips');
    expect(durationText(45)).toBe('45 min');
    expect(durationText(90)).toBe('1 h 30 min');
    expect(durationText(120)).toBe('2 h');
    expect(durationText(2880)).toBe('2 days');
    expect(pendingText(2)).toBe('2 waiting for the flop');
    expect(pendingText(0)).toBeNull();
  });

  it('maps problem types to friendly text', () => {
    const e = (type: string, status = 409) => new ApiError(status, { type, title: 'raw', status });
    expect(tournamentErrorText(e('tournament_full'))).toBe('This tournament is full.');
    expect(tournamentErrorText(e('one_bet_per_flop'))).toMatch(/One bet per flop/);
    expect(tournamentErrorText(e('something_new'))).toBe('raw');
    expect(tournamentErrorText(new Error('x'))).toMatch(/Could not reach/);
  });
});
