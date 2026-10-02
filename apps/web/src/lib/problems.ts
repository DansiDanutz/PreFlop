import { ApiError } from '@preflop/client';

/** Account and responsible-gaming refusals (docs/14 "Accounts and security"), in the player's words. */
export const ACCOUNT_PROBLEMS: Record<string, string> = {
  session_limit: 'You reached your session time limit. Take a break, then sign in again to continue.',
  email_unverified: 'Verify your email address first: use the link we sent you (Profile can send it again).',
  dob_required: 'Add your date of birth in your profile first.',
  underage: 'PreFlop is for players aged 18 or over.',
  territory_blocked: 'PreFlop is not available in your country.',
  territory_not_licensed: 'Real money is not available in your country.',
  kyc_required: 'Verify your identity in your profile first.',
  invalid_token: 'This link is invalid or has expired. Ask for a new one.',
  mfa_required: 'Enter the 6-digit code from your authenticator app.',
  invalid_otp: 'That code is not valid. Check the time on your device and try again.',
  login_locked: 'Too many attempts. Wait a few minutes and try again.',
};

/** What the bet slip should do with a failed POST /v1/bets, keyed by the problem `type`. */
export type BetProblem =
  | { kind: 'price_changed'; message: string; oddsCenti: number }
  | { kind: 'round_locked'; message: string }
  | { kind: 'insufficient_funds'; message: string }
  | { kind: 'limit_exceeded'; message: string }
  | { kind: 'table_not_ready'; message: string }
  | { kind: 'unauthorized'; message: string }
  | { kind: 'other'; message: string };

export function betProblem(err: unknown): BetProblem {
  if (!(err instanceof ApiError)) return { kind: 'other', message: 'Could not reach PreFlop. Check your connection and try again.' };
  const p = err.problem;
  switch (p.type) {
    case 'price_changed': {
      const odds = typeof p.odds_centi === 'number' ? p.odds_centi : 0;
      return { kind: 'price_changed', message: 'The price changed before your prediction was placed.', oddsCenti: odds };
    }
    case 'round_locked':
      return { kind: 'round_locked', message: 'Betting closed — next round opens after this flop.' };
    case 'insufficient_funds':
      return { kind: 'insufficient_funds', message: 'Not enough free chips for this stake.' };
    case 'limit_exceeded':
      return { kind: 'limit_exceeded', message: `This stake is above the table limit (${p.title}). Try a smaller amount.` };
    case 'table_not_ready':
      return { kind: 'table_not_ready', message: 'This table is not ready for predictions right now. Try again in a moment.' };
    case 'unauthorized':
      return { kind: 'unauthorized', message: 'Your session expired. Sign in again.' };
    case 'self_excluded':
      return { kind: 'other', message: 'Your account cannot place predictions right now.' };
    case 'mode_disabled':
      return { kind: 'other', message: 'This play mode is switched off.' };
    case 'session_limit':
    case 'email_unverified':
    case 'dob_required':
    case 'underage':
    case 'territory_blocked':
    case 'territory_not_licensed':
    case 'kyc_required':
      return { kind: 'other', message: ACCOUNT_PROBLEMS[p.type]! };
    case 'not_offered':
    case 'unknown_selection':
      return { kind: 'other', message: 'This bet is not offered right now.' };
    default:
      return { kind: 'other', message: p.title || 'Something went wrong.' };
  }
}

/** True when an endpoint simply does not exist yet on the running API. */
export const isNotImplemented = (err: unknown) => err instanceof ApiError && (err.status === 404 || err.status === 405 || err.status === 501);

/** Short, human error text for forms and empty states. */
export function errorText(err: unknown): string {
  if (isNotImplemented(err)) return 'This feature is coming soon.';
  if (err instanceof ApiError) {
    if (err.type === 'email_taken') return 'An account with this email already exists.';
    if (err.type === 'invalid_credentials') return 'Wrong email or password.';
    if (err.type === 'bad_request') return 'Please check the form and try again.';
    if (ACCOUNT_PROBLEMS[err.type]) return ACCOUNT_PROBLEMS[err.type]!;
    return err.problem.title || 'Something went wrong.';
  }
  return 'Could not reach PreFlop. Check your connection and try again.';
}
