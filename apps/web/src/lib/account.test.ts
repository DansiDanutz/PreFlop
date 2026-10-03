import { ApiError } from '@preflop/client';
import { describe, expect, it } from 'vitest';
import { ageOn, clockLabel, countryOptions, dobProblem, durationLabel, minutesNow, realityChecksDue } from './account.ts';
import { betProblem, errorText } from './problems.ts';

describe('age gate (client side; the API enforces it)', () => {
  const now = new Date('2026-06-14T23:30:00Z');
  it('counts whole years in UTC', () => {
    expect(ageOn('2008-06-15', now)).toBe(17);
    expect(ageOn('2008-06-14', now)).toBe(18);
    expect(ageOn('2008-02-30', now)).toBeNull();
    expect(ageOn('14/06/2008', now)).toBeNull();
  });
  it('explains what is wrong with a date of birth', () => {
    expect(dobProblem('', now)).toMatch(/Enter your date/);
    expect(dobProblem('2008-06-15', now)).toMatch(/18 or over/);
    expect(dobProblem('2030-01-01', now)).toMatch(/future/);
    expect(dobProblem('1990-01-01', now)).toBeNull();
  });
  it('lists every ISO country by name', () => {
    const list = countryOptions();
    expect(list.length).toBe(250);
    expect(list.find(([c]) => c === 'MT')?.[1]).toBe('Malta');
    expect(list.some(([c]) => c === 'UK')).toBe(false);
  });
});

describe('play session clock and reality checks', () => {
  it('adds the time since the fetch to the server count', () => {
    expect(minutesNow(10, 1_000_000, 1_000_000 + 59_000)).toBe(10);
    expect(minutesNow(10, 1_000_000, 1_000_000 + 125_000)).toBe(12);
    expect(minutesNow(10, 1_000_000, 0)).toBe(10); // a clock that went backwards
  });
  it('falls due once per interval', () => {
    expect(realityChecksDue(59, 60)).toBe(0);
    expect(realityChecksDue(60, 60)).toBe(1);
    expect(realityChecksDue(95, 30)).toBe(3);
    expect(realityChecksDue(10, 0)).toBe(0);
  });
  it('labels durations', () => {
    expect(durationLabel(45)).toBe('45 min');
    expect(durationLabel(65)).toBe('1 h 05 min');
    expect(clockLabel(65)).toBe('1:05');
    expect(clockLabel(7)).toBe('0:07');
  });
});

describe('account refusals in the player’s words', () => {
  const err = (type: string) => new ApiError(403, { type, title: type, status: 403 });
  it('maps bet refusals and form errors', () => {
    expect(betProblem(err('session_limit')).message).toMatch(/session time limit/);
    expect(betProblem(err('territory_blocked')).message).toMatch(/not available in your country/);
    expect(errorText(err('email_unverified'))).toMatch(/Verify your email/);
    expect(errorText(err('underage'))).toMatch(/18 or over/);
  });
});
