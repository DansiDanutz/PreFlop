import type { Room, Wallet } from '@preflop/client';
import { formatAmount, formatMoney } from '@preflop/ui';
import type { BetOption } from './bets.ts';

/** GET /v1/rooms/:id also returns the room's own price list (selection id → odds, null = not offered). */
export type RoomDetail = Room & { odds?: Record<string, number | null> };

export const isPool = (room: Pick<Room, 'house'> | null | undefined) => room?.house === 'pool';

/** A selection as priced in a room: the room's odds replace the book's, and missing prices are not offered. */
export function roomOption(o: BetOption | undefined, room: RoomDetail | null | undefined): BetOption | undefined {
  if (!o || !room) return o;
  const odds = room.odds?.[o.id];
  if (odds === undefined || odds === null) return { ...o, offered: false };
  return { ...o, oddsCenti: odds, offered: true };
}

/** The closed-loop wallet a room plays from (same mode, currency and organizer). */
export function roomWallet(wallets: readonly Wallet[] | undefined, room: Pick<Room, 'mode' | 'currency' | 'org_id'>): Wallet | undefined {
  return wallets?.find((w) => w.mode === room.mode && w.currency === room.currency && (w.org_id ?? null) === room.org_id);
}

/** Stake pills: the concept's 50 / 100 / 250, scaled up when a room's minimum stake is higher. */
export function stakePresets(minStake = 1): [number, number, number] {
  if (minStake <= 50) return [50, 100, 250];
  return [minStake, minStake * 2, minStake * 5];
}

/** "100 free chips", "100 chips", "100 ◆", "€1.50": always with the unit of the currency. */
export function amountLabel(minor: number, currency: string): string {
  return formatMoney(minor, currency);
}

/** "1–10,000 free chips", "20–500 ◆", "€0.01–€25.00": a stake range in one unit. */
export function amountRange(lo: number, hi: number, currency: string): string {
  return currency === 'EUR' ? `${formatMoney(lo, currency)}–${formatMoney(hi, currency)}` : `${formatAmount(lo, currency)}–${formatMoney(hi, currency)}`;
}

/** Balance label under the number. */
export function balanceLabel(currency: string, orgName?: string | null): string {
  const base = currency === 'PLAY' ? 'Free chips' : currency === 'CHIP' ? 'Chips' : currency === 'DIAMOND' ? 'Diamonds' : currency;
  return orgName ? `${base} · ${orgName}` : base;
}

/** A stake above this share of the balance asks for confirmation first. */
export const LARGE_STAKE_SHARE = 0.25;

/**
 * Large-stake guard: true when the stake is more than 25% of the balance (or all of it). Unknown
 * or empty balances never ask: the server refuses what cannot be covered.
 */
export function isLargeStake(stake: number, balance: number | null | undefined): boolean {
  if (balance === null || balance === undefined || balance <= 0 || stake <= 0) return false;
  return stake >= balance || stake > balance * LARGE_STAKE_SHARE;
}

/** Microcopy under Confirm: never suggest cash value outside real-money modes. */
export function noCashValueLine(currency: string): string {
  if (currency === 'PLAY') return 'Free chips. No cash value.';
  if (currency === 'CHIP') return 'Chips have no cash value and cannot be cashed out.';
  if (currency === 'DIAMOND') return 'Diamonds have no cash value and cannot be cashed out.';
  return 'Play responsibly.';
}
