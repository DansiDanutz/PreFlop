import { ApiError, type BetView, type PlaceBet, type PreFlopClient, newIdempotencyKey } from '@preflop/client';
import { KEYS, readJson, writeJson, writeString } from './storage.ts';

/**
 * A bet the player confirmed, frozen at that moment with ONE Idempotency-Key, kept until the API
 * gives a definitive answer. Every retry of an uncertain request (network error, 5xx, unreadable
 * response) resends exactly this body with exactly this key, so the API replays the original bet
 * instead of debiting a second one. It is kept in sessionStorage, so a reload in the middle is
 * reconciled (GET /v1/me/bets, matched by the key) before another bet can be placed.
 *
 * A price change binds the same way: the player's consent is to THIS intent at THAT new price
 * (withAcceptedPrice), never to whatever the slip shows later.
 */
export interface BetIntent {
  v: 1;
  key: string;
  tableId: string;
  roundId: string;
  selectionId: string;
  stakeMinor: number;
  /** The price the player saw and agreed to. */
  oddsCenti: number;
  roomId: string | null;
  currency: string;
  /** True once the player accepted a changed price: oddsCenti is exactly the new price they were shown. */
  acceptedPrice: boolean;
  createdAt: number;
  /** When a request for this intent was last sent. */
  sentAt: number;
}

export interface IntentInputs { tableId: string; roundId: string; selectionId: string; stakeMinor: number; oddsCenti: number; roomId: string | null; currency: string }

export function newIntent(x: IntentInputs, now = Date.now(), key = newIdempotencyKey()): BetIntent {
  return Object.freeze({ v: 1 as const, key, ...x, acceptedPrice: false, createdAt: now, sentAt: 0 });
}

/** The player accepted `oddsCenti` for this very bet: same key, round, selection, stake and wallet. */
export function withAcceptedPrice(i: BetIntent, oddsCenti: number): BetIntent {
  return Object.freeze({ ...i, oddsCenti, acceptedPrice: true });
}

export function intentBody(i: BetIntent): PlaceBet {
  return {
    round_id: i.roundId, selection_id: i.selectionId, stake_minor: i.stakeMinor, odds_centi: i.oddsCenti,
    ...(i.acceptedPrice ? { accept_price_change: true } : {}),
    ...(i.roomId ? { room_id: i.roomId } : {}),
  };
}

/** Same bet as what the slip shows now (round, selection, stake, wallet)? A price notice is only valid while it is. */
export function intentMatches(i: BetIntent, now: Pick<IntentInputs, 'tableId' | 'roundId' | 'selectionId' | 'stakeMinor' | 'roomId'>): boolean {
  return i.tableId === now.tableId && i.roundId === now.roundId && i.selectionId === now.selectionId && i.stakeMinor === now.stakeMinor && i.roomId === now.roomId;
}

/** A price-change offer stays valid only while the slip still shows the exact bet it was raised for. */
export function priceOfferFor<T extends { intent: BetIntent }>(offer: T | null, now: IntentInputs | null): T | null {
  return offer && now && intentMatches(offer.intent, now) ? offer : null;
}

// ------------------------------------------------------------------------------- persistence

const isIntent = (x: unknown): x is BetIntent => {
  const i = x as Partial<BetIntent> | null;
  return !!i && i.v === 1 && typeof i.key === 'string' && i.key.length >= 8 && typeof i.roundId === 'string' && typeof i.selectionId === 'string'
    && typeof i.tableId === 'string' && Number.isSafeInteger(i.stakeMinor) && Number.isSafeInteger(i.oddsCenti) && typeof i.currency === 'string'
    && (i.roomId === null || typeof i.roomId === 'string') && typeof i.acceptedPrice === 'boolean' && typeof i.createdAt === 'number' && typeof i.sentAt === 'number';
};

/** sessionStorage, never throwing (storage.ts): without storage the intent lives in memory only. */
export const intentStore = {
  load(): BetIntent | null {
    const x = readJson<unknown>(KEYS.betIntent, 'session');
    return isIntent(x) ? Object.freeze(x) : null;
  },
  save(i: BetIntent) { writeJson(KEYS.betIntent, i, 'session'); },
  clear() { writeString(KEYS.betIntent, null, 'session'); },
  /**
   * Updates or clears only while the stored intent is still this one (same key). A screen that was
   * left, or an old request's late answer or retry, can never touch a newer intent's saved key.
   */
  saveIf(i: BetIntent) { if (this.load()?.key === i.key) this.save(i); },
  clearIf(key: string) { if (this.load()?.key === key) this.clear(); },
};

// ---------------------------------------------------------------------------------- outcomes

/**
 * True when the API answered and refused: no bet exists for the key. A 4xx is the API's decision
 * (except 408). A 5xx, a network error or a 2xx we could not read may have committed.
 */
export function isDefinitiveRefusal(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.type !== 'invalid_response';
}

export type Outcome =
  | { kind: 'placed'; bet: BetView }
  | { kind: 'refused'; error: unknown }
  /** Still unknown: keep the intent and keep checking before allowing another bet. */
  | { kind: 'unknown'; error: unknown }
  /** Reconciled: the API has no bet with this key, and nothing is in flight any more. */
  | { kind: 'not_placed' };

type Api = Pick<PreFlopClient, 'placeBet' | 'myBets' | 'round'>;

/** Finds the bet placed with this intent's key, if any (throws when the API cannot be reached). */
export async function findPlaced(api: Api, i: BetIntent): Promise<BetView | null> {
  const { bets } = await api.myBets({ round_id: i.roundId, limit: 200 });
  return bets.find((b) => b.idempotency_key === i.key) ?? null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Sends the intent, retrying an uncertain outcome with the SAME key (the API replays a committed
 * bet), then reconciles through GET /v1/me/bets. `onSend` runs before every attempt (persist sentAt).
 */
export async function submitIntent(api: Api, i: BetIntent, o: { attempts?: number; backoffMs?: number; onSend?: (i: BetIntent) => void; wait?: (ms: number) => Promise<void> } = {}): Promise<Outcome> {
  const attempts = o.attempts ?? 3;
  const wait = o.wait ?? sleep;
  let last: unknown = null;
  for (let n = 0; n < attempts; n++) {
    if (n > 0) await wait((o.backoffMs ?? 600) * 2 ** (n - 1));
    o.onSend?.(i);
    try {
      return { kind: 'placed', bet: await api.placeBet(intentBody(i), i.key) };
    } catch (e) {
      if (isDefinitiveRefusal(e)) {
        // A first request refused: nothing exists for the key. A RETRY refused proves nothing about
        // the earlier, uncertain request (a 429 or a pre-check fails before the key is looked up),
        // which may have committed or still be in flight: look the key up, else stay unknown.
        if (n === 0) return { kind: 'refused', error: e };
        try {
          const bet = await findPlaced(api, i);
          if (bet) return { kind: 'placed', bet };
        } catch { /* still unknown */ }
        return { kind: 'unknown', error: e };
      }
      last = e;
    }
  }
  try {
    const bet = await findPlaced(api, i);
    if (bet) return { kind: 'placed', bet };
  } catch { /* still unknown */ }
  return { kind: 'unknown', error: last };
}

/**
 * A pending intent found after a reload or a failed submit: looks the key up without sending the
 * bet again. Found → placed. Missing → not_placed ONLY once the round has stopped taking bets:
 * the API commits a bet under the round row lock and only while the round is OPEN, so after the
 * round has left OPEN no request still in flight (say, one waiting on a lock) can commit any more.
 * Elapsed time proves nothing. The round is read BEFORE the bets, so a bet that committed just
 * before the round closed is already visible to the lookup. Anything else stays unknown.
 */
export async function reconcileIntent(api: Api, i: BetIntent): Promise<Outcome> {
  try {
    const round = await api.round(i.roundId);
    const bet = await findPlaced(api, i);
    if (bet) return { kind: 'placed', bet };
    return round.state !== 'OPEN' ? { kind: 'not_placed' } : { kind: 'unknown', error: null };
  } catch (e) {
    return { kind: 'unknown', error: e };
  }
}
