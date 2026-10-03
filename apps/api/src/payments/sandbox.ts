import { GLOBAL_RULES, MODES, type PlayMode, quoteDiamonds, sha256Hex } from '@preflop/odds-engine';
import { audit } from '../lib/audit.ts';
import type { Tx } from '../lib/db.ts';
import { ApiError, conflict, unprocessable } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { acct, balance, lockAccount, post } from '../lib/ledger.ts';

/**
 * Sandbox payment rail. Every payment is recorded in `payments` and moves money only through
 * the ledger. Card/bank and stablecoin payments complete immediately in the sandbox; a real
 * provider (PSP, custody) replaces `complete()` with its webhook and keeps the same postings.
 *
 * External money is represented by `external:<rail>:<mode>:<currency>` accounts, so the ledger
 * still sums to zero per currency and every euro or stablecoin unit is traceable.
 *
 * Routes pass a payment id derived from the caller's Idempotency-Key (lib/idempotency.ts keyedRef):
 * the ledger is unique on (kind, ref) and payments on id and provider_ref, so a retry can never
 * move money twice. Without an id (demo seeding) a fresh one is used.
 */

export type PayWith = 'EUR' | 'USDT' | 'USDC';

/** Minor units of a EUR-cent price in the paying currency (USDT/USDC have 6 decimals, 1:1 with EUR in the sandbox). */
export function priceIn(payWith: PayWith, cents: number): { mode: PlayMode; currency: PayWith; amountMinor: number } {
  if (payWith === 'EUR') return { mode: 'real-fiat', currency: 'EUR', amountMinor: cents };
  return { mode: 'real-crypto', currency: payWith, amountMinor: cents * 10_000 };
}

const sandboxAddress = (id: string) => `0x${sha256Hex(id).slice(0, 40)}`;

/** Posts a payment's ledger transaction; a (kind, ref) already posted means this payment already happened. */
async function postOnce(c: Tx, kind: string, ref: string, transfers: Parameters<typeof post>[3]): Promise<void> {
  if (!(await post(c, kind, ref, transfers))) throw conflict('duplicate_payment', 'this payment was already made');
}

async function record(c: Tx, p: { id: string; userId?: string | null; orgId?: string | null; kind: 'deposit' | 'withdrawal' | 'purchase'; method: string; mode: PlayMode; currency: string; amountMinor: number; address?: string | null; details?: Record<string, unknown> }) {
  const row = (await c.query(
    `insert into payments (id, user_id, org_id, kind, method, mode, currency, amount_minor, status, provider_ref, address, details, completed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9, $10, $11, now()) returning id, kind, method, currency, amount_minor, status, created_at, address`,
    [p.id, p.userId ?? null, p.orgId ?? null, p.kind, p.method, p.mode, p.currency, p.amountMinor, `sbx_${p.id}`, p.address ?? null, JSON.stringify({ sandbox: true, ...(p.details ?? {}) })])).rows[0];
  return row;
}

/** Player deposit of real money (fiat or stablecoin) into the PreFlop wallet. */
export async function deposit(c: Tx, userId: string, mode: PlayMode, currency: string, amountMinor: number, method: string, id = newId('pay')) {
  if (mode !== 'real-fiat' && mode !== 'real-crypto') throw unprocessable('invalid_mode', 'deposits are for real-money modes');
  if (!MODES[mode].currencies.includes(currency)) throw unprocessable('invalid_currency', `${currency} is not valid in ${mode}`);
  const rail = mode === 'real-crypto' ? 'chain' : 'psp';
  await postOnce(c, 'payment.deposit', id, [{ from: acct('external', rail, mode, currency), to: acct(userId, 'wallet', mode, currency), amountMinor }]);
  await audit(c, { type: 'payment.deposit', paymentId: id, userId, mode, currency, amountMinor });
  return record(c, { id, userId, kind: 'deposit', method, mode, currency, amountMinor, address: mode === 'real-crypto' ? sandboxAddress(id) : null, details: mode === 'real-crypto' ? { network: 'sandbox', confirmations: 12 } : {} });
}

export async function withdraw(c: Tx, userId: string, mode: PlayMode, currency: string, amountMinor: number, method: string, destination?: string, id = newId('pay')) {
  if (!MODES[mode].cashOut) throw unprocessable('no_cash_out', `${MODES[mode].label} cannot be withdrawn`);
  const wallet = acct(userId, 'wallet', mode, currency);
  await lockAccount(c, wallet);
  if ((await balance(c, wallet)) < amountMinor) throw unprocessable('insufficient_funds', 'balance too low');
  const rail = mode === 'real-crypto' ? 'chain' : 'psp';
  await postOnce(c, 'payment.withdrawal', id, [{ from: wallet, to: acct('external', rail, mode, currency), amountMinor }]);
  await audit(c, { type: 'payment.withdrawal', paymentId: id, userId, mode, currency, amountMinor });
  return record(c, { id, userId, kind: 'withdrawal', method, mode, currency, amountMinor, address: destination ?? null });
}

/** Money in for a purchase (chips or diamonds): external rail → PreFlop sales. */
async function chargePurchase(c: Tx, id: string, payWith: PayWith, cents: number) {
  const p = priceIn(payWith, cents);
  const rail = p.mode === 'real-crypto' ? 'chain' : 'psp';
  await postOnce(c, 'payment.purchase', id, [{ from: acct('external', rail, p.mode, p.currency), to: acct('PreFlop', 'sales', p.mode, p.currency), amountMinor: p.amountMinor }]);
  return p;
}

/** A player (or an organization) buys virtual chips from PreFlop: 100 chips per euro. */
export async function buyChips(c: Tx, buyer: { userId?: string; orgId?: string }, chips: number, payWith: PayWith, id = newId('pay')) {
  if (!Number.isSafeInteger(chips) || chips < 100) throw unprocessable('invalid_amount', 'buy at least 100 chips');
  const cents = Math.ceil((chips * 100) / GLOBAL_RULES.virtualChips.chipsPerEuro);
  const p = await chargePurchase(c, id, payWith, cents);
  const to = buyer.orgId ? acct(buyer.orgId, 'treasury', 'virtual-chips', 'CHIP') : acct(buyer.userId!, 'wallet', 'virtual-chips', 'CHIP');
  await postOnce(c, 'chips.issue', id, [{ from: acct('PreFlop', 'issuance', 'virtual-chips', 'CHIP'), to, amountMinor: chips }]);
  await audit(c, { type: 'chips.purchased', paymentId: id, ...buyer, chips, payWith, cents });
  return record(c, { id, userId: buyer.userId ?? null, orgId: buyer.orgId ?? null, kind: 'purchase', method: payWith === 'EUR' ? 'card' : 'stablecoin', mode: p.mode, currency: p.currency, amountMinor: p.amountMinor, details: { product: 'virtual-chips', chips } });
}

/** An organizer buys diamonds from PreFlop (volume-priced, docs/08). */
export async function buyDiamonds(c: Tx, orgId: string, diamonds: number, payWith: PayWith, id = newId('pay')) {
  if (!Number.isSafeInteger(diamonds) || diamonds < 1000) throw unprocessable('invalid_amount', 'buy at least 1,000 diamonds');
  const q = quoteDiamonds(diamonds);
  const p = await chargePurchase(c, id, payWith, q.cents);
  await postOnce(c, 'diamonds.issue', id, [{ from: acct('PreFlop', 'issuance', 'diamonds', 'DIAMOND'), to: acct(orgId, 'treasury', 'diamonds', 'DIAMOND'), amountMinor: diamonds }]);
  await audit(c, { type: 'diamonds.purchased', paymentId: id, orgId, diamonds, payWith, cents: q.cents });
  return record(c, { id, orgId, kind: 'purchase', method: payWith === 'EUR' ? 'card' : 'stablecoin', mode: p.mode, currency: p.currency, amountMinor: p.amountMinor, details: { product: 'diamonds', diamonds, cents_per_hundred: q.centsPerHundred } });
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
