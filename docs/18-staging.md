# 18 — Staging environment (Vercel + Fly.io + Supabase Postgres)

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
                   Fly.io ── preflop-staging-api  (API + worker, region fra) ──▶ Supabase Postgres (eu-central-1)
                          └─ preflop-staging-sim  (5 simulated tables)  ─────────▲  (direct endpoint, TLS)
```

| Piece | Where | Defined in |
|---|---|---|
| API and worker | Fly app `preflop-staging-api` | `deploy/fly/api.toml`, Dockerfile target `api` |
| Simulated tables | Fly app `preflop-staging-sim` | `deploy/fly/sim.toml`, Dockerfile target `sim` |
| Website and player app, console, club tablet | Vercel projects `preflop-staging-{web,console,table}` | `apps/*/vercel.json` |
| Database | Supabase Postgres, region `eu-central-1`: database `preflop_staging` (role `preflop_staging`) inside an existing project | migrations run on API start (advisory lock) |

## One-time setup (owner)

1. **Supabase Postgres** (staging moved here on 4 Oct 2026, when the Neon free-plan quota ran out: the worker polled the database every second around the clock; it now polls every 5 s while idle and every second only while there is work)
   1. In an existing Supabase project (eu-central-1), create a login role and a database it owns: `create role preflop_staging login password '<40 random hex chars>' connection limit 40; grant preflop_staging to postgres; create database preflop_staging owner preflop_staging;`.
   2. Use the **direct** connection, not the pooler: `postgres://preflop_staging:<password>@db.<ref>.supabase.co:5432/preflop_staging?sslmode=verify-full`. The direct host is IPv6-only, which Fly machines reach; the pooler (Supavisor) drops the session settings and advisory locks the API relies on.
   3. Supabase signs the database certificate with its own CA, so `deploy/supabase-ca.crt` (Supabase Root 2021 CA, from the project's Database settings → SSL) is copied into the image and the Fly configs point `NODE_EXTRA_CA_CERTS` at it; `verify-full` then checks the certificate and the host name. The API refuses a remote database without TLS.
2. **Fly.io**
   1. Create an account, then `fly auth login`.
   2. Create the apps:
      ```sh
      fly apps create preflop-staging-api
      fly apps create preflop-staging-sim
      ```
   3. Set the API secret:
      ```sh
      fly secrets set -a preflop-staging-api DATABASE_URL='postgres://preflop_staging:…@db.<ref>.supabase.co:5432/preflop_staging?sslmode=verify-full'
      ```
   4. Set the simulator secrets:
      ```sh
      fly secrets set -a preflop-staging-sim DATABASE_URL='…same…' ADMIN_EMAIL='you@example.com' ADMIN_PASSWORD='<16+ random chars>'
      ```
   5. Create a deploy token with `fly tokens create org`. Add it to GitHub as the repository secret **`FLY_API_TOKEN`** (Settings → Secrets and variables → Actions → New repository secret).
   6. Optional: `JEV_API_KEY` (docs/20, decision hints) on the API app, the same way. Without it the hints are simply off. The **Jev check** workflow (Actions → Jev check → Run workflow) asks the model one reading-check question with the repository secret, the same request the API sends, and prints only the HTTP status and a one-line verdict (key works, key refused, request rejected, rate limited); the response body is never logged. A new or rotated key can be checked that way before it is pushed to Fly; the Fly secret takes effect at the next deploy.
   7. Without a local flyctl, the **Fly secrets** workflow (Actions → Fly secrets → Run workflow) sets one secret on the API, the simulator or both, using `FLY_API_TOKEN`. Preferred: store the value first as a GitHub repository secret of the same name and leave the workflow's value empty; the run copies the encrypted secret to Fly and nothing is ever shown. Typing the value into the workflow works too, but GitHub keeps a run's inputs readable in the Actions UI, so rotate a value set that way if the repository is ever shared. The **Fly logs** workflow prints an app's status, machines and recent logs.
3. **Vercel**
   1. The three projects are linked to `DansiDanutz/PreFlop` (root directories `apps/web`, `apps/console` and `apps/table`).
   2. Each needs `VITE_API_URL=https://preflop-staging-api.fly.dev`; the console also needs `VITE_WEB_URL=https://preflop-staging-web.vercel.app`.
   3. If Vercel asks for access to the repository, approve the Vercel GitHub app for it.

## Deploying
- **Mobile apps.** The iOS and Android apps (`apps/mobile`) talk to the staging API from the origins `capacitor://localhost` and `https://localhost`, which `CORS_ORIGINS` allows. CI builds an installable Android APK (`.github/workflows/mobile.yml`).
- **Automatic.** Every push to `main` runs CI. When CI passes, **Deploy staging** (`.github/workflows/deploy-staging.yml`) deploys the API, then the simulator, smoke-checks `/v1/health/ready`, and then runs the end-to-end smoke test below against the live environment. Vercel builds the three sites from the same push, and builds a preview for every pull request. Previews talk to the staging API from their unique deployment URL (`<project>-<hash>-irises-projects-ce549f63.vercel.app`, listed under the project's Deployments); the API's `CORS_ORIGINS` allows that pattern, but not the branch aliases (`…-git-<branch>-…`).
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
| Scale | `fly scale count 2 -a preflop-staging-api`. Exposure locks, the worker and the WebSocket stream (events cross machines through PostgreSQL NOTIFY) are safe on several machines |
| Database backup and restore | Supabase's daily project backups, plus our own weekly dump and restore drill; see *Backups and restore drill* below. Before a risky migration: `scripts/db-backup.sh dump "$DATABASE_URL" before.dump` |
| Metrics | `GET /v1/admin/metrics` (admin token) |
| Rotate the simulator's table keys | `fly machine restart -a preflop-staging-sim` (it re-seeds and rotates its keys on a fresh machine) |

## Smoke test and uptime

**End-to-end smoke test** (`scripts/staging-smoke.mjs`, Node 22, no dependencies). It runs as the last step of every staging deploy and fails the deploy run when the live environment does not work as a player would use it:

1. the API is ready (database and worker heartbeat);
2. the lobby lists a simulated play-money table that is ready and has an open round;
3. a fresh player registers (`smoke-<time>@preflop-smoke.test`) and holds the play starting balance;
4. the WebSocket stream authenticates the player and delivers events for that table;
5. a play bet is accepted on the open round, settles within the budget (3 minutes per wait), and the wallet moves by exactly stake and payout;
6. the website, console and club tablet serve the app, and in the deploy workflow the build of the commit just deployed: every site carries `<meta name="build-commit">` (`deploy/build-commit.mjs`, from Vercel's `VERCEL_GIT_COMMIT_SHA`), and the test waits until it is the deployed commit (`EXPECTED_COMMIT`) or a later commit on main (`ACCEPT_NEWER_ON=origin/main`, asked of git on every poll), since Vercel builds the sites separately from the Fly deploy and a newer push may already be live. A manual deploy of another ref checks the sites for being up only; a git failure never passes a site.

Run it by hand against staging with `node scripts/staging-smoke.mjs`, or against another environment with `API_URL=… SITE_URLS=a,b,c node scripts/staging-smoke.mjs` (`SITE_URLS=` empty skips the sites). Each run leaves one smoke player account behind.

**Uptime** (`.github/workflows/uptime.yml`). Every 15 minutes a probe fetches `/v1/health/ready` and the three sites, retrying three times ten seconds apart. When something is down the run fails (GitHub emails the repository owner about failed scheduled runs) and the workflow opens one issue titled "Staging is down" with the label `uptime`, or adds the new probe to the open one; it recognises its own issue by a marker in the body, so other issues with that label are untouched. The next healthy probe closes the issue. Run it on demand from the Actions tab.

## Backups and restore drill

Two layers, so losing the database is a bad hour and not a bad month:

1. **Supabase** keeps daily backups of the whole project (Pro plan), restorable from its dashboard. They are the first line, and they belong to the project, not to this repository.
2. **Our own weekly dump** (`.github/workflows/backup.yml`, Sundays 03:23 UTC and on demand). The run takes a `pg_dump` of the staging database (custom format, compressed), **restores it into a scratch PostgreSQL 17 on the runner**, verifies the copy, and keeps the dump as a workflow artifact for 30 days (Actions → the run → Artifacts). A backup nobody has restored is a hope, so every weekly run is also the restore drill; a failing run means the backup or the restore is broken, and GitHub emails the owner about failed scheduled runs.

The verification (`scripts/db-backup.sh verify`) checks that the restored copy has the same applied migrations and the same row count in every table as the source, that the ledger sums to zero in every currency, and that the audit log's hash chain is intact and ends at `audit_head`. Any difference fails the run.

The workflow reads the repository secret `DATABASE_URL` (the same connection string the Fly apps use, with `sslmode=verify-full`; the Supabase CA in `deploy/supabase-ca.crt` is used to verify the server). The Fly secrets workflow already expects that secret under this name, so one secret serves both; without it the backup run fails with a message saying so.

By hand, from a machine with PostgreSQL client tools of version 17 or newer (the dump must come from a `pg_dump` at least as new as the server):

```sh
scripts/db-backup.sh dump    "$DATABASE_URL" staging.dump               # back up
scripts/db-backup.sh drill   "$DATABASE_URL" postgres://localhost/preflop_drill   # dump, restore into a scratch db, verify
scripts/db-backup.sh restore "$TARGET_URL"   staging.dump               # restore into a fresh, empty database
scripts/db-backup.sh verify  "$DATABASE_URL" "$TARGET_URL"             # compare a restored copy with its source
```

The script never prints connection strings; `restore` refuses a target that already holds tables, and `drill` refuses to use the source as its scratch database. To restore staging itself after a loss: create an empty database (Supabase SQL editor, or `create database`), `restore` into it, point the Fly apps' `DATABASE_URL` at it with the Fly secrets workflow, and deploy; the API applies any newer migrations at start.

## First demo data
See `deploy/staging-bootstrap.md` for the API calls that create a free-chip tournament and a leaderboard after the first deploy.

## Cost (approximate, staging)
- **Fly:** two shared-cpu-1x 512 MB machines, always on (≈ US$4–6 each a month).
- **Supabase:** no extra cost: the staging database lives inside a project the organization already pays for.
- **Vercel:** Hobby or Pro, depending on the team plan.
