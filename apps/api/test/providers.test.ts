import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.ts';
import { tx } from '../src/lib/db.ts';
import { keyedRef } from '../src/lib/idempotency.ts';
import { acct, balance } from '../src/lib/ledger.ts';
import { noProviders, providersFromConfig } from '../src/providers/index.ts';
import { recoverPayments } from '../src/payments/recovery.ts';
import { chipsPurchase, preparePayment, runPayment, runSandbox } from '../src/payments/service.ts';
import { sandboxCustody, sandboxKyc, sandboxPsp } from '../src/providers/sandbox.ts';
import { type KycProvider, type MoneyRail, type PaymentIntent, type ProviderEvent, ProviderRefused, type Providers } from '../src/providers/types.ts';
import { signWebhook, verifyWebhook } from '../src/providers/webhook.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness, idemKey, ledgerSums, realMoneyReady } from './helpers.ts';

/**
 * Provider adapters (docs/21): the configuration switches, the contract every KYC provider and
 * money rail must honour, and the pending → webhook path that real providers take. The sandbox
 * adapters pass the same contract.
 */

const STRONG_DB = `postgres://preflop:${'k'.repeat(20)}Q7-${'z'.repeat(12)}@db.internal:5432/preflop`;
const PROD = { NODE_ENV: 'production', DATABASE_URL: STRONG_DB, CORS_ORIGINS: 'https://preflop.example.com' };
const problemsOf = (env: NodeJS.ProcessEnv): string[] => {
  try { loadConfig(env); return []; } catch (e) { if (e instanceof ConfigError) return e.problems; throw e; }
};

describe('provider configuration', () => {
  it('development and tests default to the sandbox; production defaults to none and refuses the sandbox', () => {
    expect(loadConfig({}).providers).toEqual({ kyc: 'sandbox', psp: 'sandbox', custody: 'sandbox' });
    expect(loadConfig(PROD).providers).toEqual({ kyc: 'none', psp: 'none', custody: 'none' });
    expect(loadConfig({ KYC_PROVIDER: 'none' }).providers.kyc).toBe('none');
    const p = problemsOf({ ...PROD, PSP_PROVIDER: 'sandbox' });
    expect(p.some((x) => x.startsWith('PSP_PROVIDER=sandbox never runs in production'))).toBe(true);
    expect(() => loadConfig({ KYC_PROVIDER: 'stripe' })).toThrow(ConfigError);
  });

  it('providersFromConfig never builds the sandbox in production, even when told to', () => {
    const dev = providersFromConfig(loadConfig({}));
    expect(dev.kyc?.name).toBe('sandbox');
    expect(dev.psp?.rail).toBe('psp');
    expect(dev.custody?.rail).toBe('chain');
    const prod = providersFromConfig({ ...loadConfig({}), nodeEnv: 'production' });
    expect(prod).toEqual(noProviders);
  });
});

describe('webhook signatures', () => {
  const secret = 'whsec_' + 'a'.repeat(40);
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));
  it('accepts a fresh, correctly signed body and rejects everything else', () => {
    const now = 1_700_000_000;
    const sig = signWebhook(secret, body, now);
    expect(verifyWebhook({ 'x-preflop-signature': sig }, body, { secret, now: () => now + 10 })).toEqual({ hello: 'world' });
    expect(() => verifyWebhook({}, body, { secret, now: () => now })).toThrow(/missing/);
    expect(() => verifyWebhook({ 'x-preflop-signature': sig }, Buffer.from('{"hello":"there"}'), { secret, now: () => now })).toThrow(/mismatch/);
    expect(() => verifyWebhook({ 'x-preflop-signature': sig }, body, { secret: 'other' + secret, now: () => now })).toThrow(/mismatch/);
    expect(() => verifyWebhook({ 'x-preflop-signature': sig }, body, { secret, now: () => now + 301 })).toThrow(/tolerance/);
    expect(() => verifyWebhook({ 'x-preflop-signature': 't=abc,v1=zz' }, body, { secret, now: () => now })).toThrow(/malformed/);
    const notJson = Buffer.from('nope');
    expect(() => verifyWebhook({ 'x-preflop-signature': signWebhook(secret, notJson, now) }, notJson, { secret, now: () => now })).toThrow(/not JSON/);
  });
});

/**
 * A stand-in for a real provider: every call is pending, and the outcome arrives through a signed
 * webhook. This is the shape a Stripe, Checkout.com or Fireblocks adapter takes.
 */
const SECRET = 'whsec_test_' + 'x'.repeat(32);
/** Payment ids the stand-in provider definitely refuses (throws ProviderRefused) when asked. */
const failNext = new Set<string>();
/** Payment ids for which the stand-in provider does not answer (a timeout: uncertain, not a refusal). */
const downNext = new Set<string>();
/** Payment ids the stand-in provider completes at once instead of answering pending. */
const completeNext = new Set<string>();
function pendingRail(name: string, rail: 'psp' | 'chain'): MoneyRail & { intents: PaymentIntent[] } {
  const intents: PaymentIntent[] = [];
  const webhook = async (headers: Record<string, string | string[] | undefined>, raw: Buffer): Promise<ProviderEvent[]> => {
    const b = verifyWebhook(headers, raw, { secret: SECRET }) as { events: ProviderEvent[] };
    return b.events;
  };
  return {
    name, rail, intents,
    async createDeposit(intent) { intents.push(intent); if (failNext.has(intent.id)) throw new ProviderRefused('provider refused the card'); if (downNext.has(intent.id)) throw new Error('ETIMEDOUT: no answer'); return { status: 'pending', ref: `${name}_${intent.id}`, redirect_url: `https://${name}.example/pay/${intent.id}`, address: rail === 'chain' ? '0xdeposit' : null }; },
    async createPayout(intent) { intents.push(intent); if (failNext.has(intent.id)) throw new ProviderRefused('destination refused'); if (downNext.has(intent.id)) throw new Error('ETIMEDOUT: no answer'); return { status: completeNext.has(intent.id) ? 'completed' : 'pending', ref: `${name}_${intent.id}` }; },
    webhook,
  };
}
const pendingKyc: KycProvider = {
  name: 'idp',
  async start(user) { return { status: 'pending', ref: `idp_${user.id}`, redirect_url: 'https://idp.example/verify' }; },
  webhook: async (headers, raw) => (verifyWebhook(headers, raw, { secret: SECRET }) as { events: ProviderEvent[] }).events,
};

describe('provider adapters', () => {
  let h: Harness;
  let admin: string;
  const psp = pendingRail('psp-test', 'psp');
  const custody = pendingRail('custody-test', 'chain');
  const providers: Providers = { kyc: pendingKyc, psp, custody };

  beforeAll(async () => {
    h = await harness('providers', {}, { providers });
    await tx(h.db, (c) => seedAdmin(c, 'admin@test.dev', 'admin-pass-1'));
    admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'admin@test.dev', password: 'admin-pass-1' })).body.token;
    await h.api('PUT', '/v1/admin/settings/modes_enabled', admin, { value: { play: true, 'virtual-chips': true, diamonds: true, 'real-fiat': true, 'real-crypto': true } });
  });
  afterAll(async () => { await h.close(); });

  const hook = (provider: string, events: ProviderEvent[], tamper = false) => {
    const raw = JSON.stringify({ events });
    const sig = signWebhook(SECRET, raw, Math.floor(Date.now() / 1000));
    return h.app.inject({ method: 'POST', url: `/v1/webhooks/${provider}`, headers: { 'content-type': 'application/json', 'x-preflop-signature': tamper ? sig.replace(/v1=(.)/, (_, c) => `v1=${c === '0' ? '1' : '0'}`) : sig }, payload: raw })
      .then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
  };
  const wallet = (userId: string, mode: 'real-fiat' | 'real-crypto', currency: string) => tx(h.db, (c) => balance(c, acct(userId, 'wallet', mode, currency)));

  it('KYC: pending from the provider, verified by its webhook; a webhook never downgrades a verified user', async () => {
    const p = await h.register('Kyc');
    await realMoneyReady(h, p.id);
    const started = await h.api('POST', '/v1/me/kyc', p.token, {});
    expect(started.body).toEqual({ kyc_status: 'pending', provider: 'idp', redirect_url: 'https://idp.example/verify' });
    expect((await h.api('GET', '/v1/me', p.token)).body.kyc_status).toBe('pending');
    const dep = { mode: 'real-fiat', currency: 'EUR', amount_minor: 5_000, method: 'card' };
    expect((await h.api('POST', '/v1/me/deposits', p.token, dep, idemKey())).body.type).toBe('kyc_required');
    // Unknown reference: acknowledged, applied to nobody.
    expect((await hook('idp', [{ type: 'kyc', ref: 'idp_nobody', status: 'verified' }])).body).toEqual({ received: 1, applied: 0 });
    expect((await hook('idp', [{ type: 'kyc', ref: `idp_${p.id}`, status: 'verified' }])).body).toEqual({ received: 1, applied: 1 });
    expect((await h.api('GET', '/v1/me', p.token)).body.kyc_status).toBe('verified');
    expect((await hook('idp', [{ type: 'kyc', ref: `idp_${p.id}`, status: 'rejected' }])).body.applied).toBe(0);
    expect((await h.api('GET', '/v1/me', p.token)).body.kyc_status).toBe('verified');
    // Already verified: starting again is a no-op answer, no new provider session.
    expect((await h.api('POST', '/v1/me/kyc', p.token, {})).body).toEqual({ kyc_status: 'verified', provider: 'idp' });
  });

  async function verifiedPlayer(name: string) {
    const p = await h.register(name);
    await realMoneyReady(h, p.id);
    await h.api('POST', '/v1/me/kyc', p.token, {});
    await hook('idp', [{ type: 'kyc', ref: `idp_${p.id}`, status: 'verified' }]);
    return p;
  }

  it('deposit: pending posts nothing; the webhook credits the wallet once, replays are idempotent', async () => {
    const p = await verifiedPlayer('Dep');
    const dep = { mode: 'real-fiat', currency: 'EUR', amount_minor: 5_000, method: 'card' };
    const key = idemKey();
    const r = await h.api('POST', '/v1/me/deposits', p.token, dep, key);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'pending', provider: 'psp-test', provider_ref: `psp-test_${r.body.id}`, redirect_url: `https://psp-test.example/pay/${r.body.id}` });
    expect(await wallet(p.id, 'real-fiat', 'EUR')).toBe(0);
    // A retry replays the stored answer and does not ask the provider again.
    const before = psp.intents.length;
    expect((await h.api('POST', '/v1/me/deposits', p.token, dep, key)).body.id).toBe(r.body.id);
    expect(psp.intents.length).toBe(before);
    // Tampered signature: 401, nothing changes.
    expect((await hook('psp-test', [{ type: 'payment', ref: r.body.provider_ref, status: 'completed' }], true)).status).toBe(401);
    expect(await wallet(p.id, 'real-fiat', 'EUR')).toBe(0);
    // The verdict: credited exactly once, however often it is delivered.
    expect((await hook('psp-test', [{ type: 'payment', ref: r.body.provider_ref, status: 'completed', details: { card: 'visa' } }])).body).toEqual({ received: 1, applied: 1 });
    expect((await hook('psp-test', [{ type: 'payment', ref: r.body.provider_ref, status: 'completed' }])).body.applied).toBe(1);
    expect(await wallet(p.id, 'real-fiat', 'EUR')).toBe(5_000);
    const row = (await h.api('GET', '/v1/me/payments', p.token)).body.payments.find((x: any) => x.id === r.body.id);
    expect(row.status).toBe('completed');
    expect((await h.db.query('select details from payments where id = $1', [r.body.id])).rows[0].details).toMatchObject({ card: 'visa' });
    // A late "failed" for a completed deposit is ignored.
    expect((await hook('psp-test', [{ type: 'payment', ref: r.body.provider_ref, status: 'failed' }])).body.applied).toBe(1);
    expect(await wallet(p.id, 'real-fiat', 'EUR')).toBe(5_000);
  });

  it('deposit: pending deposits count toward the daily limit, so the webhook can never settle above it', async () => {
    const p = await verifiedPlayer('Lim');
    expect((await h.api('PUT', '/v1/me/limits', p.token, { deposit_day_minor: 1_000 })).body.deposit_day_minor).toBe(1_000);
    const dep = (n: number) => ({ mode: 'real-fiat', currency: 'EUR', amount_minor: n, method: 'card' });
    const first = await h.api('POST', '/v1/me/deposits', p.token, dep(800), idemKey());
    expect(first.body.status).toBe('pending');
    // Nothing is credited yet, but the pending 800 is reserved: another 800 would settle at 1 600.
    expect((await h.api('POST', '/v1/me/deposits', p.token, dep(800), idemKey())).body.type).toBe('limit_reached');
    expect((await h.api('POST', '/v1/me/deposits', p.token, dep(200), idemKey())).status).toBe(201);
    await hook('psp-test', [{ type: 'payment', ref: first.body.provider_ref, status: 'completed' }]);
    expect(await wallet(p.id, 'real-fiat', 'EUR')).toBe(800);
    expect((await h.api('POST', '/v1/me/deposits', p.token, dep(1), idemKey())).body.type).toBe('limit_reached');
  });

  it('payout: the wallet is debited when requested; a failed payout is refunded, a completed one is final', async () => {
    const p = await verifiedPlayer('Pay');
    const r = await h.api('POST', '/v1/me/deposits', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 30_000_000, method: 'crypto' }, idemKey());
    expect(r.body).toMatchObject({ status: 'pending', provider: 'custody-test', address: '0xdeposit' });
    await hook('custody-test', [{ type: 'payment', ref: r.body.provider_ref, status: 'completed' }]);
    expect(await wallet(p.id, 'real-crypto', 'USDT')).toBe(30_000_000);
    const w1 = await h.api('POST', '/v1/me/withdrawals', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 10_000_000, method: 'crypto', destination: '0xabc' }, idemKey());
    expect(w1.body).toMatchObject({ status: 'pending', address: '0xabc' });
    expect(await wallet(p.id, 'real-crypto', 'USDT')).toBe(20_000_000);
    // Cannot spend what is on its way out.
    expect((await h.api('POST', '/v1/me/withdrawals', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 25_000_000, method: 'crypto' }, idemKey())).body.type).toBe('insufficient_funds');
    const w2 = await h.api('POST', '/v1/me/withdrawals', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 5_000_000, method: 'crypto' }, idemKey());
    expect(await wallet(p.id, 'real-crypto', 'USDT')).toBe(15_000_000);
    await hook('custody-test', [{ type: 'payment', ref: w1.body.provider_ref, status: 'failed', details: { reason: 'address rejected' } }, { type: 'payment', ref: w2.body.provider_ref, status: 'completed' }]);
    expect(await wallet(p.id, 'real-crypto', 'USDT')).toBe(25_000_000);
    const rows = (await h.api('GET', '/v1/me/payments', p.token)).body.payments;
    expect(rows.find((x: any) => x.id === w1.body.id).status).toBe('failed');
    expect(rows.find((x: any) => x.id === w2.body.id).status).toBe('completed');
    // Replaying the failure does not refund twice.
    await hook('custody-test', [{ type: 'payment', ref: w1.body.provider_ref, status: 'failed' }]);
    expect(await wallet(p.id, 'real-crypto', 'USDT')).toBe(25_000_000);
  });

  it('the provider is asked once per payment, outside the transaction; a refusal fails the payment and refunds a payout', async () => {
    const p = await verifiedPlayer('Once');
    const dep = { mode: 'real-fiat', currency: 'EUR', amount_minor: 1_500, method: 'card' };
    const before = psp.intents.length;
    const key = idemKey();
    const r1 = await h.api('POST', '/v1/me/deposits', p.token, dep, key);
    const r2 = await h.api('POST', '/v1/me/deposits', p.token, dep, key);
    expect(r1.status).toBe(201);
    expect(r2.body.id).toBe(r1.body.id);
    expect(psp.intents.length).toBe(before + 1); // the retry replayed the stored answer, the provider was not asked again
    // The row existed before the provider was asked, and its id is the provider's idempotency key.
    expect(psp.intents.at(-1)!.id).toBe(r1.body.id);
    expect((await h.db.query('select provider_ref from payments where id = $1', [r1.body.id])).rows[0].provider_ref).toBe(`psp-test_${r1.body.id}`);

    // Fund a USDT wallet; a payout retried with the same key replays the pending row and asks the provider once.
    const fund = await h.api('POST', '/v1/me/deposits', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 9_000_000, method: 'crypto' }, idemKey());
    await hook('custody-test', [{ type: 'payment', ref: fund.body.provider_ref, status: 'completed' }]);
    expect(await wallet(p.id, 'real-crypto', 'USDT')).toBe(9_000_000);
    const kw = idemKey();
    const payouts = custody.intents.length;
    const w1 = await h.api('POST', '/v1/me/withdrawals', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 1_000_000, method: 'crypto', destination: '0xonce' }, kw);
    const w2 = await h.api('POST', '/v1/me/withdrawals', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 1_000_000, method: 'crypto', destination: '0xonce' }, kw);
    expect(w1.status).toBe(201);
    expect(w2.status).toBe(201);
    expect(w2.body.id).toBe(w1.body.id);
    expect(custody.intents.length).toBe(payouts + 1);
    expect(await wallet(p.id, 'real-crypto', 'USDT')).toBe(8_000_000); // debited once
    await hook('custody-test', [{ type: 'payment', ref: w1.body.provider_ref, status: 'completed' }]);
    await hook('custody-test', [{ type: 'payment', ref: 'custody-test_refund_me', status: 'failed' }]); // unknown ref: ignored
    expect(await wallet(p.id, 'real-crypto', 'USDT')).toBe(8_000_000);
    // Then ask for a payout the provider refuses.
    const k = idemKey();
    failNext.add(keyedRef('pay', `user:${p.id}`, k['idempotency-key']!)); // the id the route will derive
    const r3 = await h.api('POST', '/v1/me/withdrawals', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 2_000_000, method: 'crypto', destination: '0xfail' }, k);
    expect(r3.status).toBe(502);
    expect(r3.body.type).toBe('provider_error');
    expect(r3.body.payment).toMatchObject({ status: 'failed', kind: 'withdrawal' });
    // The phase-1 debit was refunded, the failed payment stays on record, and the same key replays the same answer.
    expect(await wallet(p.id, 'real-crypto', 'USDT')).toBe(8_000_000);
    const again = await h.api('POST', '/v1/me/withdrawals', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 2_000_000, method: 'crypto', destination: '0xfail' }, k);
    expect(again.status).toBe(502);
    expect(again.body.payment.id).toBe(r3.body.payment.id);
    expect((await h.api('GET', '/v1/me/payments', p.token)).body.payments.find((x: any) => x.id === r3.body.payment.id).status).toBe('failed');
  });

  it('a provider that does not answer keeps the payment pending: nothing is refunded on a guess, the same id is asked again, and an early webhook is kept until the reference arrives', async () => {
    const p = await verifiedPlayer('Down');
    const fund = await h.api('POST', '/v1/me/deposits', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 5_000_000, method: 'crypto' }, idemKey());
    await hook('custody-test', [{ type: 'payment', ref: fund.body.provider_ref, status: 'completed' }]);
    const k = idemKey();
    const id = keyedRef('pay', `user:${p.id}`, k['idempotency-key']!);
    downNext.add(id);
    const body = { mode: 'real-crypto', currency: 'USDT', amount_minor: 2_000_000, method: 'crypto', destination: '0xdown' };
    const asked = custody.intents.length;
    const r1 = await h.api('POST', '/v1/me/withdrawals', p.token, body, k);
    expect(r1.status).toBe(502);
    expect(r1.body.type).toBe('provider_unavailable');
    expect(r1.body.payment).toMatchObject({ id, status: 'pending', kind: 'withdrawal', provider_ref: null });
    // Debited and NOT refunded: the provider may have paid out already.
    expect(await wallet(p.id, 'real-crypto', 'USDT')).toBe(3_000_000);
    expect(custody.intents.length).toBe(asked + 1);
    // The answer was not stored: the same request asks the provider again, with the same intent id.
    const r2 = await h.api('POST', '/v1/me/withdrawals', p.token, body, k);
    expect(r2.status).toBe(502);
    expect(r2.body.payment.status).toBe('pending');
    expect(custody.intents.length).toBe(asked + 2);
    expect(custody.intents.at(-1)!.id).toBe(id);
    expect(await wallet(p.id, 'real-crypto', 'USDT')).toBe(3_000_000);
    // The same key with a different request is refused, although no answer is stored yet.
    const other = await h.api('POST', '/v1/me/withdrawals', p.token, { ...body, amount_minor: 1_000_000 }, k);
    expect(other.status).toBe(422);
    expect(other.body.type).toBe('idempotency_mismatch');
    // The provider's webhook arrives before its reference was ever stored here: kept, applied to nothing yet.
    const early = await hook('custody-test', [{ type: 'payment', ref: `custody-test_${id}`, status: 'completed' }]);
    expect(early.body).toEqual({ received: 1, applied: 0 });
    // The provider is back. The recovery pass waits out the backoff, then asks again with the same id,
    // stores the reference, and the kept verdict settles the payout at once.
    downNext.delete(id);
    expect((await recoverPayments(h.db, providers, { minAgeMs: 0 })).asked).toBe(0); // not due yet
    expect(await recoverPayments(h.db, providers, { minAgeMs: 0, now: Date.now() + 130_000 })).toEqual({ asked: 1, final: 1 });
    expect(custody.intents.length).toBe(asked + 3);
    expect(custody.intents.at(-1)!.id).toBe(id);
    expect((await h.api('GET', '/v1/me/payments', p.token)).body.payments.find((x: any) => x.id === id).status).toBe('completed');
    expect((await h.db.query('select provider_ref from payments where id = $1', [id])).rows[0].provider_ref).toBe(`custody-test_${id}`);
    expect(await wallet(p.id, 'real-crypto', 'USDT')).toBe(3_000_000);
    expect((await h.db.query('select applied_at from provider_events where provider = $1 and ref = $2', ['custody-test', `custody-test_${id}`])).rows[0].applied_at).not.toBeNull();
    // Nothing left to recover; a retry of the request now returns the settled payment without asking anyone.
    expect(await recoverPayments(h.db, providers, { minAgeMs: 0, now: Date.now() + 130_000 })).toEqual({ asked: 0, final: 0 });
    const r3 = await h.api('POST', '/v1/me/withdrawals', p.token, body, k);
    expect(r3.status).toBe(201);
    expect(r3.body).toMatchObject({ id, status: 'completed' });
    expect(custody.intents.length).toBe(asked + 3);
  });

  it('an early `failed` webhook wins over a later `completed` answer from the provider call', async () => {
    const p = await verifiedPlayer('EarlyFail');
    const fund = await h.api('POST', '/v1/me/deposits', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 4_000_000, method: 'crypto' }, idemKey());
    await hook('custody-test', [{ type: 'payment', ref: fund.body.provider_ref, status: 'completed' }]);
    const k = idemKey();
    const id = keyedRef('pay', `user:${p.id}`, k['idempotency-key']!);
    downNext.add(id);
    const body = { mode: 'real-crypto', currency: 'USDT', amount_minor: 1_000_000, method: 'crypto', destination: '0xearly' };
    expect((await h.api('POST', '/v1/me/withdrawals', p.token, body, k)).status).toBe(502);
    expect(await wallet(p.id, 'real-crypto', 'USDT')).toBe(3_000_000);
    // The provider reports the payout failed before we ever stored its reference.
    expect((await hook('custody-test', [{ type: 'payment', ref: `custody-test_${id}`, status: 'failed' }])).body).toEqual({ received: 1, applied: 0 });
    // Asked again, the provider now answers "completed" for the same intent; the kept verdict is its later word.
    downNext.delete(id);
    completeNext.add(id);
    expect(await recoverPayments(h.db, providers, { minAgeMs: 0, now: Date.now() + 130_000 })).toEqual({ asked: 1, final: 1 });
    expect((await h.api('GET', '/v1/me/payments', p.token)).body.payments.find((x: any) => x.id === id).status).toBe('failed');
    expect(await wallet(p.id, 'real-crypto', 'USDT')).toBe(4_000_000); // refunded once
    expect((await h.db.query('select count(*)::int as n from provider_events where ref = $1 and applied_at is null', [`custody-test_${id}`])).rows[0].n).toBe(0);
  });

  it('a retry never asks a different provider than the one recorded on the payment', async () => {
    const p = await verifiedPlayer('Switch');
    const fund = await h.api('POST', '/v1/me/deposits', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 3_000_000, method: 'crypto' }, idemKey());
    await hook('custody-test', [{ type: 'payment', ref: fund.body.provider_ref, status: 'completed' }]);
    const key = idemKey()['idempotency-key']!;
    const principal = `user:${p.id}`;
    const id = keyedRef('pay', principal, key);
    const body = { mode: 'real-crypto', currency: 'USDT', amount_minor: 1_000_000, method: 'crypto', destination: '0xswitch' };
    const req = { method: 'POST', url: '/v1/me/withdrawals', rawBody: Buffer.from(JSON.stringify(body)) } as any;
    const run = (rail: MoneyRail) => runPayment(h.db, principal, key, req, rail, 'createPayout', (c, pid) =>
      preparePayment(c, { id: pid, rail, kind: 'withdrawal', userId: p.id, mode: 'real-crypto', currency: 'USDT', amountMinor: 1_000_000, method: 'crypto', destination: '0xswitch' }).then(() => undefined));
    downNext.add(id);
    expect((await run(custody)).status).toBe(502); // pending, provider custody-test, no reference
    // The configuration now names another custody provider: the retry must not hand the payment to it.
    const other = pendingRail('custody-other', 'chain');
    const r = await run(other);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ id, status: 'pending', provider: 'custody-test', provider_ref: null });
    expect(other.intents).toHaveLength(0);
    // Nor does the recovery pass, when the configured rail is not the recorded one.
    expect(await recoverPayments(h.db, { ...providers, custody: other }, { minAgeMs: 0, now: Date.now() + 130_000 })).toEqual({ asked: 0, final: 0 });
    downNext.delete(id);
  });

  it('deposit: a retry of a pending deposit is recognised before the limit and eligibility checks run', async () => {
    const p = await verifiedPlayer('LimRetry');
    expect((await h.api('PUT', '/v1/me/limits', p.token, { deposit_day_minor: 1_000 })).body.deposit_day_minor).toBe(1_000);
    const k = idemKey();
    const id = keyedRef('pay', `user:${p.id}`, k['idempotency-key']!);
    downNext.add(id);
    const dep = { mode: 'real-fiat', currency: 'EUR', amount_minor: 1_000, method: 'card' };
    const asked = psp.intents.length;
    expect((await h.api('POST', '/v1/me/deposits', p.token, dep, k)).body.type).toBe('provider_unavailable');
    // The pending 1 000 fills the limit; the retry of that very deposit is not a new deposit.
    const again = await h.api('POST', '/v1/me/deposits', p.token, dep, k);
    expect(again.body.type).toBe('provider_unavailable');
    expect(again.body.payment.id).toBe(id);
    expect(psp.intents.length).toBe(asked + 2);
    // A different deposit is still held back by the limit.
    expect((await h.api('POST', '/v1/me/deposits', p.token, { ...dep, amount_minor: 1 }, idemKey())).body.type).toBe('limit_reached');
    downNext.delete(id);
  });

  it('KYC: a verdict delivered before the session reference was stored is kept and applied when it is', async () => {
    const p = await h.register('Early');
    await realMoneyReady(h, p.id);
    expect((await hook('idp', [{ type: 'kyc', ref: `idp_${p.id}`, status: 'verified' }])).body).toEqual({ received: 1, applied: 0 });
    // A later early `rejected` does not undo it, as a delivered webhook would not either.
    expect((await hook('idp', [{ type: 'kyc', ref: `idp_${p.id}`, status: 'rejected' }])).body).toEqual({ received: 1, applied: 0 });
    const started = await h.api('POST', '/v1/me/kyc', p.token, {});
    expect(started.body).toEqual({ kyc_status: 'verified', provider: 'idp', redirect_url: null });
    expect((await h.db.query('select count(*)::int as n from provider_events where ref = $1 and applied_at is null', [`idp_${p.id}`])).rows[0].n).toBe(0);
    expect((await h.api('GET', '/v1/me', p.token)).body.kyc_status).toBe('verified');
  });

  it('purchase: chips are issued when the charge completes, not before', async () => {
    const p = await verifiedPlayer('Buy');
    const r = await h.api('POST', '/v1/me/chips/purchases', p.token, { chips: 1_000, pay_with: 'EUR' }, idemKey());
    expect(r.body).toMatchObject({ status: 'pending', kind: 'purchase' });
    const chips = () => tx(h.db, (c) => balance(c, acct(p.id, 'wallet', 'virtual-chips', 'CHIP')));
    expect(await chips()).toBe(0);
    await hook('psp-test', [{ type: 'payment', ref: r.body.provider_ref, status: 'completed' }]);
    expect(await chips()).toBe(1_000);
    expect(await tx(h.db, (c) => balance(c, acct('PreFlop', 'sales', 'real-fiat', 'EUR')))).toBeGreaterThan(0);
  });

  it('routes: an unknown provider is 404, a provider without a configured slot is 503, and the ledger sums to zero', async () => {
    expect((await hook('nobody', [])).status).toBe(404);
    const bare = await harness('providers_none', {}, { providers: noProviders });
    try {
      const p = await bare.register('None');
      expect((await bare.api('POST', '/v1/me/kyc', p.token, {})).body.type).toBe('provider_not_configured');
      expect((await bare.api('POST', '/v1/me/deposits', p.token, { mode: 'real-fiat', currency: 'EUR', amount_minor: 1_000, method: 'card' }, idemKey())).body.type).toBe('provider_not_configured');
      expect((await bare.api('POST', '/v1/me/withdrawals', p.token, { mode: 'real-crypto', currency: 'USDT', amount_minor: 1_000, method: 'crypto' }, idemKey())).body.type).toBe('provider_not_configured');
      expect((await bare.api('POST', '/v1/me/chips/purchases', p.token, { chips: 100, pay_with: 'USDC' }, idemKey())).body.type).toBe('provider_not_configured');
    } finally { await bare.close(); }
    for (const s of await ledgerSums(h.db)) expect(Number(s.total)).toBe(0);
  });
});

describe('sandbox adapters honour the same contract', () => {
  it('complete at once with a reference, and the KYC verdict is verified', async () => {
    const h = await harness('providers_sandbox');
    try {
      const p = await h.register('Sbx');
      const intent: PaymentIntent = { id: 'pay_x', userId: p.id, mode: 'real-fiat', currency: 'EUR', amountMinor: 100, method: 'card' };
      expect(await sandboxPsp.createDeposit(intent)).toMatchObject({ status: 'completed', ref: 'sbx_pay_x', address: null });
      expect(await sandboxPsp.createPayout({ ...intent, destination: 'DE89…' })).toMatchObject({ status: 'completed', address: 'DE89…' });
      const chain = await sandboxCustody.createDeposit({ ...intent, mode: 'real-crypto', currency: 'USDT' });
      expect(chain.status).toBe('completed');
      expect(chain.address).toMatch(/^0x[0-9a-f]{40}$/);
      expect(await sandboxKyc.start({ id: p.id, email: 'x@y.z' })).toMatchObject({ status: 'verified', ref: `sbx_kyc_${p.id}` });
      // Demo seeding runs the three phases in one transaction with the sandbox only.
      const row = await tx(h.db, (c) => runSandbox(c, { id: 'pay_sbx_1', rail: sandboxPsp, kind: 'purchase', userId: p.id, ...chipsPurchase(500, 'EUR') }));
      expect(row).toMatchObject({ status: 'completed', provider: 'sandbox', provider_ref: 'sbx_pay_sbx_1' });
      expect(await tx(h.db, (c) => balance(c, acct(p.id, 'wallet', 'virtual-chips', 'CHIP')))).toBe(500);
      expect(sandboxPsp.webhook).toBeUndefined();
      expect(sandboxKyc.webhook).toBeUndefined();
    } finally { await h.close(); }
  });
});
