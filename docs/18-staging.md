# 18 — Staging environment (Vercel + Fly.io + Neon)

Staging runs the real product against **simulated tables**:
- real money stays **off** (`modes_enabled`);
- physical-table play stays **disabled**;
- `NODE_ENV=production`, so staging behaves like production. The sandbox KYC, payment and purchase rails answer `503 provider_not_configured`, and everything else runs on free chips.

```
 players / team ──▶ Vercel ── preflop-staging-web      (website + player app)
                          ├─ preflop-staging-console  (PreFlop team, clubs, partners, organizers, agents)
                          └─ preflop-staging-table    (club tablet)
                                      │ HTTPS + WebSocket
                                      ▼
                   Fly.io ── preflop-staging-api  (API + worker, region fra) ──▶ Neon Postgres (eu-central-1)
                          └─ preflop-staging-sim  (5 simulated tables)  ─────────▲  (direct endpoint, TLS)
```

| Piece | Where | Defined in |
|---|---|---|
| API and worker | Fly app `preflop-staging-api` | `deploy/fly/api.toml`, Dockerfile target `api` |
| Simulated tables | Fly app `preflop-staging-sim` | `deploy/fly/sim.toml`, Dockerfile target `sim` |
| Website and player app, console, club tablet | Vercel projects `preflop-staging-{web,console,table}` | `apps/*/vercel.json` |
| Database | Neon, region `eu-central-1` | migrations run on API start (advisory lock) |

## One-time setup (owner)

1. **Neon**
   1. Create a project `preflop-staging`, region **AWS eu-central-1 (Frankfurt)**, Postgres 16.
   2. Copy the **direct** connection string, not the pooled one. The pooled endpoint (pgbouncer) drops the session settings and advisory locks the API relies on.
   3. Change its end to `?sslmode=verify-full`.
   4. The API refuses a remote database without TLS. Neon's generated password (`npg_…`) meets the 16-character minimum.
2. **Fly.io**
   1. Create an account, then `fly auth login`.
   2. Create the apps:
      ```sh
      fly apps create preflop-staging-api
      fly apps create preflop-staging-sim
      ```
   3. Set the API secret:
      ```sh
      fly secrets set -a preflop-staging-api DATABASE_URL='postgres://…neon.tech/neondb?sslmode=verify-full'
      ```
   4. Set the simulator secrets:
      ```sh
      fly secrets set -a preflop-staging-sim DATABASE_URL='…same…' ADMIN_EMAIL='you@example.com' ADMIN_PASSWORD='<16+ random chars>'
      ```
   5. Create a deploy token with `fly tokens create org`. Add it to GitHub as the repository secret **`FLY_API_TOKEN`** (Settings → Secrets and variables → Actions → New repository secret).
3. **Vercel**
   1. The three projects are linked to `DansiDanutz/PreFlop` (root directories `apps/web`, `apps/console` and `apps/table`).
   2. Each needs `VITE_API_URL=https://preflop-staging-api.fly.dev`; the console also needs `VITE_WEB_URL=https://preflop-staging-web.vercel.app`.
   3. If Vercel asks for access to the repository, approve the Vercel GitHub app for it.

## Deploying
- **Automatic.** Every push to `main` runs CI. When CI passes, **Deploy staging** (`.github/workflows/deploy-staging.yml`) deploys the API, then the simulator, then smoke-checks `/v1/health/ready`. Vercel builds the three sites from the same push, and builds a preview for every pull request. Previews talk to the staging API from their unique deployment URL (`<project>-<hash>-irises-projects-ce549f63.vercel.app`, listed under the project's Deployments); the API's `CORS_ORIGINS` allows that pattern, but not the branch aliases (`…-git-<branch>-…`).
- **By hand.** Use Actions → Deploy staging → Run workflow, or from the repo root:
  ```sh
  flyctl deploy --config deploy/fly/api.toml --dockerfile Dockerfile --remote-only
  ```
- **Order.** Migrations are forward-only and run when the API starts, so the API always deploys before the simulator.

## Operating
| Task | Command |
|---|---|
| Health | `curl https://preflop-staging-api.fly.dev/v1/health/ready` |
| Logs | `fly logs -a preflop-staging-api` (structured, with request ids) · `fly logs -a preflop-staging-sim` |
| Releases and rollback | `fly releases -a preflop-staging-api`, then `fly deploy -a preflop-staging-api --image <previous image>` |
| Scale | `fly scale count 2 -a preflop-staging-api`. Exposure locks and the worker are safe on several machines |
| Database backup and restore | Neon keeps point-in-time history. Create a **branch** at a timestamp to inspect or restore; take a branch before risky migrations |
| Metrics | `GET /v1/admin/metrics` (admin token) |
| Rotate the simulator's table keys | `fly machine restart -a preflop-staging-sim` (it re-seeds and rotates its keys on a fresh machine) |

## First demo data
See `deploy/staging-bootstrap.md` for the API calls that create a free-chip tournament and a leaderboard after the first deploy.

## Cost (approximate, staging)
- **Fly:** two shared-cpu-1x 512 MB machines, always on (≈ US$4–6 each a month).
- **Neon:** the free tier or Launch plan.
- **Vercel:** Hobby or Pro, depending on the team plan.
