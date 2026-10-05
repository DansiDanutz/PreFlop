import type { Db } from '../lib/db.ts';
import { tx } from '../lib/db.ts';
import { type Providers, railFor } from '../providers/index.ts';
import { RECOVERY_MIN_AGE_MS, callProvider, claimCall, recordOutcome } from './service.ts';

/**
 * Recovery of payments whose provider call never finished (docs/21): a pending row without a
 * provider reference whose request crashed, timed out or got an uncertain error. The worker asks
 * the provider again with the same intent id, which the adapter passes as its idempotency key, so
 * the provider answers about the payment it already has (or takes it now). A definite refusal fails
 * the payment and refunds a payout; another uncertain error waits for the next, longer interval.
 * Nothing is ever refunded on a guess: an uncertain payout stays pending until the provider answers.
 */
export async function recoverPayments(db: Db, providers: Providers, opts: { limit?: number; minAgeMs?: number; now?: number } = {}): Promise<{ asked: number; final: number }> {
  const started = Date.now();
  const now = opts.now ?? started;
  /** The clock as of this moment, in the pass's frame of reference (tests pass a shifted `now`). */
  const clock = () => now + (Date.now() - started);
  const minAgeMs = opts.minAgeMs ?? RECOVERY_MIN_AGE_MS;
  const due = (await db.query<{ id: string; provider: string; kind: string; mode: 'real-fiat' | 'real-crypto' }>(
    `select id, provider, kind, mode from payments
      where status = 'pending' and provider_ref is null
        and created_at < to_timestamp($1::double precision / 1000)
        and coalesce((details->>'lease_until')::bigint, 0) < $2::bigint
        and coalesce((details->>'next_try_at')::bigint, 0) < $2::bigint
      order by created_at limit $3`, [now - minAgeMs, now, opts.limit ?? 20])).rows;
  let asked = 0;
  let final = 0;
  for (const d of due) {
    const rail = railFor(providers, d.mode);
    // A rail that is no longer configured, or a different one: the row waits for an operator (it is
    // on record and audited); recovery never hands a payment to a provider that did not take it.
    if (!rail || rail.name !== d.provider) continue;
    // The lease starts when THIS payment is claimed, not when the pass began: a slow provider call
    // earlier in the pass must not leave a later payment's lease already expired while its call runs.
    const row = await tx(db, (c) => claimCall(c, d.id, clock()));
    if (!row) continue;
    asked++;
    const outcome = await callProvider(rail, d.kind === 'withdrawal' ? 'createPayout' : 'createDeposit', row);
    const r = await tx(db, (c) => recordOutcome(c, d.id, rail.name, outcome));
    if (r.final) final++;
  }
  return { asked, final };
}
