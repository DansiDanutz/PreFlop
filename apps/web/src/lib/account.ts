import { COUNTRY_CODES } from '@preflop/client';

/** Account rules the player app shows (the API enforces them; docs/14 "Accounts and security"). */

export const MIN_AGE = 18;

/** Whole years between a YYYY-MM-DD date of birth and `now`, on the UTC calendar (as the API counts). */
export function ageOn(dob: string, now = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  const cy = now.getUTCFullYear(), cm = now.getUTCMonth() + 1, cd = now.getUTCDate();
  return cy - y - (cm < mo || (cm === mo && cd < d) ? 1 : 0);
}

/** The form message for a date of birth, or null when it is acceptable. */
export function dobProblem(dob: string, now = new Date()): string | null {
  if (!dob) return 'Enter your date of birth.';
  const age = ageOn(dob, now);
  if (age === null || age > 120) return 'Enter a valid date of birth.';
  if (age < 0) return 'That date is in the future.';
  if (age < MIN_AGE) return `PreFlop is for players aged ${MIN_AGE} or over.`;
  return null;
}

/** Every ISO country as [code, name], sorted by name in the given locale. */
export function countryOptions(locale = 'en'): [string, string][] {
  let names: Intl.DisplayNames | null = null;
  try { names = new Intl.DisplayNames([locale], { type: 'region' }); } catch { names = null; }
  return COUNTRY_CODES.map((c): [string, string] => [c, names?.of(c) ?? c]).sort((a, b) => a[1].localeCompare(b[1], locale));
}

// ------------------------------------------------------------------ play session and reality checks

/** Minutes played now, from the server's count at fetch time plus the time since (device clock skew does not matter). */
export function minutesNow(serverMinutes: number, fetchedAt: number, now: number): number {
  return serverMinutes + Math.max(0, Math.floor((now - fetchedAt) / 60_000));
}

/** How many reality checks have fallen due after `minutes` (one every `every` minutes). */
export const realityChecksDue = (minutes: number, every: number): number => (every > 0 ? Math.floor(minutes / every) : 0);

/** "45 min", "1 h 05 min". */
export function durationLabel(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Clock face for the header: "0:45", "1:05". */
export const clockLabel = (minutes: number) => `${Math.floor(minutes / 60)}:${String(Math.max(0, Math.floor(minutes)) % 60).padStart(2, '0')}`;
