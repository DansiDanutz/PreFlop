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
| `GET /v1/book?channel=direct\|club\|partner` | Every market and selection, with its exact probability and odds |
| `GET /v1/modes` | Enabled play modes, and `physical_play_enabled` (off by owner decision) |
| `GET /v1/lobby` · `GET /v1/clubs/:id` · `GET /v1/tables/:id` | Clubs and tables, with readiness, the current round, the last flop and the history |
| `GET /v1/tables/:id/rounds/current` · `GET /v1/rounds/:id` | Round state |
| `GET /v1/rooms` · `GET /v1/rooms/:id` | Public rooms run by organizers. A room's `odds` map shows its own book |
| `POST /v1/applications` | Website application forms for a club, partner or organizer |
| `WS /v1/stream` | Subscribe with `{"subscribe":["lobby","table:<id>"]}`. Add `?token=` to receive your own bet events |

## Player
| Route | Purpose |
|---|---|
| `POST /v1/auth/register` · `login` · `logout` | Sessions. A new account gets 10,000 free play chips. `register` takes an optional `ref` (an agent code, docs/16 §4). `register` and `login` are rate-limited per IP; `login` also locks an email after 5 failures in 15 minutes (`429 login_locked`) |
| `GET /v1/me` · `/v1/me/wallets` | Profile, memberships, and wallets. Wallets cover play, chips, diamonds per organization, fiat and stablecoins |
| `PATCH /v1/me` | Change the display name (1–60 characters). Email and password changes are not part of this route |
| `POST /v1/bets` (+ `Idempotency-Key`) | Fixed odds against PreFlop, or with `room_id` against an organizer house or into a pool. Rate-limited per user |
| `GET /v1/me/bets` · `/v1/me/ledger` · `/v1/me/stats` | History |
| `POST /v1/me/play/reset` | Resets play money at any time |
| `GET/PUT /v1/me/favorites` | Six favorite selections (`docs/15`) |
| `POST /v1/rooms/join {code}` | Joins an invite-only room |
| `GET/PUT /v1/me/limits` · `POST /v1/me/self-exclusion` | Responsible gaming. A lower limit applies at once; a higher one waits 24 h. Self-exclusion ends the sessions |
| `POST /v1/me/kyc` | KYC through the sandbox provider |
| `POST /v1/me/deposits` · `withdrawals` · `GET /v1/me/payments` | Real money on the sandbox rail. Needs the mode enabled, KYC, and the deposit limit (EUR-equivalent) |
| `POST /v1/me/chips/purchases` | Buy virtual chips: 100 per euro, paid in EUR, USDT or USDC |

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
- `void` and `pause`/`resume` (floor manager);
- `rounds/:id/review` and `rounds/:id/evidence` (floor manager);
- `heartbeat`, `state`, `devices/:id/checkpoint`.

## Organization portals (`/v1/org/:orgId/...`)
**Access:**
- Members by role: `owner` and `admin` can write; `viewer` is read-only.
- The PreFlop team can read every organization. Platform `admin` and `ops` can also write.

**Common to every organization:**
- `overview`;
- `PUT /` (settings);
- `members`;
- `statements?period=YYYY-MM` (dynamic sharing, `docs/09`);
- `rounds`;
- `players`;
- `treasury`;
- `transfers`.

**Club:**
- `tables` (GET, POST);
- `tables/:id/certification`: 9 items, each recording who and when, with an expiry. The three per-shift items expire after 12 h;
- `staff` (GET, POST to enroll an Ed25519 SPKI PEM) and `staff/:id/revoke`.

**Organizers and clubs:**
- `rooms` (GET, POST, PUT) and `rooms/validate`, which returns any problems, the guaranteed organizer EV and the fee-rate bound;
- `collateral/deposits`;
- `diamonds/packs` and `diamonds/purchases`;
- `chips/purchases`;
- `dilution`.

**Partner:**
- `api-clients` (the secret is shown once) and `api-clients/:id/revoke`;
- `webhooks`, `webhooks/:id/test` and DELETE;
- `bets`;
- `widget` (GET, PUT): settings plus an iframe snippet.

## Partner API (server to server)
| Route | Purpose |
|---|---|
| `POST /v1/partner/oauth/token` | Client credentials → bearer token (1 h). Rate-limited per IP |
| `POST /v1/partner/players` · `/v1/partner/players/:ref/session` | Partner players, and the widget session token |
| `POST /v1/partner/players/:ref/deposits` | Transfer wallet mode: partner float → player wallet |
| `POST /v1/partner/bets` · `GET /v1/partner/bets` | Bets on the `partner` channel |

**Webhooks:**
- Payloads are signed with the header `X-PreFlop-Signature: t=<unix>, v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`.
- Failed deliveries retry with exponential backoff for 24 h.
- Deduplicate by `event_id`.
- Delivery rows are written **in the same transaction** as the settlement or void that produced the event, so an event cannot be lost between the commit and the fan-out, whichever process (API or worker) settled the round. `round.voided` goes to every subscribed partner; `bet.settled` and `bet.voided` only to the partner whose player placed the bet.

## PreFlop team (`/v1/admin/...`)
**Monitoring:**
- `overview`;
- `metrics`: operational counters as JSON (see *Health and metrics*);
- `alerts` and `alerts/:id/resolve`;
- `review-queue`;
- `rounds`, `rounds/:id/evidence` and `rounds/:id/void`. The team can void and refund, but **never settle by hand**;
- `risk`: worst-case exposure per open round, plus the CUSUM outcome monitor.

**Administration:**
- `users` (GET, PUT): status, KYC and roles. A self-exclusion cannot be lifted early;
- `orgs` (GET, POST, `:id/status`);
- `applications` and `applications/:id/decision`. An approved application creates the organization, and the applicant becomes its owner when they register;
- `tables` and `tables/:id/status`;
- `settings` (`modes_enabled`, `physical_play_enabled`, `territories`).

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
| `429 rate_limited` | More than `RATE_LIMIT_BETS_PER_MIN` (120) calls a minute to `POST /v1/bets` | Per signed-in user, per API instance |
| `429 login_locked` | 5 failed logins for one email within 15 minutes. The right password is refused too until the oldest of those failures is 15 minutes old; `Retry-After` says when. A successful login clears the count. Unknown emails behave the same | Per email, **all instances** (stored in Postgres) |

The rate limits are fixed one-minute windows kept in each API process, so behind a load balancer with N instances a client can get up to N × the limit. Set `TRUST_PROXY=true` behind a load balancer, otherwise every client shares the balancer's address.

## Health and metrics
- `GET /v1/health` is the liveness probe and `GET /v1/health/ready` the readiness probe (see *Public*). Every worker loop (`RUN_WORKER=true` in the API, or `pnpm --filter @preflop/api worker`) upserts a row in `worker_heartbeats` once a second.
- `GET /v1/admin/metrics` (PreFlop team, any platform role) returns:

| Field | Meaning |
|---|---|
| `outbox.pending` · `outbox.oldest_pending_age_s` | Outbox lag: jobs not done yet, and the age of the oldest |
| `webhook_deliveries.pending` · `failed` · `oldest_pending_age_s` | Webhook backlog, and deliveries that gave up after 24 h |
| `alerts.open` · `alerts.open_critical` | Unresolved alerts |
| `rounds_by_state` | Count of rounds per state (`OPEN`, `LOCKED`, …, `SETTLED`, `VOID`) |
| `sweeper_voids_last_hour` | Rounds the deadline sweeper voided in the last hour |
| `worker` | Freshest worker heartbeat (`ok`, `last_beat_age_ms`, `max_age_ms`) |
| `instance.db_retries` | Deadlock (`40P01`) and serialization (`40001`) retries of `tx()` since this process started, and `exhausted` (gave up with `503 retry_later`). A non-zero deadlock count means a code path broke the lock order |
| `instance.ws_clients` | WebSocket clients connected to this process |

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
pnpm install && pnpm -r build
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
