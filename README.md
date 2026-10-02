# PreFlop

Bet on the three-card **flop** dealt live at licensed poker clubs: against the house at fixed odds, against each other in pools, or in tournaments and challenges.

This repository holds the platform's design and its mathematical core:

| | |
|---|---|
| [`docs/00-business-plan.md`](docs/00-business-plan.md) | The founder's product and business plan (source of record) |
| [`docs/01-architecture.md`](docs/01-architecture.md) | System architecture, round state machine, modules, data model |
| [`docs/02-integration-api.md`](docs/02-integration-api.md) | Provider API (clubs), Partner API (betting companies), Player API |
| [`docs/03-market-rules.md`](docs/03-market-rules.md) | Card conventions, betting window, voids, every market |
| [`docs/04-house-edge-and-risk.md`](docs/04-house-edge-and-risk.md) | How the house edge is guaranteed, exposure limits, integrity |
| [`docs/05-fees-pools-tournaments.md`](docs/05-fees-pools-tournaments.md) | P = B − F, Models A–D, parimutuel pools, tournament scoring |
| [`docs/06-roadmap-and-decisions.md`](docs/06-roadmap-and-decisions.md) | Open decisions with recommendations; delivery phases |
| [`docs/07-unit-economics.md`](docs/07-unit-economics.md) | Net expected-value model: costs, required margins, break-even |
| [`docs/08-play-modes-and-currencies.md`](docs/08-play-modes-and-currencies.md) | Real fiat, real crypto (USDT/USDC), play money, virtual chips, diamonds |
| [`docs/09-dynamic-revenue-sharing.md`](docs/09-dynamic-revenue-sharing.md) | Shares that grow with hands, players, turnover and pools created, capped to protect profit |
| [`docs/10-who-pays-the-winnings.md`](docs/10-who-pays-the-winnings.md) | PreFlop house, organizer house (collateral), or pool |
| [`docs/profitability.md`](docs/profitability.md) | **Generated** monthly P&L for every participant in 8 scenarios |
| [`docs/odds-book.md`](docs/odds-book.md) | **Generated** odds book: every selection, its exact probability, odds and net EV |

## Odds engine (`packages/odds-engine`)

A TypeScript library with no runtime dependencies. It covers:

- **Exact probabilities.** Every selection is evaluated on all 22,100 possible flops, with no simulation.
- **Pricing.** Odds are rounded down from `(1 − margin) / p`. The margin is the larger of the tier floor (5–15%) and the margin needed to keep PreFlop's net expected value after revenue shares, promotions, payments, KYC and operating costs.
- **Exposure.** It computes the house's worst-case loss over every possible flop for a round, and rejects bets that breach the limit.
- **Settlement.** The same predicate that prices a selection also settles it. Payouts are integers in minor units.
- **Fees and pools.** It implements P = B − F, role merging and exact largest-remainder splits, and parimutuel pools.
- **Dynamic sharing.** Tier ladders by hands dealt, players, turnover and pools created, with a guardrail that keeps PreFlop's net EV on target.
- **Modes and houses.** Five play modes, and ledger postings that show who pays the winnings. Organizer collateral covers the worst case for every open round.
- **Diamonds.** The per-bet split (fixed PreFlop fee + rake + at-risk amount), pack pricing and the dilution tracker.
- **Profitability.** Scenario P&L for PreFlop, clubs, organizers, partners and players.

```bash
pnpm install
pnpm test        # 84 tests: combinatorics, house edge, net EV, exposure, settlement, fees, sharing, houses, diamonds, scenarios
pnpm typecheck
pnpm book        # regenerate docs/odds-book.{md,json} and docs/profitability.md
```

To change commercial assumptions, edit `packages/odds-engine/src/costModel.ts`, which holds the net target, revenue shares and costs. Then run `pnpm book`. The tests fail if any offered price would drop below the net target, or if the committed odds book is out of date.
