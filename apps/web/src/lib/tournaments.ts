import { ApiError, type PlayMode, type Tournament, type TournamentEntryStatus } from '@preflop/client';
import { amountLabel } from './rooms.ts';

/**
 * Pure tournament helpers (docs/17): the clock, tie ranks, stake chips and the player-facing
 * wording. Nothing here reads the device clock: callers pass `now` already corrected by the
 * server offset (Date.parse(server_time) − Date.now() at fetch).
 */

export type LobbyTab = 'upcoming' | 'running' | 'finished';

// ------------------------------------------------------------------ clock

/** "12:04" under an hour, "1:02:04" under a day, "2d 03h" beyond. Rounds up so 0:00 means over. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${two(h)}h`;
  if (h > 0) return `${h}:${two(m)}:${two(s)}`;
  return `${two(m)}:${two(s)}`;
}

export type ClockPhase = 'upcoming' | 'running' | 'settling' | 'finished' | 'cancelled';
export interface TournamentClock { phase: ClockPhase; /** Time to the next boundary (start or end), null once over. */ ms: number | null; text: string }

/**
 * Where the tournament stands at `now` (server time). The server derives `status` from the clock
 * on every read; between refetches the boundaries are crossed here so the countdown never sticks.
 */
export function tournamentClock(t: Pick<Tournament, 'status' | 'starts_at' | 'ends_at'>, now: number): TournamentClock {
  if (t.status === 'cancelled') return { phase: 'cancelled', ms: null, text: 'Cancelled' };
  if (t.status === 'completed') return { phase: 'finished', ms: null, text: 'Finished' };
  const starts = Date.parse(t.starts_at);
  const ends = Date.parse(t.ends_at);
  if (now < starts) return { phase: 'upcoming', ms: starts - now, text: `Starts in ${formatCountdown(starts - now)}` };
  if (now < ends) return { phase: 'running', ms: ends - now, text: `Ends in ${formatCountdown(ends - now)}` };
  return { phase: 'settling', ms: null, text: 'Settling the last flops' };
}

/**
 * Coarse remaining-time text for a polite live region: it changes at most once a minute
 * (every five minutes above ten), so screen readers are not told every second.
 */
export function countdownAnnouncement(ms: number | null): string {
  if (ms === null) return '';
  const min = Math.floor(ms / 60_000);
  if (min >= 120) return `About ${Math.floor(min / 60)} hours left`;
  if (min >= 60) return 'About an hour left';
  if (min >= 10) return `About ${Math.floor(min / 5) * 5} minutes left`;
  if (min >= 1) return `${min} ${min === 1 ? 'minute' : 'minutes'} left`;
  return ms > 0 ? 'Less than a minute left' : '';
}

// ------------------------------------------------------------------ ranks

/** "=3" when the rank appears more than once in the standings (a tie), else "3". */
export function rankLabels(ranks: readonly number[]): string[] {
  const count = new Map<number, number>();
  for (const r of ranks) count.set(r, (count.get(r) ?? 0) + 1);
  return ranks.map((r) => ((count.get(r) ?? 0) > 1 ? `=${r}` : String(r)));
}

export function rankLabel(rank: number, ranks: readonly number[]): string {
  return ranks.filter((r) => r === rank).length > 1 ? `=${rank}` : String(rank);
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** Polite announcement when your position moves; null when nothing changed. */
export function rankChangeText(prev: number | null, next: number | null, tied = false): string | null {
  if (prev === null || next === null || prev === next) return null;
  const at = `${tied ? 'joint ' : ''}${ordinal(next)}`;
  return next < prev ? `You moved up to ${at}.` : `You dropped to ${at}.`;
}

// ------------------------------------------------------------------ stakes

export type QuickStake = 'min' | '10' | '25' | '50' | 'all';
export const QUICK_STAKES: readonly QuickStake[] = ['min', '10', '25', '50', 'all'];
export const quickStakeLabel = (q: QuickStake) => (q === 'min' ? 'Min' : q === 'all' ? 'All-in' : `${q}%`);

/** The most a bet can stake now: the stack, capped by max_stake. */
export const stakeCap = (stack: number, max: number | null) => Math.min(stack, max ?? stack);

/** Points for a quick chip, kept within [min_stake, cap]; null when the stack is below the minimum. */
export function quickStake(q: QuickStake, stack: number, min: number, max: number | null): number | null {
  const cap = stakeCap(stack, max);
  if (cap < min || cap <= 0) return null;
  const raw = q === 'min' ? min : q === 'all' ? cap : Math.floor((stack * Number(q)) / 100);
  return Math.min(cap, Math.max(min, raw));
}

/** Why a stake cannot be placed, or null when it is fine. */
export function stakeError(stake: number, stack: number, min: number, max: number | null): string | null {
  if (!Number.isInteger(stake) || stake <= 0) return 'Enter a stake in whole points.';
  if (stake < min) return `The minimum stake is ${points(min)}.`;
  if (max !== null && stake > max) return `The maximum stake is ${points(max)}.`;
  if (stake > stack) return `More than your stack of ${points(stack)}.`;
  return null;
}

/** Stake × decimal odds, in points (what goes back on the stack if it wins). */
export const potentialReturn = (stake: number, oddsCenti: number) => Math.floor((stake * oddsCenti) / 100);

export const points = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'point' : 'points'}`;
export const pts = (n: number) => n.toLocaleString('en-US');

// ------------------------------------------------------------------ wording

export const ENTRY_STATUS: Record<TournamentEntryStatus, string> = {
  playing: 'Playing',
  busted: 'Out — stack lost',
  finished: 'All bets used — final stack',
};

export const pendingText = (n: number) => (n > 0 ? `${n} waiting for the flop` : null);

export function modeLabel(mode: PlayMode): string {
  if (mode === 'play') return 'Free chips';
  if (mode === 'virtual-chips') return 'Chips';
  if (mode === 'diamonds') return 'Diamonds';
  return 'Real money';
}

/** Never suggest cash value outside real-money modes. */
export function prizeNote(currency: string): string {
  if (currency === 'PLAY') return 'Prizes in free chips. No cash value.';
  if (currency === 'CHIP') return 'Prizes in chips. No cash value.';
  if (currency === 'DIAMOND') return 'Prizes in diamonds. No cash value.';
  return 'Real-money prizes.';
}

export const buyInText = (t: Pick<Tournament, 'buy_in_minor' | 'currency'>) => (t.buy_in_minor > 0 ? amountLabel(t.buy_in_minor, t.currency) : 'Freeroll');

export function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
  const d = Math.round(minutes / 1440);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

/** Player-facing text for a failed tournament call, keyed by the problem `type` (docs/17 §5). */
export function tournamentErrorText(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Could not reach PreFlop. Check your connection and try again.';
  const m: Record<string, string> = {
    registration_closed: 'Registration is closed for this tournament.',
    tournament_full: 'This tournament is full.',
    already_registered: 'You are already registered.',
    not_registered: 'You are not registered for this tournament.',
    insufficient_funds: 'Not enough in your wallet for the buy-in.',
    mode_disabled: 'Real-money tournaments open when real money is switched on.',
    not_enough_players: 'Not enough players registered, so the tournament was cancelled and buy-ins refunded.',
    tournament_not_running: 'The tournament is not running right now.',
    entry_busted: 'You are out of the tournament: your stack is below the minimum stake.',
    no_bets_left: 'You have used all your bets.',
    stake_too_high: 'That stake is more than your stack or the maximum stake.',
    invalid_stake: 'That stake is not allowed. Check the minimum and maximum.',
    one_bet_per_flop: 'You already have a bet on this flop. One bet per flop.',
    round_locked: 'Betting closed for this flop. The next round opens after it.',
    not_offered: 'This bet is not offered right now.',
    price_changed: 'The price changed before your bet was placed.',
    unauthorized: 'Your session expired. Sign in again.',
  };
  if (m[err.type]) return m[err.type]!;
  if (err.status === 404) return 'This tournament does not exist.';
  return err.problem.title || 'Something went wrong.';
}
