import { sha256Hex } from '@preflop/odds-engine';
import type { KycProvider, MoneyRail, PaymentIntent, ProviderResult } from './types.ts';

/**
 * Sandbox adapters: everything completes at once and nothing leaves the process. They exist for
 * development, tests and demos, and providersFromConfig never builds them in production.
 */

const sandboxAddress = (id: string) => `0x${sha256Hex(id).slice(0, 40)}`;

function instant(rail: 'psp' | 'chain', intent: PaymentIntent, payout: boolean): ProviderResult {
  return {
    status: 'completed',
    ref: `sbx_${intent.id}`,
    address: rail === 'chain' ? (payout ? intent.destination ?? null : sandboxAddress(intent.id)) : payout ? intent.destination ?? null : null,
    details: rail === 'chain' ? { sandbox: true, network: 'sandbox', confirmations: 12 } : { sandbox: true },
  };
}

export const sandboxPsp: MoneyRail = {
  name: 'sandbox',
  rail: 'psp',
  async createDeposit(intent) { return instant('psp', intent, false); },
  async createPayout(intent) { return instant('psp', intent, true); },
};

export const sandboxCustody: MoneyRail = {
  name: 'sandbox',
  rail: 'chain',
  async createDeposit(intent) { return instant('chain', intent, false); },
  async createPayout(intent) { return instant('chain', intent, true); },
};

/** Documents are "verified" instantly. A real provider returns `pending` and its webhook decides. */
export const sandboxKyc: KycProvider = {
  name: 'sandbox',
  async start(user) { return { status: 'verified', ref: `sbx_kyc_${user.id}`, details: { sandbox: true } }; },
};
