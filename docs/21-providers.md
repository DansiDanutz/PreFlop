# 21 — Provider adapters: KYC, payments and custody

Real money needs three outside services. Each sits behind one small interface in `apps/api/src/providers/types.ts`, and everything that must be the same whoever the provider is (the `payments` rows, the ledger postings, idempotency, the audit trail, the webhook route) is written once. Today only the **sandbox** adapters exist; choosing real providers is the owner's decision (`docs/06`), and this document is what an adapter has to do to plug in.

| Slot | Interface | Env switch | Moves |
|---|---|---|---|
| Identity verification | `KycProvider` | `KYC_PROVIDER` | a user's `kyc_status` |
| Payment service provider (fiat) | `MoneyRail` with `rail: 'psp'` | `PSP_PROVIDER` | `real-fiat` deposits, payouts and card purchases |
| Custody (stablecoins) | `MoneyRail` with `rail: 'chain'` | `CUSTODY_PROVIDER` | `real-crypto` deposits, payouts and stablecoin purchases |

## Configuration
Each switch takes `sandbox` or `none`. Outside production the default is `sandbox`; in production it is `none`, and `sandbox` is refused at start (`config.ts productionProblems`) and never built (`providersFromConfig`). A slot left at `none` makes every route behind it answer `503 provider_not_configured`: identity verification, deposits, withdrawals and purchases in that currency. Real money can therefore not be switched on by mistake: it needs the mode enabled per territory (`docs/14`), a licensed territory, and a configured provider.

A real adapter adds its name to the enum in `config.ts`, its secrets to `SECRETS` there (checked for length and demo values in production), and a `case` in `providersFromConfig`.

## The contract
A payment runs in three phases (`payments/service.ts`, `runPayment`), and the adapter is called in the middle one, **outside any database transaction**:

1. **Prepare**, one transaction that is safe to retry: the route's checks, then the payment row is written as `pending` with no provider reference yet, and a payout debits the wallet. The row's id comes from the player's `Idempotency-Key`, so a duplicate request finds the row instead of asking the provider again. This row is the durable intent: whatever happens next, the payment is on record.
2. **The provider call**, with the row's id as `intent.id`. The adapter passes that id to the provider as its idempotency key, so even a repeated call can never create a second payment there. An adapter never touches the database.
3. **Apply**, one transaction: the provider's reference is stored; a `completed` result posts the ledger now, a `pending` one waits for the webhook. A provider error marks the payment `failed`, refunds a payout, and the player gets `502 provider_error` with the failed payment; the same key replays that answer.

An adapter reports one of two things:

- **`completed`**: the money moved (an instant card capture, a confirmed on-chain deposit) and the ledger posts now;
- **`pending`**: the provider will decide later; nothing posts until its webhook reports the outcome.

Rules the service enforces, so adapters never have to:

- **Deposits and purchases take effect on completion.** A pending deposit credits nothing; a pending chip or diamond purchase issues nothing. The webhook's `completed` posts external rail → wallet (or → PreFlop sales plus the issuance) exactly once.
- **Payouts debit the wallet when requested.** The player cannot spend money that is on its way out. A `failed` payout is refunded by the webhook (`payment.withdrawal_refund`); a `completed` one needs nothing more.
- **Idempotency.** The payment id comes from the player's `Idempotency-Key`: a retried request replays the stored answer, a concurrent duplicate finds the row already there, and the provider is asked once per payment with that id as its idempotency key. `(provider, provider_ref)` is unique per provider, and `settlePayment` ignores a verdict for a payment that is no longer pending, so a webhook delivered ten times settles once and a late `failed` never undoes a `completed`. A crash between the provider call and the apply phase leaves a `pending` row without a reference: it is on record for reconciliation, never lost.
- **The ledger stays balanced per currency.** External money is `external:<rail>:<mode>:<currency>`; a failed payout refunds from it.
- **Everything is audited**, including deliveries for unknown references.

`PaymentIntent` carries the id, the payer, mode, currency, amount in minor units, the client's method label and, for payouts, the destination. `ProviderResult` returns the status, the provider's `ref`, optionally an `address` (a deposit address, the payout destination), a `redirect_url` where the player continues (3-D Secure, hosted checkout, the KYC provider's own pages) and `details` worth keeping (network, confirmations, card brand; never secrets). Routes return `redirect_url` to the client: the player app follows it after `POST /v1/me/kyc`.

### KYC
`start(user)` opens (or reopens) verification, outside any transaction, and returns `verified`, `pending` or `rejected` with the provider's applicant reference. `POST /v1/me/kyc` then stores the status and `(kyc_provider, kyc_ref)` on the user unless a verdict made them verified meanwhile, and is a no-op answer for a user already verified. A webhook `kyc` event moves the user named by that reference to `verified`, `rejected` or `pending`; it never downgrades a verified user (the team does that in the console, with an audit entry).

### Webhooks
`POST /v1/webhooks/:provider` dispatches to the adapters named `:provider` that implement `webhook(headers, rawBody)`. The adapter authenticates the delivery **from the raw bytes and the headers**, never from parsed JSON, and returns the events to apply (`payment` with `ref` and `completed | failed`, or `kyc` with `ref` and the status). The route applies them in one transaction and answers `200 {received, applied}`, so the provider stops retrying; a bad signature is `401 bad_signature` and changes nothing; a provider without a webhook (the sandbox) is `404`. Bodies above 256 KB are refused.

`providers/webhook.ts` is a reference implementation for the common scheme, an HMAC-SHA256 over `<timestamp>.<raw body>` in a header `t=<unix>,v1=<hex>` with a five-minute replay window and a constant-time compare. Providers with their own scheme implement `webhook` directly.

## What a real adapter must pass
`apps/api/test/providers.test.ts` holds the contract: the configuration rules, the signature helper, and a stand-in provider whose every call is pending and whose verdicts arrive by signed webhook. It covers deposit, payout (completed and failed), purchase, KYC, replayed and tampered deliveries, unknown references, the fail-closed routes, one provider call per payment with the row's id as the key, and a provider that refuses (failed payment, refunded payout, `502` replayed). A new adapter is wired into the same harness (`harness(name, {}, { providers })`) and must pass the same cases, plus its own tests of the provider's request and webhook formats against recorded fixtures. The sandbox adapters pass the same checks.

## Not in scope here
Choosing providers, contracts and licences (`docs/06`); the real-money gate per territory and the responsible-gaming limits (`docs/14`); the money flows and who pays the winnings (`docs/10`).
