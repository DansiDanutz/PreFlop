# PreFlop practice app

A working play-money experience built on the repository's exact flop predicates and committed direct-channel odds book. The UI includes a multi-club lobby, club pages, saved tables, six replaceable favorite selections, a searchable 241-selection catalogue, server-settled rounds, receipts and profile preferences.

## Run locally

Use Node 22.18+ (Node 24 LTS recommended) and the existing repository dependencies. No additional app runtime package is needed.

```sh
pnpm install --frozen-lockfile
pnpm dev:app
# http://127.0.0.1:4173
```

The local development adapter uses Node SQLite and applies committed SQL migrations to `.local/practice.sqlite`. This private data is ignored by Git. The production Worker uses Sites' D1 binding `DB` and the same prepared SQL operations. Never use the local development server as a public production server.

```sh
pnpm test:app
pnpm check:app
pnpm test
pnpm typecheck
pnpm build
pnpm build:app
```

`build:app` emits the Worker and embedded frontend into `dist/server/`. It reuses TypeScript from the odds-engine's existing dependencies, includes only the engine's runtime dependency graph, and embeds the odds book. No dependency installation is part of the build.

For optional browser QA, provide an existing Playwright installation through `PREFLOP_PLAYWRIGHT_MODULE` and run `node web/test/browser.mjs` with the local server running. The test uses installed Google Chrome; it does not download a browser. Screenshots go into ignored `.local/qa/`.

## Data and API

- `GET /api/bootstrap`: creates or restores an anonymous practice profile and returns clubs, tables, odds, favorites and the most recent 100 receipts.
- `POST /api/round`: one selection, 10–1,000 chips, exact displayed odds and a UUID request ID. The server chooses the flop and settles with the repository predicate. A retry returns the original receipt.
- `GET /api/round/:id`, `GET /api/history`: session-isolated receipts.
- `POST /api/favorites`: six unique offered selection IDs with optimistic profile version.
- `POST /api/table-favorite`, `POST /api/profile`: saved tables and display name.
- `POST /api/refill`: restores the balance to 10,000 only below 1,000 chips, at no cost.

The HTTP-only, Secure (HTTPS), SameSite=Strict session cookie holds a random token; only its SHA-256 digest is stored. Sessions last 90 days. Browser storage contains only an optional in-flight request for safe recovery; authoritative data lives in the database. A profile is linked to its browser cookie, not a cross-device login.

Rounds atomically update the profile using its version and insert an immutable receipt in a D1 batch. A composite profile/request key provides idempotency; failed insertions roll back the balance update. Schema constraints enforce nonnegative balances and the receipt's balance equation. The local SQLite adapter models this transaction behavior. See [D1 batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

Schema source: `db/schema.ts`. The initial migration was generated with Drizzle Kit 0.31.9 / Drizzle ORM 0.45.2 using already installed tooling. To change schema, use that tooling to generate and inspect a new migration. Do not edit applied migrations. Runtime code never creates tables in production.

## Current boundaries

- Clubs and table states are example content. Cards are simulated; no camera or live-provider stream is connected.
- No chip purchase, cash-out, transfer, prizes, real currencies or payment paths exist.
- No organizer administration, club licensing verification, Table Box ingestion, cross-device login or native App Store binary is included. This is a responsive web practice app, with a standalone web manifest.
- The live evidence/refund/settlement specification still requires independent review and implementation. PR #2 is not merged by this work.
- Price assumptions are inherited from the existing odds book; they are not represented as certified or commercially final.
- Reduced motion follows the device preference. Play is user-initiated, with no auto-replay or pressure countdown.

## Verification in this delivery

- 111 existing engine tests passed, using available Vitest 4.1.10; the lockfile's Vitest 3.x was not installed because the local disk preflight blocked new installs. CI uses the committed lockfile.
- 12 API tests passed, including 50 concurrent identical requests, session separation, replay conflicts, stale favorites, invalid odds and insufficient chips.
- Existing engine typecheck and build passed with available TypeScript 6.0.3. CI uses the declared TypeScript version from the lockfile.
- Browser journey passed: replace favorite → reload → play → receipt → activity → save name → reload.
- Six routes checked at 320, 390, 768, 1024 and 1440 CSS pixels; dialog keyboard behavior, reduced motion and 200% text reflow checked in desktop Chrome. These checks are not a full accessibility audit or physical-device validation.
