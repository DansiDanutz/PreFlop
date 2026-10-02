import type { PlayMode, TournamentInput, TournamentStanding, TournamentStatus } from '@preflop/client';
import { pctToBps } from './rules.ts';

/**
 * Tournament form checks and display helpers (docs/17). The API is authoritative; these give instant inline
 * errors and the numbers the console shows (rank labels with ties, projected payouts, countdowns).
 */

export const LIMITS = {
  maxFeeBps: 2000,
  betsAllowed: [1, 500] as const,
  durationMinutes: [5, 10_080] as const,
  nameLength: [3, 80] as const,
};

/** Who may create what: PreFlop runs free-chip and real-money tournaments; chips and diamonds are an organization's closed loop. */
export const ADMIN_MODES: PlayMode[] = ['play', 'real-fiat', 'real-crypto'];
export const ORG_MODES: PlayMode[] = ['virtual-chips', 'diamonds'];

export const DURATION_PRESETS: { label: string; minutes: number }[] = [
  { label: '15m', minutes: 15 }, { label: '30m', minutes: 30 }, { label: '1h', minutes: 60 }, { label: '3h', minutes: 180 }, { label: '1d', minutes: 1440 },
];

export const PAYOUT_PRESETS: { label: string; split: string }[] = [
  { label: 'Winner takes all', split: '100' },
  { label: '60 / 40', split: '60, 40' },
  { label: '50 / 30 / 20', split: '50, 30, 20' },
  { label: '40 / 25 / 15 / 10 / 10', split: '40, 25, 15, 10, 10' },
];

export const isRealMode = (m: string) => m === 'real-fiat' || m === 'real-crypto';

/** The form as typed. Amounts are integer minor units; percentages are plain numbers. */
export interface TournamentForm {
  name: string;
  description: string;
  mode: PlayMode;
  currency: string;
  buy_in: string;
  fee_pct: string;
  added: string;
  starting_stack: string;
  bets_allowed: string;
  min_stake: string;
  max_stake: string;
  /** `datetime-local` value, interpreted in the browser's time zone. */
  starts: string;
  duration_minutes: string;
  late_reg_minutes: string;
  min_entries: string;
  max_entries: string;
  /** Comma or space separated percentages, e.g. "50, 30, 20". */
  split: string;
}

export type TournamentErrors = Partial<Record<keyof TournamentForm, string>>;

const WHOLE = /^\d+$/;
const whole = (s: string): number | null => {
  const t = s.trim().replace(/,/g, '');
  return WHOLE.test(t) && Number.isSafeInteger(Number(t)) ? Number(t) : null;
};

/** "50, 30, 20" → [5000, 3000, 2000]; null when a share is not a positive number with ≤ 2 decimals. */
export function parseSplit(s: string): number[] | null {
  const parts = s.split(/[,\s/]+/).map((x) => x.replace(/%$/, '')).filter(Boolean);
  if (!parts.length) return null;
  const out: number[] = [];
  for (const p of parts) {
    const b = pctToBps(p);
    if (b === null || b <= 0) return null;
    out.push(b);
  }
  return out;
}

/** Validates the form; returns inline errors and, when valid, the TournamentInput payload. */
export function validateTournamentForm(f: TournamentForm, o: { admin: boolean; now?: number }): { errors: TournamentErrors; input: TournamentInput | null } {
  const e: TournamentErrors = {};
  const now = o.now ?? Date.now();

  const name = f.name.trim();
  if (name.length < LIMITS.nameLength[0]) e.name = 'Give the tournament a name (at least 3 characters).';
  else if (name.length > LIMITS.nameLength[1]) e.name = 'Keep the name under 80 characters.';

  if (!(o.admin ? ADMIN_MODES : ORG_MODES).includes(f.mode)) {
    e.mode = o.admin ? 'Chips and diamonds tournaments are created from the organization’s portal.' : 'Organizations run chips or diamonds tournaments only.';
  }

  const buyIn = whole(f.buy_in || '0');
  if (buyIn === null) e.buy_in = 'Enter a whole number of minor units (0 for a freeroll).';

  const feeBps = pctToBps(f.fee_pct || '0');
  if (feeBps === null) e.fee_pct = 'Enter a percentage, e.g. 10 or 7.5.';
  else if (feeBps > LIMITS.maxFeeBps) e.fee_pct = 'The fee is at most 20%.';

  const added = whole(f.added || '0');
  if (added === null) e.added = 'Enter a whole number of minor units.';

  const stack = whole(f.starting_stack);
  if (stack === null || stack < 1) e.starting_stack = 'Enter a starting stack of at least 1 point.';

  const bets = whole(f.bets_allowed);
  if (bets === null || bets < LIMITS.betsAllowed[0] || bets > LIMITS.betsAllowed[1]) e.bets_allowed = 'Between 1 and 500 bets.';

  const minStake = f.min_stake.trim() ? whole(f.min_stake) : 1;
  if (minStake === null || minStake < 1) e.min_stake = 'Enter a whole number of at least 1.';
  else if (stack !== null && minStake > stack) e.min_stake = 'The minimum stake cannot exceed the starting stack.';

  const maxStake = f.max_stake.trim() ? whole(f.max_stake) : null;
  if (f.max_stake.trim() && (maxStake === null || maxStake < 1)) e.max_stake = 'Enter a whole number, or leave blank for no limit.';
  else if (maxStake !== null && minStake !== null && maxStake < minStake) e.max_stake = 'The maximum stake must be at least the minimum stake.';

  const starts = f.starts ? new Date(f.starts).getTime() : Number.NaN;
  if (!Number.isFinite(starts)) e.starts = 'Pick a start date and time.';
  else if (starts <= now) e.starts = 'The start must be in the future.';

  const duration = whole(f.duration_minutes);
  if (duration === null || duration < LIMITS.durationMinutes[0] || duration > LIMITS.durationMinutes[1]) e.duration_minutes = 'Between 5 minutes and 7 days (10,080 minutes).';

  const lateReg = whole(f.late_reg_minutes || '0');
  if (lateReg === null) e.late_reg_minutes = 'Enter whole minutes (0 closes registration at the start).';
  else if (duration !== null && lateReg >= duration) e.late_reg_minutes = 'Late registration must close before the tournament ends.';

  const minEntries = f.min_entries.trim() ? whole(f.min_entries) : 2;
  if (minEntries === null || minEntries < 1) e.min_entries = 'Enter a whole number of at least 1.';

  const maxEntries = f.max_entries.trim() ? whole(f.max_entries) : null;
  if (f.max_entries.trim() && (maxEntries === null || maxEntries < 1)) e.max_entries = 'Enter a whole number, or leave blank for no cap.';
  else if (maxEntries !== null && minEntries !== null && maxEntries < minEntries) e.max_entries = 'The cap must be at least the minimum entries.';

  const split = parseSplit(f.split);
  if (!split) e.split = 'List the share of each paid place, e.g. 50, 30, 20.';
  else if (split.reduce((a, b) => a + b, 0) !== 10_000) e.split = `Shares must add up to 100 (now ${Number((split.reduce((a, b) => a + b, 0) / 100).toFixed(2))}).`;
  else if (maxEntries !== null && split.length > maxEntries) e.split = `${split.length} paid places but at most ${maxEntries} entries.`;

  if (Object.keys(e).length) return { errors: e, input: null };

  const input: TournamentInput = {
    name, mode: f.mode, currency: f.currency,
    buy_in_minor: buyIn!,
    // The fee is a share of the buy-ins: a freeroll has none to share.
    fee_bps: buyIn === 0 ? 0 : feeBps!,
    starting_stack: stack!, bets_allowed: bets!, min_stake: minStake!, max_stake: maxStake,
    starts_at: new Date(starts).toISOString(), duration_minutes: duration!, late_reg_minutes: lateReg!,
    min_entries: minEntries!, max_entries: maxEntries, payout_bps: split!,
  };
  if (f.description.trim()) input.description = f.description.trim();
  if (added) input.added_minor = added;
  return { errors: e, input };
}

/** 90 → "1h 30m", 1440 → "1d", 45 → "45m". */
export function formatMinutes(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '0m';
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = Math.round(min % 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ');
}

/** Milliseconds → "2d 03h", "1h 05m", "4m 09s", "0s". */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  if (s >= 86_400) return `${Math.floor(s / 86_400)}d ${p(Math.floor((s % 86_400) / 3600))}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${p(Math.floor((s % 3600) / 60))}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${p(s % 60)}s`;
  return `${s}s`;
}

/** "Top 3 paid" / "winner takes all". */
export const paidLabel = (places: number) => (places <= 1 ? 'winner takes all' : `top ${places} paid`);

/** One-line summary of what players get, shown while the form is filled in. */
export function previewLine(p: { starting_stack: number; bets_allowed: number; buy_in_minor: number; added_minor: number; places: number; endsLabel: string; addedLabel?: string }): string {
  const pool = p.buy_in_minor > 0
    ? `Prize pool grows with every entry${p.added_minor > 0 && p.addedLabel ? ` on top of ${p.addedLabel} added` : ''}`
    : p.added_minor > 0 && p.addedLabel ? `Freeroll: a fixed prize pool of ${p.addedLabel}` : 'Freeroll with no prize pool: badges only';
  const paid = p.buy_in_minor > 0 || p.added_minor > 0 ? `; ${paidLabel(p.places)}` : '';
  return `Each player: ${p.starting_stack.toLocaleString('en-US')} points and ${p.bets_allowed} ${p.bets_allowed === 1 ? 'bet' : 'bets'}. Ends ${p.endsLabel}. ${pool}${paid}.`;
}

/** Rank labels with ties shown as "=3" (every player sharing a position). */
export function rankLabels(standings: readonly Pick<TournamentStanding, 'rank'>[]): string[] {
  const count = new Map<number, number>();
  for (const s of standings) count.set(s.rank, (count.get(s.rank) ?? 0) + 1);
  return standings.map((s) => ((count.get(s.rank) ?? 0) > 1 ? `=${s.rank}` : String(s.rank)));
}

export interface PayoutRow { position: number; bps: number; amount_minor: number }

/**
 * Projected payout per position. With fewer entrants than paid places the existing places are scaled up to 100%
 * (docs/17 §4). Amounts round down; the remainder goes to first place so the pool ends at exactly 0.
 */
export function payoutRows(poolMinor: number, payoutBps: readonly number[], entries?: number): PayoutRow[] {
  const places = entries !== undefined && entries > 0 && entries < payoutBps.length ? payoutBps.slice(0, entries) : [...payoutBps];
  const total = places.reduce((a, b) => a + b, 0);
  if (!places.length || total <= 0) return [];
  const scaled = places.map((b) => Math.round((b * 10_000) / total));
  scaled[0]! += 10_000 - scaled.reduce((a, b) => a + b, 0);
  const amounts = places.map((b) => Math.floor((Math.max(0, poolMinor) * b) / total));
  amounts[0]! += Math.max(0, poolMinor) - amounts.reduce((a, b) => a + b, 0);
  return places.map((_, i) => ({ position: i + 1, bps: scaled[i]!, amount_minor: amounts[i]! }));
}

export const STATUS_TONE: Record<TournamentStatus, 'accent' | 'info' | 'warn' | 'danger' | 'muted'> = {
  scheduled: 'info', running: 'accent', settling: 'warn', completed: 'muted', cancelled: 'danger',
};

export const isLive = (s: TournamentStatus) => s === 'running' || s === 'settling';
export const isCancellable = (s: TournamentStatus) => s === 'scheduled' || s === 'running';
