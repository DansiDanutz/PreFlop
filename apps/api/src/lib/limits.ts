import { MODES, type PlayMode } from '@preflop/odds-engine';

/**
 * Per-currency bet and table limits (docs/04 §3). They are set in MAJOR units (euros, dollars,
 * whole chips) and scaled by each currency's minor-unit digits, so one rule fits EUR cents (2),
 * stablecoin micro-units (6) and whole chips (0) alike.
 *
 * | Currency            | Max stake per bet | Default round loss limit |
 * |---------------------|-------------------|--------------------------|
 * | EUR                 | 10,000            | 100,000                  |
 * | USDT, USDC          | 10,000            | 100,000                  |
 * | PLAY, CHIP, DIAMOND | 1,000,000         | 5,000,000                |
 */
const MAX_STAKE_MAJOR: Readonly<Record<string, number>> = { EUR: 10_000, USDT: 10_000, USDC: 10_000, PLAY: 1_000_000, CHIP: 1_000_000, DIAMOND: 1_000_000 };
const ROUND_LOSS_MAJOR: Readonly<Record<string, number>> = { EUR: 100_000, USDT: 100_000, USDC: 100_000, PLAY: 5_000_000, CHIP: 5_000_000, DIAMOND: 5_000_000 };

/** Decimal places of a currency's minor unit, from the mode that settles in it. */
export function minorDigits(currency: string): number {
  const m = Object.values(MODES).find((x) => x.currencies.includes(currency));
  if (!m) throw new RangeError(`unknown currency ${currency}`);
  return m.minorDigits;
}

const toMinor = (currency: string, major: number) => major * 10 ** minorDigits(currency);

/** Largest stake of one bet, in minor units of the currency. */
export const maxStakeMinor = (currency: string): number => toMinor(currency, MAX_STAKE_MAJOR[currency] ?? 0);

/** Default per-round loss limit of a new table, in minor units of its currency. */
export const defaultRoundLossMinor = (currency: string): number => toMinor(currency, ROUND_LOSS_MAJOR[currency] ?? 0);

export const REAL_MODES: ReadonlySet<PlayMode> = new Set<PlayMode>(['real-fiat', 'real-crypto']);
