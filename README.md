# PreFlop

Bet on the three-card **flop** dealt live at poker clubs:
- against the house at fixed odds;
- against each other in pools;
- in rooms that organizers run with chips or diamonds.

Clubs supply tables and live video. Betting companies integrate through an API and a widget. Every participant earns a dynamic share.

> **Operating status.** Physical-table play is **disabled in every mode, including play money**. This is an owner decision (`docs/06` #7). Certifying the PreFlop Trusted Shuffler is a prerequisite for reconsidering that decision; it does not switch play back on automatically. Until then everything runs on **simulated tables**. Real-money modes are built but **off** by default, and they use sandbox rails for payments, crypto and KYC.

**Reviewers: start with [`AUDIT.md`](AUDIT.md).**

## What's in the repo

| Path | What it is |
|---|---|
| `packages/odds-engine` | The maths. Exact probabilities over all 22,100 flops, house-edge pricing with net EV after costs, exact exposure, settlement, fees and pools, dynamic sharing, play modes, house models and collateral, diamonds, table readiness and signed evidence. 131 tests |
| `packages/db` | PostgreSQL 16 schema and migrations, including an append-only balanced ledger and a hash-chained audit log |
| `apps/api` | Fastify API, WebSocket stream, worker (outbox, deadline sweeper, webhooks) and simulated tables. It implements `docs/13`. PostgreSQL integration tests plus a 10,000-round soak test |
| `apps/web` | Public website and player app (PWA). Mobile-first, following Codex's concepts (`docs/15`), with the partner widget at `/embed` |
| `apps/console` | Dashboards for the PreFlop team, poker clubs, partners (betting companies) and organizers |
| `apps/table` | Club tablet for the dealer, floor and floor manager. Each person has an Ed25519 key in WebCrypto, and every request is signed |
| `packages/ui`, `packages/client` | Design tokens and components, and the typed API client (the contract) |

## Run it locally

```bash
pnpm install
pnpm -r build
# PostgreSQL 16 on localhost:5432
export DATABASE_URL=postgres://postgres@localhost:5432/preflop
pnpm --filter @preflop/api dev        # API + worker → :4000
pnpm --filter @preflop/api sim        # 5 simulated tables (a flop every 20 s)
ADMIN_PASSWORD=… pnpm --filter @preflop/api demo   # demo orgs + users; passwords from env, or generated and printed
pnpm --filter @preflop/web dev        # :5173  website + player app
pnpm --filter @preflop/console dev    # :5174  dashboards
pnpm --filter @preflop/table dev      # :5175  club tablet
```

You can also run the whole stack with `docker compose up --build`. That starts the API, the simulator, the web app on :8080, the console on :8081 and the tablet on :8082.

To check the code:

- `pnpm test` runs every test. The API tests need `TEST_DATABASE_URL` set to a PostgreSQL server.
- `pnpm typecheck` checks types.
- `ROUNDS=10000 pnpm --filter @preflop/api soak` runs the phase 1 exit check.

## Running in production

The API and the worker validate their environment at start (`apps/api/src/config.ts`). A malformed value stops them with a list of every problem. With `NODE_ENV=production` they also refuse unsafe settings, listed below. Real money stays off and physical-table play stays disabled: those are database settings and owner decisions, not environment variables.

| Variable | Default | Production rule |
|---|---|---|
| `NODE_ENV` | `development` | Set to `production` to turn on the checks in this column |
| `DATABASE_URL` | `postgres://postgres@localhost:5432/preflop` | **Required.** If it has a password, it must be at least 32 characters and not a demo value (`postgres`, `password`, `changeme`, …) |
| `CORS_ORIGINS` | `*` | **Required.** A comma-separated list of the web, console and table origins. `*` or empty is refused |
| `ADMIN_PASSWORD` | unset | If set, it must be at least 12 characters, use 3 of lowercase / uppercase / digits / symbols, and not contain a common word (`password`, `preflop`, `admin`, …). Read by the seed scripts |
| `WEBHOOK_ALLOW_PRIVATE` | `false` | Must not be `true` (it lets webhooks reach private addresses; tests only) |
| `RATE_LIMIT_ENABLED` | `true` | Must not be `false` |
| `RATE_LIMIT_AUTH_PER_MIN` · `RATE_LIMIT_PARTNER_TOKEN_PER_MIN` · `RATE_LIMIT_BETS_PER_MIN` | `20` · `30` · `120` | Per-IP login/register, per-IP partner token, per-user bets; per API instance |
| `TRUST_PROXY` | `false` | Set to `true` behind a load balancer, so per-IP limits see the client address |
| `PORT` | `4000` | |
| `RUN_WORKER` | `true` | `false` when the worker runs separately (`pnpm --filter @preflop/api worker`); several workers may run |
| `WORKER_HEARTBEAT_MAX_AGE_MS` | `15000` | `GET /v1/health/ready` fails when no worker has beaten for this long |
| `RESULT_SLA_MS` · `REVIEW_SLA_MS` · `MAX_CAPTURE_DELAY_MS` | 5 min · 30 min · 3 min | Round deadlines (`docs/13` §4) |
| `PLAY_START` | `10000` | Starting play-money balance |
| `LOG` | `false` | `1` turns on JSON request logs; every line carries `request_id` |
| `WEB_URL` | `http://localhost:5173` | Origin used in the partner widget snippet |

Probes: liveness `GET /v1/health`, readiness `GET /v1/health/ready` (database plus a fresh worker heartbeat). Operational counters: `GET /v1/admin/metrics`. Several API processes can share one database: bet exposure, the login lockout and webhook fan-out are all enforced in PostgreSQL (`docs/14`, *Limits* and *Health and metrics*).

## Documentation

| | |
|---|---|
| [`docs/00`](docs/00-business-plan.md) | The founder's business plan (source of record) |
| [`docs/01`](docs/01-architecture.md) · [`02`](docs/02-integration-api.md) | Architecture and the integration model (Provider, Partner and Player APIs) |
| [`docs/03`](docs/03-market-rules.md) · [`04`](docs/04-house-edge-and-risk.md) · [`05`](docs/05-fees-pools-tournaments.md) | Market rules, house edge and risk, and fees, pools and tournaments |
| [`docs/06`](docs/06-roadmap-and-decisions.md) · [`07`](docs/07-unit-economics.md) | Decisions and roadmap, and unit economics (net EV) |
| [`docs/08`](docs/08-play-modes-and-currencies.md) · [`09`](docs/09-dynamic-revenue-sharing.md) · [`10`](docs/10-who-pays-the-winnings.md) | Play modes and currencies, dynamic sharing, and who pays the winnings |
| [`docs/11`](docs/11-club-requirements.md) · [`12`](docs/12-table-hardware-and-security.md) | Club requirements, and table hardware, live stream, Table Box security and evidence |
| [`docs/13`](docs/13-phase1-backend-spec.md) | Core backend spec (implemented in `apps/api`) |
| [`docs/14`](docs/14-platform-api.md) | **Platform API reference** as built, and the money flows |
| [`docs/15`](docs/15-app-design.md) | App design taken from Codex's mobile concepts |
| [`docs/16`](docs/16-leaderboards-promotions-agents.md) · [`17`](docs/17-tournaments.md) | Leaderboards, prize pools, promotions and agents; tournaments |
| [`docs/18`](docs/18-staging.md) | **Staging environment** (Vercel + Fly.io + Neon): setup, deploys, operations |
| [`docs/screens/`](docs/screens) | Screenshots of the web app, console and club tablet |
| [`docs/odds-book.md`](docs/odds-book.md) · [`docs/profitability.md`](docs/profitability.md) | The generated odds book and P&L for each participant |

To change commercial assumptions:

1. Edit `packages/odds-engine/src/costModel.ts` (net target, revenue shares and costs) and `globalRules.ts`.
2. Run `pnpm book`.

The tests fail if any offered price falls below the net target, or if the generated documents are out of date.
