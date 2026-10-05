import { GLOBAL_RULES, MODES, type PlayMode, quoteDiamonds } from '@preflop/odds-engine';
import type { FastifyRequest } from 'fastify';
import { audit } from '../lib/audit.ts';
import { type Db, type Tx, tx } from '../lib/db.ts';
import { ApiError, conflict, unprocessable } from '../lib/errors.ts';
import { type StoredResponse, findStored, idempotent, keyedRef } from '../lib/idempotency.ts';
import { newId } from '../lib/ids.ts';
import { acct, balance, lockAccount, post } from '../lib/ledger.ts';
import type { MoneyRail, PaymentIntent, ProviderResult } from '../providers/types.ts';

/**
 * Payments: the one place real money enters and leaves the ledger. A `MoneyRail` adapter (docs/21)
 * talks to the outside world; this module owns the `payments` rows, the ledger postings and the
 * audit trail, so every provider behaves the same.
 *
 * A payment runs in three phases, and the provider is never called inside a database transaction:
 *
 * 1. **Prepare** (one transaction, safe to retry): the route's checks, then `preparePayment` writes
 *    the payment row as `pending` with no provider reference yet, and for a payout debits the wallet.
 *    The row's id comes from the player's Idempotency-Key, so a duplicate request finds the row and
 *    returns it instead of asking the provider again. This row is the durable intent: whatever
 *    happens next, the payment is on record.
 * 2. **Call the provider** outside any transaction, with the row's id as the intent id. An adapter
 *    passes that id to the provider as its idempotency key, so even a repeated call cannot create a
 *    second payment there.
 * 3. **Apply** (one transaction): `applyProviderResult` stores the provider's reference; a
 *    `completed` result posts the ledger now, a `pending` one waits for the webhook
 *    (`settlePayment`). A provider error marks the payment `failed` and refunds a payout.
 *
 * Deposits and purchases take effect on completion; a payout debits the wallet in phase 1, so a
 * player can never spend money that is on its way out, and is refunded when it fails. External
 * money is `external:<rail>:<mode>:<currency>`, so the ledger sums to zero per currency.
 *
 * The sandbox adapters have no side effects and complete at once, so demo seeding may run all
 * three phases inside one transaction (`runSandbox`); nothing else may.
 */

export type PayWith = 'EUR' | 'USDT' | 'USDC';

/** Minor units of a EUR-cent price in the paying currency (USDT/USDC have 6 decimals, 1:1 with EUR in the sandbox). */
export function priceIn(payWith: PayWith, cents: number): { mode: PlayMode; currency: PayWith; amountMinor: number } {
  if (payWith === 'EUR') return { mode: 'real-fiat', currency: 'EUR', amountMinor: cents };
  return { mode: 'real-crypto', currency: payWith, amountMinor: cents * 10_000 };
}

export const railOfMode = (mode: PlayMode): 'psp' | 'chain' => (mode === 'real-crypto' ? 'chain' : 'psp');

/** Posts a payment's ledger transaction; a (kind, ref) already posted means this payment already happened. */
async function postOnce(c: Tx, kind: string, ref: string, transfers: Parameters<typeof post>[3]): Promise<void> {
  if (!(await post(c, kind, ref, transfers))) throw conflict('duplicate_payment', 'this payment was already made');
}

export interface PaymentRow {
  id: string; kind: 'deposit' | 'withdrawal' | 'purchase'; method: string; mode: PlayMode; currency: string; amount_minor: number;
  status: 'pending' | 'completed' | 'failed' | 'cancelled'; provider: string; provider_ref: string | null; address: string | null;
  redirect_url?: string | null; created_at: Date; completed_at: Date | null;
}
type FullRow = PaymentRow & { user_id: string | null; org_id: string | null; details: Record<string, unknown> };

const RETURNING = 'id, kind, method, mode, currency, amount_minor, status, provider, provider_ref, address, created_at, completed_at';
const FULL = `${RETURNING}, user_id, org_id, details`;

const shape = (row: FullRow): PaymentRow => {
  const { user_id: _u, org_id: _o, details, ...rest } = row;
  return { ...rest, amount_minor: Number(rest.amount_minor), redirect_url: rest.status === 'pending' ? ((details.redirect_url as string | undefined) ?? null) : null };
};

type Product = { product: 'virtual-chips'; chips: number } | { product: 'diamonds'; diamonds: number; cents_per_hundred: number };

export interface PreparePayment {
  /** From the Idempotency-Key (keyedRef): the same request prepares the same row. */
  id: string;
  rail: MoneyRail;
  kind: PaymentRow['kind'];
  userId?: string | null;
  orgId?: string | null;
  mode: PlayMode;
  currency: string;
  amountMinor: number;
  method: string;
  destination?: string | null;
  /** Purchases: what completion issues. */
  product?: Product;
}

function assertRail(rail: MoneyRail, mode: PlayMode) {
  if (rail.rail !== railOfMode(mode)) throw new ApiError(500, 'internal', `${rail.name} is a ${rail.rail} rail; ${mode} needs ${railOfMode(mode)}`);
}

/**
 * Phase 1: validates, reserves and records the intent as a pending payment with no provider
 * reference. Throws the PK violation (23505) when a payment with this id already exists; the
 * orchestrator treats that as "already in flight or done".
 */
export async function preparePayment(c: Tx, p: PreparePayment): Promise<PaymentRow> {
  assertRail(p.rail, p.mode);
  if (p.kind === 'deposit') {
    if (p.mode !== 'real-fiat' && p.mode !== 'real-crypto') throw unprocessable('invalid_mode', 'deposits are for real-money modes');
    if (!MODES[p.mode].currencies.includes(p.currency)) throw unprocessable('invalid_currency', `${p.currency} is not valid in ${p.mode}`);
  }
  if (p.kind === 'withdrawal' && !MODES[p.mode].cashOut) throw unprocessable('no_cash_out', `${MODES[p.mode].label} cannot be withdrawn`);
  // The row goes in first, so a duplicate (same deterministic id) trips the payments PK here, before
  // the ledger is touched, and the orchestrator replays the pending row; debiting first would make a
  // retry fail on the ledger's (kind, ref) uniqueness or the already-debited balance instead.
  const row = (await c.query<FullRow>(
    `insert into payments (id, user_id, org_id, kind, method, mode, currency, amount_minor, status, provider, provider_ref, address, details)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, null, $10, $11) returning ${FULL}`,
    [p.id, p.userId ?? null, p.orgId ?? null, p.kind, p.method, p.mode, p.currency, p.amountMinor, p.rail.name, p.destination ?? null, JSON.stringify(p.product ?? {})])).rows[0]!;
  if (p.kind === 'withdrawal') {
    const wallet = acct(p.userId!, 'wallet', p.mode, p.currency);
    await lockAccount(c, wallet);
    if ((await balance(c, wallet)) < p.amountMinor) throw unprocessable('insufficient_funds', 'balance too low');
    // The money leaves the wallet now; a failed payout gives it back (refundRow).
    await postOnce(c, 'payment.withdrawal', p.id, [{ from: wallet, to: acct('external', railOfMode(p.mode), p.mode, p.currency), amountMinor: p.amountMinor }]);
  }
  await audit(c, { type: `payment.${p.kind}_requested`, paymentId: p.id, userId: p.userId ?? null, orgId: p.orgId ?? null, mode: p.mode, currency: p.currency, amountMinor: p.amountMinor, provider: p.rail.name });
  return shape(row);
}

/** The intent handed to the adapter: the payment row, with its id as the provider idempotency key. */
export const intentOf = (row: FullRow): PaymentIntent => ({
  id: row.id, userId: row.user_id, orgId: row.org_id, mode: row.mode, currency: row.currency, amountMinor: Number(row.amount_minor), method: row.method, destination: row.address,
});

async function lockRow(c: Tx, id: string): Promise<FullRow | undefined> {
  const r = (await c.query<FullRow>(`select ${FULL} from payments where id = $1 for update`, [id])).rows[0];
  if (r) r.amount_minor = Number(r.amount_minor);
  return r;
}

/** The money moves: deposit → wallet, purchase → PreFlop sales plus the issuance; a payout was debited in phase 1. */
async function completeRow(c: Tx, p: FullRow): Promise<void> {
  if (p.kind === 'deposit') {
    await postOnce(c, 'payment.deposit', p.id, [{ from: acct('external', railOfMode(p.mode), p.mode, p.currency), to: acct(p.user_id!, 'wallet', p.mode, p.currency), amountMinor: p.amount_minor }]);
  } else if (p.kind === 'purchase') {
    await postOnce(c, 'payment.purchase', p.id, [{ from: acct('external', railOfMode(p.mode), p.mode, p.currency), to: acct('PreFlop', 'sales', p.mode, p.currency), amountMinor: p.amount_minor }]);
    const product = p.details as Product;
    if (product.product === 'virtual-chips') {
      const to = p.org_id ? acct(p.org_id, 'treasury', 'virtual-chips', 'CHIP') : acct(p.user_id!, 'wallet', 'virtual-chips', 'CHIP');
      await postOnce(c, 'chips.issue', p.id, [{ from: acct('PreFlop', 'issuance', 'virtual-chips', 'CHIP'), to, amountMinor: product.chips }]);
    } else {
      await postOnce(c, 'diamonds.issue', p.id, [{ from: acct('PreFlop', 'issuance', 'diamonds', 'DIAMOND'), to: acct(p.org_id!, 'treasury', 'diamonds', 'DIAMOND'), amountMinor: product.diamonds }]);
    }
  }
}

/** A failed payout returns the money debited in phase 1; nothing else moved. */
async function refundRow(c: Tx, p: FullRow): Promise<void> {
  if (p.kind !== 'withdrawal') return;
  await postOnce(c, 'payment.withdrawal_refund', p.id, [{ from: acct('external', railOfMode(p.mode), p.mode, p.currency), to: acct(p.user_id!, 'wallet', p.mode, p.currency), amountMinor: p.amount_minor }]);
}

async function setStatus(c: Tx, p: FullRow, status: 'completed' | 'failed', details: Record<string, unknown>, extra?: { ref?: string; address?: string | null }): Promise<PaymentRow> {
  const row = (await c.query<FullRow>(
    `update payments set status = $2, completed_at = case when $2 = 'completed' then now() end, details = details || $3::jsonb,
        provider_ref = coalesce($4, provider_ref), address = coalesce($5, address) where id = $1 returning ${FULL}`,
    [p.id, status, JSON.stringify(details), extra?.ref ?? null, extra?.address ?? null])).rows[0]!;
  await audit(c, { type: `payment.${p.kind}_${status}`, paymentId: p.id, userId: p.user_id, orgId: p.org_id, mode: p.mode, currency: p.currency, amountMinor: p.amount_minor, provider: p.provider, providerRef: row.provider_ref });
  return shape(row);
}

/**
 * Phase 3: records what the provider answered. Idempotent: a payment that already carries a
 * provider reference or is no longer pending is returned unchanged.
 */
export async function applyProviderResult(c: Tx, id: string, r: ProviderResult): Promise<PaymentRow> {
  const p = await lockRow(c, id);
  if (!p) throw new ApiError(500, 'internal', `payment ${id} vanished between phases`);
  if (p.status !== 'pending' || p.provider_ref !== null) return shape(p);
  const details = { ...(r.details ?? {}), ...(r.status === 'pending' && r.redirect_url ? { redirect_url: r.redirect_url } : {}) };
  if (r.status === 'completed') {
    await completeRow(c, p);
    return setStatus(c, p, 'completed', details, { ref: r.ref, address: r.address ?? null });
  }
  const row = (await c.query<FullRow>(
    `update payments set provider_ref = $2, address = coalesce($3, address), details = details || $4::jsonb where id = $1 returning ${FULL}`,
    [id, r.ref, r.address ?? null, JSON.stringify(details)])).rows[0]!;
  await audit(c, { type: `payment.${p.kind}_pending`, paymentId: id, userId: p.user_id, orgId: p.org_id, provider: p.provider, providerRef: r.ref });
  return shape(row);
}

/** The provider call failed (or threw): the payment is failed and a payout refunded. Idempotent. */
export async function failPayment(c: Tx, id: string, reason: string): Promise<PaymentRow> {
  const p = await lockRow(c, id);
  if (!p) throw new ApiError(500, 'internal', `payment ${id} vanished between phases`);
  if (p.status !== 'pending') return shape(p);
  await refundRow(c, p);
  return setStatus(c, p, 'failed', { error: reason.slice(0, 500) });
}

/**
 * Applies a provider's verdict on a pending payment (from its webhook). Idempotent: a payment
 * already settled is returned unchanged, and an unknown reference is `null` (the route answers 200
 * so the provider stops retrying; the delivery is still audited).
 */
export async function settlePayment(c: Tx, provider: string, providerRef: string, status: 'completed' | 'failed', details: Record<string, unknown> = {}): Promise<PaymentRow | null> {
  const p = (await c.query<FullRow>(`select ${FULL} from payments where provider = $1 and provider_ref = $2 for update`, [provider, providerRef])).rows[0];
  if (!p) return null;
  p.amount_minor = Number(p.amount_minor);
  if (p.status !== 'pending') return shape(p);
  if (status === 'completed') await completeRow(c, p);
  else await refundRow(c, p);
  return setStatus(c, p, status, details);
}

/** The error the player sees when the provider refused or failed; the payment row says the same. */
export const providerFailed = (name: string, e: unknown) =>
  new ApiError(502, 'provider_error', `${name} could not take this payment: ${e instanceof Error ? e.message : String(e)}`);

/**
 * The three phases for a route (docs/21). The route's `prepare` runs its checks and calls
 * `preparePayment` with the given id; it may run more than once (a serialization retry) but has no
 * outside effects. The provider is called exactly once per new payment, outside any transaction.
 * The stored idempotent response is the final one, so a retry with the same key replays it.
 */
export async function runPayment(db: Db, principal: string, key: string, req: FastifyRequest, rail: MoneyRail, call: 'createDeposit' | 'createPayout',
  prepare: (c: Tx, id: string) => Promise<void>): Promise<StoredResponse> {
  const id = keyedRef('pay', principal, key);
  const raw = req.rawBody ?? '';
  // Phase 1. A finished request replays its stored answer; an unfinished duplicate is recognised by
  // the payment row itself (the PK on its deterministic id), which also serialises concurrent ones.
  const prepared = await tx(db, async (c): Promise<{ stored: StoredResponse } | { fresh: boolean }> => {
    const stored = await findStored(c, principal, key, req.method, req.url, raw);
    if (stored) return { stored };
    try {
      await prepare(c, id);
      return { fresh: true };
    } catch (e) {
      if ((e as { code?: string }).code === '23505' && String((e as Error).message).includes('payments_pkey')) return { fresh: false };
      throw e;
    }
  });
  if ('stored' in prepared) return prepared.stored;
  const row = await tx(db, async (c) => lockRow(c, id));
  if (!row) throw new ApiError(500, 'internal', 'payment row missing after prepare');
  if (!prepared.fresh || row.provider_ref !== null || row.status !== 'pending') {
    // Already in flight (a concurrent duplicate) or done: answer with the row as it is.
    return { status: 201, body: shape(row) };
  }
  // Phase 2: outside any transaction, with the row's id as the provider idempotency key.
  let result: ProviderResult | null = null;
  let failure: unknown = null;
  try { result = await rail[call](intentOf(row)); } catch (e) { failure = e; }
  // Phase 3.
  return tx(db, async (c) => idempotent(c, principal, key, req.method, req.url, raw, async () => {
    if (result) return { status: 201, body: await applyProviderResult(c, id, result) };
    const failed = await failPayment(c, id, failure instanceof Error ? failure.message : String(failure));
    const err = providerFailed(rail.name, failure);
    return { status: err.status, body: { type: err.type, title: err.message, status: err.status, payment: failed } };
  }));
}

/**
 * Sandbox only (demo seeding, tests): the adapter has no side effects and answers at once, so the
 * three phases may share one transaction.
 */
export async function runSandbox(c: Tx, p: PreparePayment, call: 'createDeposit' | 'createPayout' = 'createDeposit'): Promise<PaymentRow> {
  if (p.rail.name !== 'sandbox') throw new ApiError(500, 'internal', 'runSandbox is for the sandbox adapters only');
  await preparePayment(c, p);
  const row = (await lockRow(c, p.id))!;
  return applyProviderResult(c, p.id, await p.rail[call](intentOf(row)));
}

/** What a chip purchase costs and issues: 100 chips per euro, at least 100 chips. */
export function chipsPurchase(chips: number, payWith: PayWith): Pick<PreparePayment, 'mode' | 'currency' | 'amountMinor' | 'method' | 'product'> {
  if (!Number.isSafeInteger(chips) || chips < 100) throw unprocessable('invalid_amount', 'buy at least 100 chips');
  const cents = Math.ceil((chips * 100) / GLOBAL_RULES.virtualChips.chipsPerEuro);
  return { ...priceIn(payWith, cents), method: payWith === 'EUR' ? 'card' : 'stablecoin', product: { product: 'virtual-chips', chips } };
}

/** What a diamond purchase costs and issues (volume-priced, docs/08), at least 1,000 diamonds. */
export function diamondsPurchase(diamonds: number, payWith: PayWith): Pick<PreparePayment, 'mode' | 'currency' | 'amountMinor' | 'method' | 'product'> {
  if (!Number.isSafeInteger(diamonds) || diamonds < 1000) throw unprocessable('invalid_amount', 'buy at least 1,000 diamonds');
  const q = quoteDiamonds(diamonds);
  return { ...priceIn(payWith, q.cents), method: payWith === 'EUR' ? 'card' : 'stablecoin', product: { product: 'diamonds', diamonds, cents_per_hundred: q.centsPerHundred } };
}

export const DIAMOND_PACKS = [1_000, 10_000, 100_000, 1_000_000];

export function diamondPacks() {
  return DIAMOND_PACKS.map((d) => {
    const q = quoteDiamonds(d);
    return { diamonds: d, price_minor: q.cents, currency: 'EUR', unit_price_minor: q.centsPerHundred, tier: `€${(q.centsPerHundred / 100).toFixed(2)} per 100 ◆` };
  });
}

export function assertPositive(n: unknown, what = 'amount'): number {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) throw new ApiError(422, 'invalid_amount', `${what} must be a positive whole number of minor units`);
  return n;
}

/** A fresh payment id for callers without an Idempotency-Key (demo seeding). */
export const freshPaymentId = () => newId('pay');
