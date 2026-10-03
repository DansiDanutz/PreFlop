import { dobProblem } from './account.ts';

/**
 * Client-side checks for the sign-in and register forms. The forms use noValidate so the browser's
 * own bubbles (unstyled, not announced the same way everywhere) never appear; these messages are
 * shown under each field instead, after the first submit attempt. The API re-checks everything.
 */

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

export interface LoginForm { email: string; password: string }
export type FormErrors<K extends string> = Partial<Record<K, string>>;

export function loginErrors(f: LoginForm): FormErrors<'email' | 'password'> {
  const e: FormErrors<'email' | 'password'> = {};
  if (!f.email.trim()) e.email = 'Enter your email address.';
  else if (!isEmail(f.email)) e.email = 'Enter a valid email address, like name@example.com.';
  if (!f.password) e.password = 'Enter your password.';
  return e;
}

export interface RegisterForm { name: string; email: string; password: string; dob: string; country: string; adult: boolean }
export type RegisterField = 'name' | 'email' | 'password' | 'dob' | 'country' | 'adult';

export function registerErrors(f: RegisterForm, now = new Date()): FormErrors<RegisterField> {
  const e: FormErrors<RegisterField> = {};
  if (!f.name.trim()) e.name = 'Choose a display name.';
  else if (f.name.trim().length > 60) e.name = 'Use 60 characters or fewer.';
  if (!f.email.trim()) e.email = 'Enter your email address.';
  else if (!isEmail(f.email)) e.email = 'Enter a valid email address, like name@example.com.';
  if (f.password.length < 8) e.password = 'Use at least 8 characters.';
  const dob = dobProblem(f.dob, now);
  if (dob) e.dob = dob;
  if (!f.country) e.country = 'Choose your country of residence.';
  if (!f.adult) e.adult = 'Confirm you are 18 or older and accept the terms.';
  return e;
}

/** The first field with an error, to move focus there after a failed submit. */
export const firstError = <K extends string>(order: readonly K[], e: FormErrors<K>): K | null => order.find((k) => e[k]) ?? null;
