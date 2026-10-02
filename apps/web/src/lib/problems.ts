import { ApiError } from '@preflop/client';

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
    return err.problem.title || 'Something went wrong.';
  }
  return 'Could not reach PreFlop. Check your connection and try again.';
}
