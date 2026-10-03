import type { Limits } from '@preflop/client';

/**
 * Responsible-play limits form. Loss and deposit limits are EUR cents on the server (real money
 * only); the form takes euros. An empty field means "no limit" and is sent as an explicit null,
 * so a limit can be removed (removing one, like raising it, takes effect after 24 hours).
 */
export interface LimitsForm { loss: string; deposit: string; session: string }

/** "12.5" → 1250; "" → null; anything else → NaN (invalid). */
export function eurosToCents(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return Number.NaN;
  return Math.round(Number(t) * 100);
}

/** 1250 → "12.50", 5000 → "50", null → "". */
export function centsToEuros(c: number | null | undefined): string {
  if (c === null || c === undefined) return '';
  return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2);
}

/** The form prefilled from the saved limits. */
export const limitsForm = (l: Limits | undefined): LimitsForm => ({
  loss: centsToEuros(l?.loss_day_minor), deposit: centsToEuros(l?.deposit_day_minor), session: l?.session_minutes == null ? '' : String(l.session_minutes),
});

export interface LimitsErrors { loss?: string; deposit?: string; session?: string }

export function limitsErrors(f: LimitsForm): LimitsErrors {
  const e: LimitsErrors = {};
  const loss = eurosToCents(f.loss);
  const dep = eurosToCents(f.deposit);
  if (loss !== null && !(loss > 0)) e.loss = 'Enter an amount above €0, or leave it empty for no limit.';
  if (dep !== null && !(dep > 0)) e.deposit = 'Enter an amount above €0, or leave it empty for no limit.';
  const s = f.session.trim();
  if (s !== '' && !(/^\d+$/.test(s) && Number(s) >= 5 && Number(s) <= 1440)) e.session = 'Enter 5 to 1440 minutes, or leave it empty for no reminder.';
  return e;
}

/** PUT /v1/me/limits body: every field explicit, null where the player emptied it. */
export function limitsPayload(f: LimitsForm): Limits {
  const s = f.session.trim();
  return { loss_day_minor: eurosToCents(f.loss), deposit_day_minor: eurosToCents(f.deposit), session_minutes: s === '' ? null : Number(s) };
}
