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
| [`docs/odds-book.md`](docs/odds-book.md) | **Generated** odds book: every selection, its exact probability, odds and net EV |

## Odds engine (`packages/odds-engine`)

A TypeScript library with no runtime dependencies. It covers:

- **Exact probabilities.** Every selection is evaluated on all 22,100 possible flops, with no simulation.
- **Pricing.** Odds are rounded down from `(1 − margin) / p`. The margin is the larger of the tier floor (5–15%) and the margin needed to keep PreFlop's net expected value after revenue shares, promotions, payments, KYC and operating costs.
- **Exposure.** It computes the house's worst-case loss over every possible flop for a round, and rejects bets that breach the limit.
- **Settlement.** The same predicate that prices a selection also settles it. Payouts are integers in minor units.
- **Fees and pools.** It implements P = B − F, role merging and exact largest-remainder splits, and parimutuel pools.

```bash
pnpm install
pnpm test        # 50 tests: combinatorics, house-edge and net-EV invariants, exposure, settlement, fees
pnpm typecheck
pnpm book        # regenerate docs/odds-book.md and docs/odds-book.json after changing markets or costs
```

To change commercial assumptions, edit `packages/odds-engine/src/costModel.ts`, which holds the net target, revenue shares and costs. Then run `pnpm book`. The tests fail if any offered price would drop below the net target, or if the committed odds book is out of date.
