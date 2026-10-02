# 09 — Dynamic Revenue Sharing

Shares are **not fixed percentages**. Each billing period, every participant's share is computed from what it actually contributed. A small club with 100 players earns a different share from a club with 1,000 players, and both differ from a betting company sending millions in turnover. The code is in `packages/odds-engine/src/sharing.ts`.

## 1. How a share is computed

```
share(participant) = clamp( Σ components , floor , cap )
component          = tier ladder over one measured metric
```

**Metrics,** measured from the ledger and the round log for the period:

| Metric | Measures |
|---|---|
| `handsDealt` | Flops a club's tables supplied (its content) |
| `activePlayers` | Players the participant brought who bet in the period |
| `turnoverMinor` | Stakes the participant's traffic generated |
| `poolsCreated` | Prize pools or contests the participant created in the app |

**Tier modes:**

| Mode | How it works | Use for |
|---|---|---|
| `whole-volume` | The highest tier reached applies to everything | Simple contract levels (e.g. "100+ players → 15%") |
| `progressive` | Each band of the metric is paid at its own rate and the result is the weighted blend. There are no cliffs, so crossing a threshold never makes earnings jump | Turnover and hands |

**Base:** fixed-odds shares are a % of **GGR** (stakes − payouts). Pool and contest shares are a % of **rake**.

**Losing months:** if GGR is negative, no shares are paid and the loss is carried forward against the next period. This is industry standard and stops PreFlop paying shares on money it lost.

**Exact amounts:** all amounts are integers, split with the largest-remainder method. PreFlop receives the remainder.

## 2. The profit guardrail

Every share comes out of the same margin, so no tier can be allowed to push PreFlop below its net target:

```
edge · (1 − s − b) − c_t ≥ T     ⇒     s_max = 1 − b − (T + c_t) / edge
```

If the shares computed for a period exceed `s_max`, they are scaled down proportionally and the statement is flagged `capped`. The commercial team then decides between a higher margin for that channel and a lower tier. A test proves that PreFlop's net EV stays at or above target after the cap.

## 3. Placeholder policies

| Participant | Components | Floor / cap |
|---|---|---|
| **Club** (its own players) | **Content** by hands dealt (progressive): 5% → 8% @10k → 10% @30k → 12% @60k<br>**Distribution** by active players (whole-volume): 0% → 10% @25 → 15% @100 → 20% @500 → 25% @2,000 | 5% / 35% of GGR |
| **Provider club** (players come from others) | Content only (as above) | 5% / 12% of GGR |
| **Betting company** | Distribution by monthly turnover (progressive): 20% → 25% @€1M → 30% @€5M → 35% @€20M | 20% / 40% of GGR |
| **Pool / contest creator** (betting company, club or user) | By pools created per month (whole-volume): 30% → 35% @50 → 40% @500 → 45% @5,000 | 30% / 45% of rake |

**Worked examples** (all generated in [`profitability.md`](./profitability.md)):

| Participant | Content | Distribution | Total share |
|---|---|---|---|
| Club with 100 players, 18k hands | 6.33% | 15% | **21.33% of GGR** |
| Same club with 1,000 players, 36k hands | 7.50% | 20% | **27.50%** |
| Betting company at €77.8M turnover | — | blended 33.33% | **33.33% of GGR** |
| Its 10 provider clubs, 14.4k hands each | 5.92% | — | **5.92%** |
| Betting company creating 600 pools a month | — | — | **40% of rake** |

## 4. Contracts and overrides

- A policy can be overridden per partner by contract, for example a guaranteed minimum for a flagship club. The guardrail still applies.
- Shares are recalculated each period from the metrics and are never edited by hand. Each statement records the policy version used.
- Statement API: `GET /v1/partners/me/statements?period=YYYY-MM` returns metrics, tier reached, rate, revenue base and amount per party.
