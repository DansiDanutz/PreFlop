import type { PlayMode } from '@preflop/odds-engine';
import type { Tx } from '../lib/db.ts';

/**
 * Provider adapters (docs/21). Real money needs three outside services, each behind one interface:
 *
 * - a KYC provider verifies a player's identity (`KycProvider`);
 * - a payment service provider (PSP) moves fiat: card and bank deposits, bank payouts (`MoneyRail`, rail `psp`);
 * - a custody provider moves stablecoins: deposit addresses, confirmations, payouts (`MoneyRail`, rail `chain`).
 *
 * The ledger postings, the `payments` rows, idempotency and the audit trail live in payments/service.ts
 * and are the same for every provider. An adapter only talks to the outside service and reports
 * either an immediate result or "pending", and later the outcome through its webhook.
 *
 * Every method runs inside the caller's transaction: an adapter must not open its own, and must not
 * commit anything irreversible before returning (a provider call that cannot be rolled back belongs
 * in a pending result, confirmed by the webhook).
 */

export type Rail = 'psp' | 'chain';

export interface PaymentIntent {
  /** The payment id, derived from the player's Idempotency-Key: the same intent is never sent twice. */
  id: string;
  userId?: string | null;
  orgId?: string | null;
  mode: PlayMode;
  currency: string;
  amountMinor: number;
  /** As the client described it (card, bank, crypto, …); informative. */
  method: string;
  /** Payouts only: where the money goes (IBAN, address). */
  destination?: string | null;
}

export interface ProviderResult {
  /** `completed`: the money moved and the ledger posts now. `pending`: wait for the webhook. */
  status: 'completed' | 'pending';
  /** The provider's own reference, unique per provider; its webhook names the payment by it. */
  ref: string;
  /** Deposit address (custody) or payout destination echoed back, for the `payments.address` column. */
  address?: string | null;
  /** Where the player continues (3-D Secure page, hosted checkout), when the provider has one. */
  redirect_url?: string | null;
  /** Anything worth keeping with the payment (network, confirmations, card brand); never secrets. */
  details?: Record<string, unknown>;
}

export type ProviderEvent =
  | { type: 'payment'; ref: string; status: 'completed' | 'failed'; details?: Record<string, unknown> }
  | { type: 'kyc'; ref: string; status: 'verified' | 'rejected' | 'pending'; details?: Record<string, unknown> };

/**
 * Parses and authenticates one webhook delivery. Throws ApiError 401 `bad_signature` when the
 * signature or timestamp is wrong; returns the events to apply (possibly none).
 */
export type WebhookHandler = (headers: Record<string, string | string[] | undefined>, rawBody: Buffer) => Promise<ProviderEvent[]>;

export interface MoneyRail {
  /** Provider name as it appears in `payments.provider` and in `POST /v1/webhooks/:provider`. */
  readonly name: string;
  readonly rail: Rail;
  /** Collect money from the payer (a deposit, or the charge of a purchase). */
  createDeposit(c: Tx, intent: PaymentIntent): Promise<ProviderResult>;
  /** Send money out to the player. The wallet is already debited when this runs. */
  createPayout(c: Tx, intent: PaymentIntent): Promise<ProviderResult>;
  webhook?: WebhookHandler;
}

export interface KycResult {
  status: 'verified' | 'pending' | 'rejected';
  /** The provider's applicant/session reference; its webhook names the user by it. */
  ref: string;
  redirect_url?: string | null;
  details?: Record<string, unknown>;
}

export interface KycProvider {
  readonly name: string;
  /** Start (or restart) verification for a user. */
  start(c: Tx, user: { id: string; email: string }): Promise<KycResult>;
  webhook?: WebhookHandler;
}

export interface Providers {
  kyc: KycProvider | null;
  psp: MoneyRail | null;
  custody: MoneyRail | null;
}
