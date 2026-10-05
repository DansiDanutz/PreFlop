import type { PlayMode } from '@preflop/odds-engine';
import type { Config } from '../config.ts';
import { ApiError } from '../lib/errors.ts';
import { sandboxCustody, sandboxKyc, sandboxPsp } from './sandbox.ts';
import type { KycProvider, MoneyRail, Providers } from './types.ts';

export type { KycProvider, MoneyRail, PaymentIntent, ProviderEvent, ProviderResult, Providers, Rail, WebhookHandler } from './types.ts';

/** Thrown by every real-money entry point whose provider is not configured (503, fail closed). */
export const providerNotConfigured = (what: string) =>
  new ApiError(503, 'provider_not_configured', `${what} needs a configured provider (docs/21)`);

export function requireProvider<T>(p: T | null, what: string): T {
  if (p === null) throw providerNotConfigured(what);
  return p;
}

/** The rail that moves money for a real-money mode. */
export const railFor = (p: Providers, mode: PlayMode): MoneyRail | null => (mode === 'real-crypto' ? p.custody : mode === 'real-fiat' ? p.psp : null);

/**
 * Builds the adapters named by KYC_PROVIDER, PSP_PROVIDER and CUSTODY_PROVIDER. `none` (the
 * production default) leaves a slot empty, and every route behind it answers 503
 * provider_not_configured. The sandbox is never built in production, whatever the config says
 * (config.ts refuses it too; this is the second lock).
 */
export function providersFromConfig(config: Config): Providers {
  const prod = config.nodeEnv === 'production';
  const pick = <T>(name: string, sandbox: T): T | null => (name === 'sandbox' && !prod ? sandbox : null);
  return {
    kyc: pick<KycProvider>(config.providers.kyc, sandboxKyc),
    psp: pick<MoneyRail>(config.providers.psp, sandboxPsp),
    custody: pick<MoneyRail>(config.providers.custody, sandboxCustody),
  };
}

export const noProviders: Providers = { kyc: null, psp: null, custody: null };
