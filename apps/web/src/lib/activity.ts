import type { MyBet, MyBetsFilter, PlayMode, Wallet } from '@preflop/client';
import { balanceLabel } from './rooms.ts';

/** Bets per page on the Activity screen; "Load more" asks for the next page with `before`. */
export const ACTIVITY_PAGE = 50;

export type StatusFilter = 'all' | 'won' | 'lost' | 'accepted' | 'void';

/** A wallet filter: one mode and currency (free chips, chips, diamonds, euros…), or every wallet. */
export interface WalletFilter { id: string; label: string; mode?: PlayMode; currency?: string }

export const ALL_WALLETS: WalletFilter = { id: 'all', label: 'All wallets' };

/** The wallets the player holds or has bet from, one per mode and currency, free chips first. */
export function walletFilters(wallets: readonly Wallet[] | undefined, bets: readonly Pick<MyBet, 'mode' | 'currency'>[] = []): WalletFilter[] {
  const seen = new Map<string, WalletFilter>();
  for (const w of [...(wallets ?? []), ...bets]) {
    const id = `${w.mode}:${w.currency}`;
    if (!seen.has(id)) seen.set(id, { id, label: balanceLabel(w.currency), mode: w.mode, currency: w.currency });
  }
  const list = [...seen.values()].sort((a, b) => (a.currency === 'PLAY' ? -1 : b.currency === 'PLAY' ? 1 : a.label.localeCompare(b.label)));
  return [ALL_WALLETS, ...list];
}

/** GET /v1/me/bets parameters for one page of the Activity list. */
export function activityQuery(status: StatusFilter, wallet: WalletFilter, before?: string | null): MyBetsFilter {
  return {
    limit: ACTIVITY_PAGE,
    ...(status !== 'all' ? { status } : {}),
    ...(wallet.mode ? { mode: wallet.mode } : {}),
    ...(wallet.currency ? { currency: wallet.currency } : {}),
    ...(before ? { before } : {}),
  };
}

/** The `before` cursor of the page after this one, or undefined on the last page (older APIs: from the last bet). */
export function nextCursor(page: { bets: readonly MyBet[]; next_before?: string | null | undefined }): string | undefined {
  if (page.next_before !== undefined) return page.next_before ?? undefined;
  return page.bets.length >= ACTIVITY_PAGE ? page.bets[page.bets.length - 1]?.bet_id : undefined;
}
