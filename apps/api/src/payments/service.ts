import { GLOBAL_RULES, MODES, type PlayMode, quoteDiamonds } from '@preflop/odds-engine';
import { audit } from '../lib/audit.ts';
import type { Tx } from '../lib/db.ts';
import { ApiError, conflict, unprocessable } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { acct, balance, lockAccount, post } from '../lib/ledger.ts';
import type { MoneyRail, PaymentIntent, ProviderResult } from '../providers/types.ts';

/**
 * Payments: the one place real money enters and leaves the ledger. A `MoneyRail` adapter (docs/21)
 * talks to the outside world; this module owns the `payments` rows, the ledger postings and the
 * audit trail, so every provider behaves the same:
 *
 * - a `completed` result posts the ledger now (the sandbox, an instant card capture);
 * - a `pending` result records the payment and posts nothing until the provider's webhook reports
 *   the outcome through `settlePayment` (deposits and purchases take effect then; a failed payout
 *   is refunded then). A payout debits the wallet when it is requested, so a player can never
 *   spend money that is on its way out.
 *
 * External money is represented by `external:<rail>:<mode>:<currency>` accounts, so the ledger
 * still sums to zero per currency and every euro or stablecoin unit is traceable.
 *
 * Routes pass a payment id derived from the caller's Idempotency-Key (lib/idempotency.ts keyedRef):
 * the ledger is unique on (kind, ref) and payments on id and (provider, provider_ref), so a retry
 * can never move money twice. Without an id (demo seeding) a fresh one is used.
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

const RETURNING = 'id, kind, method, mode, currency, amount_minor, status, provider, provider_ref, address, created_at, completed_at';

async function record(c: Tx, p: {
  id: string; userId?: string | null; orgId?: string | null; kind: PaymentRow['kind']; method: string; mode: PlayMode; currency: string;
  amountMinor: number; provider: string; result: ProviderResult; details?: Record<string, unknown>;
}): Promise<PaymentRow> {
  const row = (await c.query<PaymentRow>(
    `insert into payments (id, user_id, org_id, kind, method, mode, currency, amount_minor, status, provider, provider_ref, address, details, completed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, case when $9 = 'completed' then now() end) returning ${RETURNING}`,
    [p.id, p.userId ?? null, p.orgId ?? null, p.kind, p.method, p.mode, p.currency, p.amountMinor, p.result.status, p.provider, p.result.ref,
      p.result.address ?? null, JSON.stringify({ ...(p.result.details ?? {}), ...(p.details ?? {}) })])).rows[0]!;
  row.amount_minor = Number(row.amount_minor);
  return { ...row, redirect_url: p.result.redirect_url ?? null };
}

function assertRealMode(mode: PlayMode, currency: string) {
  if (mode !== 'real-fiat' && mode !== 'real-crypto') throw unprocessable('invalid_mode', 'deposits are for real-money modes');
  if (!MODES[mode].currencies.includes(currency)) throw unprocessable('invalid_currency', `${currency} is not valid in ${mode}`);
}

function assertRail(rail: MoneyRail, mode: PlayMode) {
  if (rail.rail !== railOfMode(mode)) throw new ApiError(500, 'internal', `${rail.name} is a ${rail.rail} rail; ${mode} needs ${railOfMode(mode)}`);
}

/** External rail → player wallet. */
const depositPosting = (c: Tx, id: string, userId: string, mode: PlayMode, currency: string, amountMinor: number) =>
  postOnce(c, 'payment.deposit', id, [{ from: acct('external', railOfMode(mode), mode, currency), to: acct(userId, 'wallet', mode, currency), amountMinor }]);

/** Player deposit of real money (fiat or stablecoin) into the PreFlop wallet. */
export async function deposit(c: Tx, rail: MoneyRail, userId: string, mode: PlayMode, currency: string, amountMinor: number, method: string, id = newId('pay')): Promise<PaymentRow> {
  assertRealMode(mode, currency);
  assertRail(rail, mode);
  const intent: PaymentIntent = { id, userId, mode, currency, amountMinor, method };
  const r = await rail.createDeposit(c, intent);
  if (r.status === 'completed') await depositPosting(c, id, userId, mode, currency, amountMinor);
  await audit(c, { type: r.status === 'completed' ? 'payment.deposit' : 'payment.deposit_pending', paymentId: id, userId, mode, currency, amountMinor, provider: rail.name, providerRef: r.ref });
  return record(c, { id, userId, kind: 'deposit', method, mode, currency, amountMinor, provider: rail.name, result: r });
}

/** Payout to the player. The wallet is debited now; a failed payout is refunded by `settlePayment`. */
export async function withdraw(c: Tx, rail: MoneyRail, userId: string, mode: PlayMode, currency: string, amountMinor: number, method: string, destination?: string, id = newId('pay')): Promise<PaymentRow> {
  if (!MODES[mode].cashOut) throw unprocessable('no_cash_out', `${MODES[mode].label} cannot be withdrawn`);
  assertRail(rail, mode);
  const wallet = acct(userId, 'wallet', mode, currency);
  await lockAccount(c, wallet);
  if ((await balance(c, wallet)) < amountMinor) throw unprocessable('insufficient_funds', 'balance too low');
  await postOnce(c, 'payment.withdrawal', id, [{ from: wallet, to: acct('external', railOfMode(mode), mode, currency), amountMinor }]);
  const r = await rail.createPayout(c, { id, userId, mode, currency, amountMinor, method, destination: destination ?? null });
  await audit(c, { type: 'payment.withdrawal', paymentId: id, userId, mode, currency, amountMinor, provider: rail.name, providerRef: r.ref, status: r.status });
  return record(c, { id, userId, kind: 'withdrawal', method, mode, currency, amountMinor, provider: rail.name, result: { ...r, address: r.address ?? destination ?? null } });
}

/** Money in for a purchase (chips or diamonds): external rail → PreFlop sales. */
const chargePosting = (c: Tx, id: string, mode: PlayMode, currency: string, amountMinor: number) =>
  postOnce(c, 'payment.purchase', id, [{ from: acct('external', railOfMode(mode), mode, currency), to: acct('PreFlop', 'sales', mode, currency), amountMinor }]);

type Product = { product: 'virtual-chips'; chips: number } | { product: 'diamonds'; diamonds: number; cents_per_hundred: number };

/** Issues what a completed purchase paid for, from PreFlop's issuance account to the buyer. */
async function issue(c: Tx, id: string, buyer: { userId?: string | null; orgId?: string | null }, product: Product) {
  if (product.product === 'virtual-chips') {
    const to = buyer.orgId ? acct(buyer.orgId, 'treasury', 'virtual-chips', 'CHIP') : acct(buyer.userId!, 'wallet', 'virtual-chips', 'CHIP');
    await postOnce(c, 'chips.issue', id, [{ from: acct('PreFlop', 'issuance', 'virtual-chips', 'CHIP'), to, amountMinor: product.chips }]);
  } else {
    await postOnce(c, 'diamonds.issue', id, [{ from: acct('PreFlop', 'issuance', 'diamonds', 'DIAMOND'), to: acct(buyer.orgId!, 'treasury', 'diamonds', 'DIAMOND'), amountMinor: product.diamonds }]);
  }
}

async function purchase(c: Tx, rail: MoneyRail, id: string, buyer: { userId?: string; orgId?: string }, payWith: PayWith, cents: number, product: Product, auditType: string, auditExtra: Record<string, unknown>) {
  const p = priceIn(payWith, cents);
  assertRail(rail, p.mode);
  const r = await rail.createDeposit(c, { id, userId: buyer.userId ?? null, orgId: buyer.orgId ?? null, mode: p.mode, currency: p.currency, amountMinor: p.amountMinor, method: payWith === 'EUR' ? 'card' : 'stablecoin' });
  if (r.status === 'completed') {
    await chargePosting(c, id, p.mode, p.currency, p.amountMinor);
    await issue(c, id, buyer, product);
  }
  await audit(c, { type: r.status === 'completed' ? auditType : `${auditType}_pending`, paymentId: id, ...buyer, ...auditExtra, payWith, cents, provider: rail.name, providerRef: r.ref });
  return record(c, { id, userId: buyer.userId ?? null, orgId: buyer.orgId ?? null, kind: 'purchase', method: payWith === 'EUR' ? 'card' : 'stablecoin', mode: p.mode, currency: p.currency, amountMinor: p.amountMinor, provider: rail.name, result: r, details: product });
}

/** A player (or an organization) buys virtual chips from PreFlop: 100 chips per euro. */
export async function buyChips(c: Tx, rail: MoneyRail, buyer: { userId?: string; orgId?: string }, chips: number, payWith: PayWith, id = newId('pay')): Promise<PaymentRow> {
  if (!Number.isSafeInteger(chips) || chips < 100) throw unprocessable('invalid_amount', 'buy at least 100 chips');
  const cents = Math.ceil((chips * 100) / GLOBAL_RULES.virtualChips.chipsPerEuro);
  return purchase(c, rail, id, buyer, payWith, cents, { product: 'virtual-chips', chips }, 'chips.purchased', { chips });
}

/** An organizer buys diamonds from PreFlop (volume-priced, docs/08). */
export async function buyDiamonds(c: Tx, rail: MoneyRail, orgId: string, diamonds: number, payWith: PayWith, id = newId('pay')): Promise<PaymentRow> {
  if (!Number.isSafeInteger(diamonds) || diamonds < 1000) throw unprocessable('invalid_amount', 'buy at least 1,000 diamonds');
  const q = quoteDiamonds(diamonds);
  return purchase(c, rail, id, { orgId }, payWith, q.cents, { product: 'diamonds', diamonds, cents_per_hundred: q.centsPerHundred }, 'diamonds.purchased', { diamonds });
}

/**
 * Applies a provider's verdict on a pending payment (from its webhook). Idempotent: a payment
 * already settled is returned unchanged, and an unknown reference is `null` (the route answers 200
 * so the provider stops retrying; the delivery is still audited).
 */
export async function settlePayment(c: Tx, provider: string, providerRef: string, status: 'completed' | 'failed', details: Record<string, unknown> = {}): Promise<PaymentRow | null> {
  const p = (await c.query<PaymentRow & { user_id: string | null; org_id: string | null; details: Record<string, unknown> }>(
    `select ${RETURNING}, user_id, org_id, details from payments where provider = $1 and provider_ref = $2 for update`, [provider, providerRef])).rows[0];
  if (!p) return null;
  p.amount_minor = Number(p.amount_minor);
  if (p.status !== 'pending') return p;
  if (status === 'completed') {
    if (p.kind === 'deposit') await depositPosting(c, p.id, p.user_id!, p.mode, p.currency, p.amount_minor);
    else if (p.kind === 'purchase') {
      await chargePosting(c, p.id, p.mode, p.currency, p.amount_minor);
      await issue(c, p.id, { userId: p.user_id, orgId: p.org_id }, p.details as Product);
    }
    // A completed payout needs nothing more: the wallet was debited when it was requested.
  } else if (p.kind === 'withdrawal') {
    // The money never left: give it back.
    await postOnce(c, 'payment.withdrawal_refund', p.id, [{ from: acct('external', railOfMode(p.mode), p.mode, p.currency), to: acct(p.user_id!, 'wallet', p.mode, p.currency), amountMinor: p.amount_minor }]);
  }
  const row = (await c.query<PaymentRow>(
    `update payments set status = $2, completed_at = case when $2 = 'completed' then now() end, details = details || $3::jsonb where id = $1 returning ${RETURNING}`,
    [p.id, status, JSON.stringify(details)])).rows[0]!;
  row.amount_minor = Number(row.amount_minor);
  await audit(c, { type: `payment.${p.kind}_${status}`, paymentId: p.id, userId: p.user_id, orgId: p.org_id, mode: p.mode, currency: p.currency, amountMinor: p.amount_minor, provider, providerRef });
  return row;
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
