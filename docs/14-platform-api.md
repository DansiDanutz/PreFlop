# 14 — Platform API reference (implemented)

This is the API as **built** in `apps/api`. The typed client in `packages/client/src/index.ts` is the contract that every frontend uses. `docs/02` describes the integration model, and `docs/13` the core spec this implements.

**Common rules**
- Money is in integer minor units, with a currency. Odds are integer hundredths.
- Errors are `application/problem+json` objects with a stable `type`.
- Player and console calls use `Authorization: Bearer <session>`.
- Table devices and staff use the signed envelope (`X-PreFlop-Auth`, `docs/13` §7).
- Partners use OAuth client credentials.

## Public
| Route | Purpose |
|---|---|
| `GET /v1/health` | Liveness |
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
| `POST /v1/auth/register` · `login` · `logout` | Sessions. A new account gets 10,000 free play chips |
| `GET /v1/me` · `/v1/me/wallets` | Profile, memberships, and wallets. Wallets cover play, chips, diamonds per organization, fiat and stablecoins |
| `PATCH /v1/me` | Change the display name (1–60 characters). Email and password changes are not part of this route |
| `POST /v1/bets` (+ `Idempotency-Key`) | Fixed odds against PreFlop, or with `room_id` against an organizer house or into a pool |
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
| `POST /v1/partner/oauth/token` | Client credentials → bearer token (1 h) |
| `POST /v1/partner/players` · `/v1/partner/players/:ref/session` | Partner players, and the widget session token |
| `POST /v1/partner/players/:ref/deposits` | Transfer wallet mode: partner float → player wallet |
| `POST /v1/partner/bets` · `GET /v1/partner/bets` | Bets on the `partner` channel |

**Webhooks:**
- Payloads are signed with the header `X-PreFlop-Signature: t=<unix>, v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`.
- Failed deliveries retry with exponential backoff for 24 h.
- Deduplicate by `event_id`.

## PreFlop team (`/v1/admin/...`)
**Monitoring:**
- `overview`;
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
