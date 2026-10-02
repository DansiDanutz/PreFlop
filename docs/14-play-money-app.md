# PreFlop practice app — delivery plan

## Product structure

The platform contains clubs; each club contains tables. Every table displays its organizer. The first release is a functional practice app with explicitly simulated tables, no paid chips, transfer, cash-out, prizes, live-provider claims or licensing assertions. Provider-connected live streaming and licensed club onboarding remain separate integrations requiring actual providers.

Navigation: Lobby → Club → Table; global Activity and Profile. The table is the working surface: previous flop, round state, six favorite selections with decimal odds, amount, receipt. Browse bets provides all offered engine selections grouped into its seven actual families, searchable by selection, market and rule. Star a selection to fill a slot or choose one of six slots to replace. Favorites persist across tables.

## Experience

Use the approved charcoal, emerald and ivory design. A serif wordmark contrasts with a readable system UI font. Desktop uses a left navigation rail, table cards and an optional history panel; mobile has a bottom navigation bar and full-width sheets. No oversized marketing hero.

Animations: brief selection feedback; staggered card reveals after server settlement; chip balance transition; reduced-motion alternative. Every round is initiated by the player. Show exact costs and total return before confirmation. No auto-repeat, pressured countdowns, loss-chasing prompts, near-miss manipulation, streak penalties or fabricated activity.

## Source and boundaries

Base: PR #2 head 72b5062c1ec67afbf90a6a7080a9e494fc075da4. Its CI is green, but the Greptile review text still reports three blocking specification issues. The existing backend is a specification, not executable production code. Do not merge that PR or claim the integrity system is implemented.

Reuse the committed odds book for displayed prices and the exact engine predicates for settlement. Server-selected random flops are simulations, never camera evidence. Real captured rounds must eventually follow the evidence-rejection, authenticated shuffle, capture-sequence, deadline and mutually exclusive refund/settlement requirements; simulated practice is explicitly a different mode.

## Delivery sequence and acceptance

1. Durable practice API: anonymous secure session, free-chip account, favorites, idempotent server-settled rounds, ledger receipts and read-only history. Atomic writes prevent double payment and overspending.
2. Responsive lobby, club directory, table play, searchable bet catalogue, replacement dialog, activity and profile/help.
3. Verify valid and invalid requests, cross-session isolation, replay safety, insufficient chips, favorite persistence, reload recovery, and correct engine outcomes. Run existing engine tests and type checks with available dependencies.
4. Inspect rendered screens at 320, 390, 768, 1024 and 1440px; test keyboard, reduced motion, dialog focus and 200% reflow. Repair failures.
5. Publish privately with Sites if native registration and deployment succeed. Preserve source on a Codex branch. No public sharing changes or PR #2 merge.

## Runtime

Use a dependency-light ES-module Worker, a D1 database in Sites and SQLite for local development. Session cookies identify a practice profile on one browser; this is not cross-device account sign-in. Balances/history/favorites live on the server. No storage of authoritative state in browser localStorage. The named PreFlop cloud environment is user-reported; this desktop task has no attached cloud executor tool and must not claim to run there.

Local disk preflight holds new dependency installs. Reuse installed tools and avoid a framework bootstrap or large downloads.
