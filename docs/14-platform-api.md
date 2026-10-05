# 14 — Platform API reference (implemented)

This is the API as **built** in `apps/api`. The typed client in `packages/client/src/index.ts` is the contract that every frontend uses. `docs/02` describes the integration model, and `docs/13` the core spec this implements.

**Common rules**
- Money is in integer minor units, with a currency. Odds are integer hundredths.
- Errors are `application/problem+json` objects with a stable `type`.
- Player and console calls use `Authorization: Bearer <session>`.
- Table devices and staff use the signed envelope (`X-PreFlop-Auth`, `docs/13` §7).
- Partners use OAuth client credentials.
- Every response carries `X-Request-Id`: the caller's own value if it is 1–128 characters of `A-Z a-z 0-9 . _ : -`, otherwise a generated UUID. It is the `request_id` of every log line for that request, and a `500` body includes it.
- Too many requests get `429` problem+json with a `Retry-After` header (seconds) and `retry_after_s` in the body. See *Limits* below.

## Public
| Route | Purpose |
|---|---|
| `GET /v1/health` | Liveness: the process answers. Never touches the database |
| `GET /v1/health/ready` | Readiness: `200 {ready: true, checks}` when the database answers within 2 s and a worker has beaten within `WORKER_HEARTBEAT_MAX_AGE_MS` (15 s). Otherwise `503 not_ready` with the same `checks` (`database.ok`, `worker.ok`, `worker.last_beat_age_ms`) |
| `GET /v1/book?channel=direct\|club\|partner` | Every market and selection, with its exact probability and odds. Another `channel` value is `400 bad_request` |
| `GET /v1/modes` | Enabled play modes, and `physical_play_enabled` (off by owner decision) |
| `GET /v1/lobby` · `GET /v1/clubs/:id` · `GET /v1/tables/:id` | Clubs and tables, with readiness, the current round, the last flop and the history |
| `GET /v1/tables/:id/rounds/current` · `GET /v1/rounds/:id` | Round state, with `review_deadline` (see *Review deadline*) |
| `GET /v1/rooms` · `GET /v1/rooms/:id` | Public rooms run by organizers. A room's `odds` map shows its own book |
| `POST /v1/applications` | Website application forms for a club, partner or organizer |
| `WS /v1/stream` | Subscribe with `{"subscribe":["lobby","table:<id>"]}`. To receive your own bet events, send `{"type":"auth","token":"<session>"}` as the **first** frame (answered with `{"type":"auth","ok":true}`). Tokens in the URL are ignored |

## Player
| Route | Purpose |
|---|---|
| `POST /v1/auth/register` · `login` · `logout` | Sessions. A new account gets 10,000 free play chips. `register` needs `date_of_birth` (YYYY-MM-DD, 18+, `403 underage`) and `country` (ISO 3166-1 alpha-2; `403 territory_blocked`), takes an optional `ref` (an agent code, docs/16 §4), and emails a verification link. `login` takes `otp` when the account has two-factor authentication (`401 mfa_required`, `401 invalid_otp`). `register` and `login` are rate-limited per IP; `login` also locks an email after 5 failures in 15 minutes (`429 login_locked`). See *Accounts and security* |
| `GET /v1/me` · `/v1/me/wallets` | Profile, memberships, and wallets. Wallets cover play, chips, diamonds per organization, fiat and stablecoins. `/v1/me` also carries `date_of_birth`, `email_verified`, `mfa_enabled` and `mfa_enrollment_required` |
| `PATCH /v1/me` | Change the display name (1–60 characters). `date_of_birth` and `country` can be added once when missing (`409 already_set` afterwards; support corrects them). Email changes are not part of this route |
| `POST /v1/auth/verify-email {token}` · `POST /v1/me/resend-verification` | Email verification (single-use links, 48 h). `400 invalid_token`, `409 already_verified` |
| `POST /v1/auth/forgot-password {email}` · `POST /v1/auth/reset-password {token, password}` | Password reset by email (1 h link). `forgot-password` always answers `200 {ok: true}`. A reset signs the account out everywhere |
| `POST /v1/me/password {current, new}` | Change the password; signs out every other session. A wrong `current` counts toward the login lockout (`403 wrong_password`; the session stays valid) |
| `POST /v1/me/mfa/setup` · `mfa/enable {code}` · `mfa/disable {code}` | Two-factor authentication (TOTP). `setup` returns `{secret, otpauth_uri}`; nothing changes at sign-in until `enable` confirms a code |
| `GET /v1/me/session` | The play session of this sign-in: `started_at`, `minutes_played`, `limit_minutes`, `ends_at`, `limit_reached`, `reality_check_minutes`, and `results` (bets, staked, returned, open stakes and `net_minor` per wallet) |
| `POST /v1/bets` (+ `Idempotency-Key`) | Fixed odds against PreFlop, or with `room_id` against an organizer house or into a pool. Rate-limited per user. A reused key replays the stored bet only for the same round, selection, stake and room (and the same odds unless `accept_price_change`); anything else is `422 idempotency_mismatch`. The price must equal the current price; with `accept_price_change: true` the client accepts a change only to the price it was shown, so `odds_centi` must be the `odds_centi` of the `409 price_changed` it received (a current price that is equal or better for the player is taken; a price that moved again against the player is a new `409 price_changed`). Clients keep one key per confirmed bet and retry an uncertain outcome (network error, 5xx) with that same key and body. Tournament bets (`idempotency_key` in the body) and partner bets follow the same rule |
| `GET /v1/me/bets` · `/v1/me/ledger` · `/v1/me/stats` | History. A bet's `potential_payout_minor` is what settlement pays if it wins: the at-risk stake at the accepted odds, and 0 for a pool bet (its share is known only at settlement), as in the placement response. `bets` is newest first with `next_before` (the cursor for `?before=`, null on the last page) and filters `status`, `round_id`, `mode`, `currency` and `room_id` (`none` = outside rooms); each bet carries its `idempotency_key`, so a client can tell whether an uncertain request landed. `stats` keeps play money at the top level and adds `by_currency` (see *Per-currency amounts*) |
| `POST /v1/me/play/reset` | Resets play money at any time |
| `GET/PUT /v1/me/favorites` | Six favorite selections (`docs/15`) |
| `POST /v1/rooms/join {code}` | Joins an invite-only room |
| `GET/PUT /v1/me/limits` · `POST /v1/me/self-exclusion` | Responsible gaming. A lower limit applies at once; a higher one (or a removal) waits 24 h in `pending`. Editing a field again supersedes its queued change (asking for 200, then reducing to 50, leaves 50 and cancels the 200; re-stating the current value cancels a queued raise); queued changes of other fields are kept, and a new raise restarts the shared `pending_effective_at`. Self-exclusion ends the sessions and is never shortened: excluding again keeps the later end |
| `POST /v1/me/kyc` | Starts identity verification with the configured KYC provider (`docs/21`): `{kyc_status, provider, redirect_url}`. The sandbox verifies at once; a real provider answers `pending` and decides through its webhook. Without a configured provider (production by default) every real-money route answers `503 provider_not_configured` |
| `POST /v1/me/org-claims` | Redeem a single-use owner link (`claim_used`, `claim_expired`) |
| `POST /v1/me/deposits` · `withdrawals` (+ `Idempotency-Key`) · `GET /v1/me/payments` | Real money through the payment provider of the mode (`docs/21`): a payment is `completed`, or `pending` with a `redirect_url` until the provider's webhook settles it; a payout debits the wallet at once and is refunded if it fails; a provider that refuses answers `502 provider_error` with the `failed` payment. The provider is asked once per payment, outside the transaction, with the payment id as its idempotency key. Needs the mode enabled, KYC, and the deposit limit (EUR-equivalent, summed per currency in exact minor units over 24 h, the new deposit included; stablecoins convert once, rounding up). Deposits also need the account checks in *Accounts and security*; withdrawals never do. See *Idempotent money* |
| `POST /v1/me/chips/purchases` (+ `Idempotency-Key`) | Buy virtual chips: 100 per euro, paid in EUR, USDT or USDC through the provider of that currency; chips are issued when the charge completes |
| `POST /v1/webhooks/:provider` | Inbound provider webhooks (`docs/21`): authenticated by the adapter from the raw body, applied once, `200 {received, applied}`; `401 bad_signature`; `404` for a provider without a webhook |

## Provider (club tables)
These calls use the signed envelope, and every write needs an `Idempotency-Key`. The order of the routes is the order of a hand:

1. `start`
2. `shuffle-command` (device)
3. `shuffle-complete` (device, with the Trusted Shuffler's attestation)
4. `cut`
5. `deal-start`
6. `flop` (dealer, and floor separately)
7. `capture` and `capture/image` (device)

Other provider routes:
- `void` and `pause`/`resume` (floor manager). A pause records `pause_kind: floor`; a pause on a table already held for `monitor`, `evidence` or `platform` keeps that hold. `resume` lifts only a `floor` pause: other holds answer `403 platform_resume_required` and are lifted by the PreFlop team (`PUT /v1/admin/tables/:id/status`). On a round carrying real money, `void` is refused (`403 platform_review_required`) once deal-start is recorded, even while the round is still LOCKED;
- `capture` validates the full signed record at ingress (every field, its type and range, no unknown field). A malformed record, e.g. one without a numeric `capturedAt`, is `422 evidence_rejected`, logged in `capture_attempts`, counts toward the 3 failed attempts and never advances the device chain;
- `rounds/:id/review` and `rounds/:id/evidence` (floor manager);
- `heartbeat`, `state`, `devices/:id/checkpoint`. `state` returns `table.pause_kind` and, on each of `rounds[]`, `review_deadline`.

## Organization portals (`/v1/org/:orgId/...`)
**Access:**
- Members by role: `owner` and `admin` can write; `viewer` is read-only.
- The PreFlop team can read every organization. Platform `admin` and `ops` can also write.

**Common to every organization:**
- `overview`: `kpis`, `series` (per day, mode and currency) and 30-day `turnover_by_currency` / `ggr_by_currency` (see *Per-currency amounts*);
- `PUT /` (settings);
- `members`. Only an owner (or the PreFlop team) changes an owner's role, and the last owner cannot be demoted (`last_owner`);
- `statements?period=YYYY-MM` (dynamic sharing, `docs/09`);
- `rounds` (with `review_deadline`; `?limit=` 1–500, default 100);
- `players`, with `balances` per currency;
- `treasury`;
- `transfers` (POST needs an `Idempotency-Key`).

**Club:**
- `tables` (GET, POST). A new table's round loss limit is set in its currency (`docs/04` §3). A `real-fiat` or `real-crypto` table starts **not approved** for real money (see *PreFlop team*);
- `tables/:id/certification`: 9 items, each recording who and when, with an expiry. The three per-shift items expire after 12 h. Re-confirming per-shift items as OK keeps a real-money approval; any other change clears it, and so does a change of the table's mode, currency, kind or club;
- `staff` (GET, POST to enroll an Ed25519 SPKI PEM) and `staff/:id/revoke`.

**Organizers and clubs:**
- `rooms` (GET, POST, PUT) and `rooms/validate`, which returns any problems, the guaranteed organizer EV and the fee-rate bound;
- `collateral/deposits` (+ `Idempotency-Key`);
- `diamonds/packs` and `diamonds/purchases` (+ `Idempotency-Key`);
- `chips/purchases` (+ `Idempotency-Key`; partners too);
- room rules: a pool room (chips **or diamonds**) needs a rake within the pool bounds (500–2,000 bps); a diamond room cannot set `provider_share_bps` above 0 (`422 provider_share_unsupported`: provider clubs are paid by PreFlop in EUR, docs/08);
- `dilution`.

**Partner:**
- `api-clients` (the secret is shown once) and `api-clients/:id/revoke`. Revoking a client also ends every session of the partner's players;
- `webhooks`, `webhooks/:id/test`, DELETE (disable) and `webhooks/:id/enable`. Disabling cancels the webhook's queued and retrying deliveries (status `cancelled`); a delivery a sender has already claimed may finish (and is cancelled if it fails). Re-enabling sends only events from then on; `test` on a disabled webhook is `409 webhook_disabled`. Both are audited;
- `bets`;
- `widget` (GET, PUT): settings plus an iframe snippet.

## Partner API (server to server)
| Route | Purpose |
|---|---|
| `POST /v1/partner/oauth/token` | Client credentials → bearer token (1 h). Rate-limited per IP |
| `POST /v1/partner/players` · `/v1/partner/players/:ref/session` | Partner players, and the widget session token. Both take an optional `date_of_birth` (recorded once; `403 underage` under 18). The partner is the licensed operator: it verifies its players' age, identity and location |
| `POST /v1/partner/players/:ref/deposits` (+ `Idempotency-Key`, 8–200 characters) | Transfer wallet mode. Free chips are issued; virtual chips come out of the partner's treasury (bought through `POST /v1/org/:id/chips/purchases`), never beyond its balance (`insufficient_treasury`). A retry with the same key returns the original response and never credits twice; the same key with a different request gets `422 idempotency_mismatch`. No key: `400` |
| `POST /v1/partner/bets` (+ `Idempotency-Key`, 8–200 characters) · `GET /v1/partner/bets` | Bets on the `partner` channel. Rate-limited per partner player, with the same limiter as `POST /v1/bets` |

**Suspension:** while a partner organization is not `active`, its tokens stop working, and its players get `403 partner_suspended` on every signed-in call and on bets. Suspending the partner (`PUT /v1/admin/orgs/:id/status`) also ends its players' sessions.

**Webhooks:**
- Payloads are signed with the header `X-PreFlop-Signature: t=<unix>, v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`.
- Failed deliveries retry with exponential backoff for 24 h.
- Deduplicate by `event_id`.
- Delivery rows are written **in the same transaction** as the settlement or void that produced the event, so an event cannot be lost between the commit and the fan-out, whichever process (API or worker) settled the round. `round.voided` goes to every subscribed partner; `bet.settled` and `bet.voided` only to the partner whose player placed the bet.
- A sender **claims** rows before sending (`for update skip locked`, status `sending`), so several workers never send one delivery twice. A claim older than 5 minutes is taken over, and the late sender's result is then ignored.
- Only deliveries of **active** webhooks are claimed. Disabling a webhook cancels its queued deliveries, including retries; a delivery already claimed may finish, a failed one is cancelled instead of retried, and an abandoned claim is cancelled instead of taken over.

## PreFlop team (`/v1/admin/...`)
**Monitoring:**
- `overview`: `bets_24h.staked_by_currency` (the old mixed-currency `staked` is no longer sent; see *Per-currency amounts*);
- `metrics`: operational counters as JSON (see *Health and metrics*);
- `alerts` and `alerts/:id/resolve`;
- `review-queue` (with `review_deadline`);
- `rounds` (with `review_deadline`), `rounds/:id/evidence` (`round.review_deadline`) and `rounds/:id/void`. The team can void and refund any round;
- `rounds/:id/review` (`admin`, `ops`): `{action: settle, cards} | {action: void, reason}` on a **real-money** round in REVIEW. The club cannot settle its own real-money rounds (`403 platform_review_required` on the provider route). Other modes stay with the club's floor manager (`403 club_review_required` here);
- `risk`: worst-case exposure per open round, plus the CUSUM outcome monitor.

**Administration:**
- `users` (GET, PUT): status, KYC and roles. A self-exclusion cannot be lifted early, by any path: `status: active` is `409 self_excluded` while `self_excluded_until` is in the future, whatever the current status (e.g. via `suspended`), and the database refuses it too (migration 016 trigger). Only admins change roles, and support and risk cannot change a team account or their own (`forbidden_target`);
- `orgs` (GET, POST, `:id/status`, `:id/owner-claim`);
- `applications` and `applications/:id/decision`. An approved application creates the organization:
  - if the applicant applied while signed in, their account becomes the owner;
  - otherwise the response carries a single-use `owner_claim` link (14 days) for the team to send to the owner;
- **ownership is never granted by email**, because addresses are not verified. `POST /v1/admin/orgs` also returns an `owner_claim`, and `:id/owner-claim` issues a fresh one, revoking unclaimed links. The owner redeems it signed in with `POST /v1/me/org-claims {token}` (console page `/claim/:token`);
- `tables` and `tables/:id/status` (a pause records `pause_kind: platform`). `status: active` lifts any hold, including `monitor` and `evidence` ones the club cannot lift; the audit event records `previousPauseKind`;
- `PUT tables/:id/real-money {approved, note?}` (`admin`, `ops`): approves or revokes a table for real money. Until approved, real-money bets there get `403 table_not_approved`, and so do bets of a real-money tournament on any table, including play-money tables. Audited as `table.real_money_approved` / `table.real_money_revoked`;
- `settings` (`modes_enabled`, `physical_play_enabled`, `territories`, `require_staff_mfa`). `territories` must be `{"blocked": [...], "real_money_allowed": [...]}` and `require_staff_mfa` a boolean (`422 invalid_value`).

**Finance and audit:**
- `ledger`;
- `audit`, which re-verifies the whole hash chain;
- `statements`;
- `payments`.

## Limits
| Status · `type` | When | Scope |
|---|---|---|
| `429 rate_limited` | More than `RATE_LIMIT_AUTH_PER_MIN` (20) calls a minute to `POST /v1/auth/login`, or separately to `/v1/auth/register` | Per client IP, per API instance |
| `429 rate_limited` | More than `RATE_LIMIT_PARTNER_TOKEN_PER_MIN` (30) calls a minute to `POST /v1/partner/oauth/token` | Per client IP, per API instance |
| `429 rate_limited` | More than `RATE_LIMIT_BETS_PER_MIN` (120) calls a minute to `POST /v1/bets`, tournament bets and `POST /v1/partner/bets` together | Per player (signed-in user or partner player), per API instance |
| `429 rate_limited` | More than `RATE_LIMIT_AUTH_PER_MIN` (20) calls a minute to `verify-email`, `forgot-password` and `reset-password` together | Per client IP, per API instance |
| `429 rate_limited` | More than 3 emails in 15 minutes from `forgot-password` (per address) or `resend-verification` (per account) | Per address or account, per API instance |
| `429 rate_limited` | More than 10 codes in 15 minutes to `mfa/enable` or `mfa/disable` | Per user, per API instance |
| `429 login_locked` | 5 failed logins for one email within 15 minutes. A wrong one-time code and a wrong current password on `POST /v1/me/password` count as failures. The right password is refused too until the oldest of those failures is 15 minutes old; `Retry-After` says when. A successful login clears the count. Unknown emails behave the same | Per email, **all instances** (stored in Postgres) |

The rate limits are fixed one-minute windows kept in each API process, so behind a load balancer with N instances a client can get up to N × the limit. Behind a load balancer set `TRUST_PROXY` to the number of proxy hops (`1` on Fly) or the proxies' CIDRs, otherwise every client shares the balancer's address; production refuses `TRUST_PROXY=true`, which would trust an `X-Forwarded-For` the client wrote itself.

Betting limits and gates (`docs/04` §3):

| Status · `type` | When |
|---|---|
| `422 invalid_stake` | Stake above the currency's maximum (EUR or USDT/USDC 10,000; PLAY, CHIP, DIAMOND 1,000,000) |
| `422 limit_exceeded` | One bet's payout above the table's round loss limit, or the round's worst case would pass it |
| `403 user_round_limit` | The player's bets on this round would together pay more than `max_user_round_payout_minor` (default: the round loss limit) |
| `403 table_not_approved` | Real-money bet at a table the PreFlop team has not approved |
| `403 partner_suspended` | The player belongs to a partner that is not active |

## Idempotent money
Every route that moves money or value in or out needs an `Idempotency-Key` header of 8–200 characters (`400 bad_request` without one), as `POST /v1/bets` does:
`POST /v1/me/deposits`, `/v1/me/withdrawals`, `/v1/me/chips/purchases`, and `POST /v1/org/:id/chips/purchases`, `diamonds/purchases`, `collateral/deposits`, `transfers` (and the partner's `players/:ref/deposits`).

- The payment id, its provider reference and its ledger postings are derived from (caller, key), and the response is stored in the same transaction. A retry with the same key and body returns the original response (same `id`) and never moves money twice, also when two retries race.
- The same key with a different body, or on another of these routes, is `422 idempotency_mismatch`.
- A failed request (`403 limit_reached`, `422 insufficient_funds`, …) stores nothing: the key can be retried.
- `payments.provider_ref` is unique (migration 014). `409 duplicate_payment` means a ledger posting for that reference already exists (it should never surface through the routes above).
- The typed client sends a fresh key per call (`deposit`, `withdraw`, `buyChips`, `buyDiamonds`, `buyOrgChips`, `orgFundCollateral`, `orgTransfer` take an optional last `idempotencyKey` argument: pass the same one to retry).

## Review deadline
Every round payload that can show a round in REVIEW carries `review_deadline`: an ISO-8601 UTC string, `review_started_at + REVIEW_SLA_MS` (30 minutes by default), the moment the worker voids an undecided review. It is `null` whenever the round is not in REVIEW (including `EVIDENCE_REJECTED`).

| Payload | Where |
|---|---|
| `GET /v1/provider/tables/:t/state` | `rounds[].review_deadline` |
| `GET /v1/lobby` · `/v1/clubs/:id` · `/v1/tables/:id` (and every table summary: admin overview, admin and club `tables`) | `current_round.review_deadline` |
| `GET /v1/tables/:id/rounds/current` | `latest.review_deadline` |
| `GET /v1/rounds/:id` | `review_deadline` |
| `GET /v1/admin/review-queue` · `GET /v1/admin/rounds` | `rounds[].review_deadline` |
| `GET /v1/admin/rounds/:id/evidence` · `GET /v1/provider/rounds/:id/evidence` | `round.review_deadline` |
| `GET /v1/org/:id/rounds` | `rounds[].review_deadline` |

## Per-currency amounts
Amounts of different currencies are never added together. Totals come as arrays of `CurrencyAmount = {currency, mode, amount_minor}`, one entry per (mode, currency), sorted by currency:

| Route | Shape |
|---|---|
| `GET /v1/admin/overview` | `bets_24h: {n, staked_by_currency: CurrencyAmount[]}`. `n` counts every bet. **`bets_24h.staked` was removed** (it summed CHIP, cents and micro-USDT) |
| `GET /v1/org/:id/overview` | `turnover_by_currency: CurrencyAmount[]`, `ggr_by_currency: CurrencyAmount[]` (30 days; GGR = stakes − payouts of settled bets). `series[]` rows now also carry `mode`: `{day, mode, currency, turnover_minor, ggr_minor, bets}`, one per day and currency. `kpis` are unchanged (already one per currency) |
| `GET /v1/org/:id/players` | `players[].balances: CurrencyAmount[]` (the player's wallets in this organization's economy). `balance_minor` / `currency` are kept but deprecated: they are the **first** entry of `balances` only, no longer a sum across chips and diamonds |
| `GET /v1/me/stats` | Top level unchanged (play money only): `{bets, won, lost, staked_minor, returned_minor}`, plus `by_currency: [{mode, currency, bets, won, lost, staked_minor, returned_minor}]`, one per (mode, currency) the player has bet in. `staked_minor` and `returned_minor` count settled bets |

## Query parameters
`?limit=` on list routes (`/v1/admin/rounds`, `users`, `ledger`, `audit`; `/v1/org/:id/rounds`, `/v1/org/:id/bets`; `/v1/me/bets`) is a whole number ≥ 1; larger values are served as the route's maximum. Anything else (`abc`, `1.5`, `0`, empty) is `400 bad_request`.

## Table pauses
`poker_tables.pause_kind` (migration 014) says, for code, why a table is paused: `monitor` (outcome-monitor alarm), `evidence` (Table Box inspection after failed captures), `floor` (club tablet) or `platform` (PreFlop team); `null` while active. `pause_reason` stays the human text. Only `pause_kind = monitor` makes the resolver void a dealt round, whatever the reason text says. The club tablet resumes only `floor` pauses (`403 platform_resume_required` otherwise); `monitor`, `evidence` and `platform` holds are lifted by PreFlop `admin`, `ops` or `risk` with `PUT /v1/admin/tables/:id/status {status: active}` after review.

## Accounts and security
Real money is off today. These rules are in place so it can be switched on.

**Age.** Registration requires a date of birth and refuses anyone under 18 (`403 underage`). Age is counted in whole years on the UTC calendar; someone born on 29 February comes of age on 1 March. Accounts created before the age gate have no date of birth: they can add it once (`PATCH /v1/me`) and cannot use real money until they do. A recorded age under 18 also refuses every bet.

**Territories.** `settings.territories` is `{"blocked": ["US"], "real_money_allowed": ["MT"]}` (ISO 3166-1 alpha-2, upper case; a country cannot be in both). Registration requires a country. A blocked country cannot register or bet at all. Real money is accepted only from a country in `real_money_allowed`; free chips work from any country that is not blocked. **The country is self-declared** until a KYC or geolocation provider confirms it. `countryHint()` in `apps/api/src/lib/accounts.ts` is where that signal plugs in; the API does not read `cf-ipcountry` or similar headers today.

**Real-money checks.** A real-money bet, real-money tournament entry or deposit needs, after the mode switch and KYC: a date of birth (`403 dob_required`) showing 18+ (`403 underage`), a verified email (`403 email_unverified`), a country that is not blocked (`403 territory_blocked`) and is licensed (`403 territory_not_licensed`). Partner players skip the email and licensed-country checks (their operator is responsible), but an under-18 date of birth or a blocked country still refuses them. Withdrawals are never held back by these checks.

**Session limit and reality checks.** A play session starts at sign-in (`sessions.play_started_at`). With a `session_minutes` limit, bets (`POST /v1/bets`, tournament bets) are refused with `403 session_limit` once that many minutes have passed. Betting resumes in a new session: the player signs out and in again, and the new session starts at once (no enforced pause; the limit makes the player stop and decide). `GET /v1/me/session` drives the clock in the player app and a reality check every `reality_check_minutes` (the limit, or 60): time played, net result this session, *Continue* or *Take a break* (sign out).

**Email.** Verification (48 h) and reset (1 h) links are random tokens; only their SHA-256 is stored (`email_tokens`), each works once, and only while the account keeps the address it was sent to. A new link replaces the earlier unused one. Links point at `WEB_URL`. Messages go to `email_outbox` in the same transaction and the worker sends them. With `SMTP_URL` (`smtp://` or `smtps://`, credentials in the URL) they go out over SMTP (nodemailer) from `MAIL_FROM`; in production `SMTP_URL` then requires an explicit `MAIL_FROM` of your own domain and a public `https` `WEB_URL`. Without `SMTP_URL`, outside production the log transport prints each message (with its link) to stdout; in production messages stay queued and the API warns at start. Each message is tried at most once per worker pass; a failure records `last_error` and schedules the next attempt with exponential backoff (`next_attempt_at`: 1 min, 2, 4, … capped at 6 h). After 8 attempts the message is `failed` (logged; counted in `GET /v1/admin/metrics`). A sent message keeps its row but loses its body.

**Passwords.** Player passwords are 8–200 characters. PreFlop team accounts (`platform_role` set) need a strong one on change and reset (12+ characters, 3 character classes, no common words; `422 weak_password`). A reset signs out every session and also verifies the email; a change signs out every other session.

**Two-factor authentication (TOTP, RFC 6238).** HMAC-SHA1, 6 digits, 30-second steps, ±1 step accepted, and a step is never accepted twice (`user_mfa.last_step`). With 2FA on, `POST /v1/auth/login` without `otp` answers `401 mfa_required` and issues no session; that answer neither records nor clears a failure. A wrong or replayed code is `401 invalid_otp` and counts toward the lockout. Any account can enrol; the console offers it to the PreFlop team. The secret is stored as is in `user_mfa.secret`: no encryption key is configured yet; encrypt it with a KMS-held key before real money.

**`require_staff_mfa`** (default `false`, console admin Settings). When `true`, a PreFlop team account without 2FA gets `403 mfa_enrollment_required` everywhere except `GET /v1/me`, `POST /v1/me/mfa/setup` and `POST /v1/me/mfa/enable`; the console sends it to its enrolment page. Organization members (clubs, partners, organizers) and players are not affected. Turn it on once the team has enrolled.

| Status · `type` | Meaning |
|---|---|
| `403 underage` | Under 18 (registration, partner players, bets, real money) |
| `403 dob_required` | Real money without a date of birth on file |
| `403 email_unverified` | Real money before the email is verified |
| `403 territory_blocked` | Registration or a bet from a blocked country |
| `403 territory_not_licensed` | Real money from a country not in `real_money_allowed` |
| `403 session_limit` | The `session_minutes` limit of this session is reached (`ends_at` in the body) |
| `403 mfa_enrollment_required` | Team account without 2FA while `require_staff_mfa` is on |
| `401 mfa_required` · `401 invalid_otp` | Sign-in needs a one-time code; the code is wrong, stale or replayed |
| `422 invalid_otp` | Wrong code on `mfa/enable` or `mfa/disable` |
| `400 invalid_token` | Email link unknown, used, expired or for an old address |
| `409 already_verified` · `409 email_not_applicable` | Resend for a verified address, or for a partner player |
| `409 already_set` | `PATCH /v1/me` changing a recorded date of birth or country |
| `409 mfa_already_enabled` · `mfa_not_set_up` · `mfa_not_enabled` | 2FA state does not allow the call |
| `422 weak_password` · `same_password` | Team password too weak; new password equals the current one |

## Health and metrics
- `GET /v1/health` is the liveness probe and `GET /v1/health/ready` the readiness probe (see *Public*). Every worker loop (`RUN_WORKER=true` in the API, or `pnpm --filter @preflop/api worker`) upserts a row in `worker_heartbeats` once a second.
- `GET /v1/admin/metrics` (PreFlop team, any platform role) returns:

| Field | Meaning |
|---|---|
| `outbox.pending` · `outbox.oldest_pending_age_s` | Outbox lag: jobs not done yet, and the age of the oldest |
| `webhook_deliveries.pending` · `failed` · `oldest_pending_age_s` | Webhook backlog (including deliveries being sent), and deliveries that gave up after 24 h |
| `email_outbox.pending` · `retrying` · `failed` · `oldest_pending_age_s` | Email backlog, messages waiting for a retry, and messages that gave up after 8 attempts. `instance.mail` counts this process's sends, failed attempts and give-ups |
| `alerts.open` · `alerts.open_critical` | Unresolved alerts |
| `rounds_by_state` | Count of rounds per state (`OPEN`, `LOCKED`, …, `SETTLED`, `VOID`) |
| `sweeper_voids_last_hour` | Rounds the deadline sweeper voided in the last hour |
| `worker` | Freshest worker heartbeat (`ok`, `last_beat_age_ms`, `max_age_ms`) |
| `instance.db_retries` | Deadlock (`40P01`) and serialization (`40001`) retries of `tx()` since this process started, and `exhausted` (gave up with `503 retry_later`). A non-zero deadlock count means a code path broke the lock order |
| `instance.ws_clients` | WebSocket clients connected to this process |
| `instance.event_relay` | Cross-instance stream fan-out through PostgreSQL NOTIFY: `connected` (this process listens), `forwarded` and `received` events, `truncated` (an event over the 8 KB payload limit was relayed without its data), `errors`. Processes started by `main.ts` and the standalone worker relay; a `connected: false` on a running instance means its clients see only events this process produced |

Database counters are global; `instance` describes only the API process that answered.

## Money flows (ledger accounts `<owner>:<purpose>:<mode>:<currency>`)
| Flow | Postings |
|---|---|
| PreFlop-house bet | wallet → `PreFlop:bankroll`; when it wins, bankroll → wallet |
| Organizer-house chip bet | wallet → `<org>:collateral` (stake); collateral → `PreFlop:platform-fees` (fee); when it wins, collateral → wallet |
| Organizer-house diamond bet | wallet → `PreFlop:platform-fees` (1 ◆); wallet → `<org>:treasury` (rake); wallet → collateral (at-risk amount) |
| Pool bet | wallet → `<room>:pool` (at-risk amount), plus the rake and the fee as above. At settlement the pool goes to the winners, parimutuel |
| Void | The bet's `bet.stake` transaction is reversed entry by entry, so the player gets the whole stake back |
| Diamonds or chips purchase | `external:psp\|chain` → `PreFlop:sales` (money); `PreFlop:issuance` → `<org>:treasury` (units) |
| Transfer to a player | `<org>:treasury` → `<user>:wallet-<org>` (a closed loop per organization) |

## Run it
```bash
pnpm install && VITE_API_URL=http://localhost:4000 pnpm -r build   # web/console production builds require VITE_API_URL
DATABASE_URL=postgres://postgres@localhost:5432/preflop pnpm --filter @preflop/api dev   # API + worker on :4000
pnpm --filter @preflop/api sim     # 5 simulated tables
ADMIN_PASSWORD=… pnpm --filter @preflop/api demo   # demo orgs; passwords from env or generated and printed
docker compose up --build          # full stack (API, sim, web :8080, console :8081, table :8082)
```

For production settings (`NODE_ENV=production`), see the README.

## Leaderboards and promotions (docs/16)

| Endpoint | What it does |
|---|---|
| `GET /v1/leaderboards?mode=` | Live and scheduled boards, plus boards settled in the last 30 days, each with its prize pool |
| `GET /v1/leaderboards/:id` | The board, its top 50 (display names only) with projected or paid prizes, and `you` when signed in |
| `GET /v1/me/badges` | Champion, podium and top-10 badges |
| `GET /v1/promotions` | Live promotions. When signed in, each also has `claimed` and `eligible` |
| `POST /v1/promotions/:id/claim` | Claims a free-chip offer or an organization drop, once per player. Errors: `already_claimed`, `budget_exhausted`, `not_eligible`, `promotion_not_live` |
| `GET/POST /v1/admin/leaderboards` | List and create boards (admin, ops). Real-money boards return `403 mode_disabled` while real money is off |
| `POST /v1/admin/leaderboards/:id/fund·settle·cancel` | Add a PreFlop sponsorship, settle an ended board, or cancel (the pool goes back to its funders) |
| `GET/POST /v1/admin/promotions` | Every promotion, plus the review queue. PreFlop promotions go live as soon as they are created |
| `POST /v1/admin/promotions/:id/decision·end` | Approve, or reject with a required note; or end a promotion now |
| `GET/POST /v1/org/:id/leaderboards` · `POST …/:lb/fund` | Chip and diamond boards on the organization's own tables or rooms, funded from its treasury |
| `GET/POST /v1/org/:id/promotions` | Announcements, leaderboard cards and drops. They start as `pending_review` |

The ledger kinds are:
- `pool.fund.sponsor`, `pool.fund.org`: fixed amounts put into a pool;
- `pool.accrue.margin`, `pool.accrue.contribution`: the worker's accruals;
- `pool.payout`, ref `<board>:<rank>`: a prize;
- `pool.return`, `pool.cancel`: money going back to the funders;
- `promo.claim`, ref `<promotion>:<user>`: a claimed promotion;
- `agent.commission`, ref `<statement>`: an agent commission, from `PreFlop:marketing` to the agent's wallet.

## Agents (docs/16 §4)

| Endpoint | What it does |
|---|---|
| `POST /v1/me/agent/apply` | Apply to become an agent, with an optional note. Returns the code (inactive until approved). `409 already_applied` unless the last application was rejected |
| `GET /v1/me/agent` | Your agent account, players referred, sub-agents and statements. `/v1/me` also carries `agent: {status, code}` |
| `GET /v1/admin/agents` | Rate caps, every agent with parent and player count, and every statement (team) |
| `PUT /v1/admin/agents/:id` | Status, rates and parent (admin, ops). Errors: `rate_cap`, `invalid_parent`, `depth_limit` |
| `POST /v1/admin/agents/statements/close?month=YYYY-MM` | Build the statements for a month that has ended, once (admin, ops). `422 month_not_ended` before one hour after month end; a closed month returns `created: 0` |
| `POST /v1/admin/agents/statements/:id/approve` | Draft → approved (admin, ops) |
| `POST /v1/admin/agents/statements/:id/pay` | Approved → paid (admin only). `403 mode_disabled` while that real-money mode is off; `422 agent_not_active` while the agent is suspended |

## Tournaments (docs/17)

| Endpoint | What it does |
|---|---|
| `GET /v1/tournaments?status=upcoming\|running\|finished` | Tournaments with entries, the prize pool, and whether registration is open. Signed in, each also has `you.registered` |
| `GET /v1/tournaments/:id` | The dashboard: the tournament, standings (rank with ties, stack, bets used and left, pending, status, prize), `you` with your bets, and `server_time` |
| `POST`, `DELETE /v1/tournaments/:id/register` | Join (the buy-in is paid), or leave before the start (refunded) |
| `POST /v1/tournaments/:id/bets` | A bet of tournament points on an open flop, at the current PreFlop odds. One per flop |
| `GET/POST /v1/admin/tournaments` · `GET …/:id` · `POST …/:id/cancel` | Team management (admin, ops). Free-chip and real-money tournaments |
| `GET/POST /v1/org/:id/tournaments` · `POST …/:t/cancel` | Clubs and organizers: chip and diamond tournaments in their closed loop |

WebSocket: subscribe to `tournament:<id>` for `tournament.standings` (refetch the dashboard). A signed-in socket also receives `tournament.bet_settled` for its own bets.

The ledger kinds are:
- `tournament.buyin`, `tournament.refund` (ref: the buy-in);
- `tournament.added`, `tournament.added_return`, `tournament.fee` (ref: the tournament);
- `tournament.payout` (ref `<tournament>:<user>`).

## News (migration 015)
Posts about the app and the platform, shown on the website at `/news` and written in the console (admin → Platform → News).

| Route | Purpose |
|---|---|
| `GET /v1/news?limit=1–50&tag=` | Published posts, newest first, without bodies. A bad `limit` or `tag` is `400` |
| `GET /v1/news/:slug` | One published post with its body; drafts and unknown slugs are `404` |
| `GET /v1/admin/news` | Every post, drafts included (`admin`, `ops`) |
| `POST /v1/admin/news` · `PUT /v1/admin/news/:id` | Create (title 3–120, summary ≤ 300, body ≤ 20,000, ≤ 8 tags) or update. The slug is made from the title (`-2`, `-3`… when taken); an explicit slug in use is `409 slug_taken` |
| `POST /v1/admin/news/:id/publish` · `/unpublish` · `DELETE /v1/admin/news/:id` | A first publication is dated now; republishing keeps the date |

Every change is audited (`news.created`, `news.updated`, `news.published`, `news.unpublished`, `news.deleted`). The body is a small Markdown subset (paragraphs, `##`/`###`, lists, bold, italic, code, https links) rendered by `@preflop/ui/markdown` into React elements, never into raw HTML.
