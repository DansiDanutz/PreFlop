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

**One unit for turnover tiers.** Turnover ladders are written in **EUR cents**. Before a turnover is compared with a threshold it is converted (`tierTurnoverEurCents()`): the minor units are scaled to whole cents with the currency's digits from `modes.ts` (EUR 2, USDT/USDC 6, chips 0), then multiplied by the currency's EUR value in `TIER_EUR_PER_MAJOR`. A partner's tier metric is its turnover in **all** currencies together. Only the tier metric is converted: every statement still pays in its own currency and minor units.

> **Policy assumption:** `STABLECOIN_EUR_RATE = 1`, i.e. 1 USDT = 1 USDC = €1 **for tier thresholds only**. It is a commercial simplification, not a market rate; change the constant in `sharing.ts` if the commercial team adopts another rule. Virtual chips count at their list price (100 chips = €1, `globalRules.ts`). Play money and diamonds have no EUR value for tiers and never lift a party above its first tier.

**Losing months:** if a party's base is negative, no share is paid and the loss is carried forward against its next period. This is industry standard and stops PreFlop paying shares on money it lost. The carry is kept per **(organization, currency, policy)**: a club's loss on partner traffic (provider policy) does not reduce its club-policy share on its own players, and EUR losses never net against USDT gains. The carry is not stored: every statement rebuilds it from the bets of all earlier months, oldest first (`carryForward()`), so a rerun gives the same result and a backdated correction (a late bet, a re-settled payout) flows into every later statement the next time it is computed. Each statement shows the loss carried in and, when there is one, the loss carried forward.

**Exact amounts:** all amounts are integers, rounded down; PreFlop receives the remainder.

## 2. Revenue buckets and the joint profit guardrail

PreFlop-house GGR is attributed to **revenue buckets**, one per currency, club whose tables dealt the hands, and acquiring partner (or none):

| Bucket | Who is paid, under which policy | PreFlop's costs on it (`costModel.ts`) |
|---|---|---|
| Direct traffic at club X's tables (`partner_id` empty) | Club X: **club policy** (content + distribution; distribution counts only these direct players) | `club` channel |
| Partner P's players at club X's tables | Club X: **provider policy** (content only, cap 12%)<br>Partner P: **partner policy** | `partner` channel (seamless wallet) |

Club and partner shares come out of the same GGR, so they are never capped separately. Buckets that share a claimant form one **pool** (a club links its direct and provider buckets; a partner links every club it sends players to). All entitlements in a pool are computed together (`computeJointStatement()`) and scaled down by one factor so that

```
Σ shares ≤ Σ_buckets [ GGR − b·max(GGR, 0) − c_t · turnover ] − T · Σ turnover
```

i.e. PreFlop's net after every share, promotions and variable costs stays at or above the floor T on the pool's whole turnover. For a single bucket this is the familiar `s_max = 1 − b − (T + c_t) / edge`. A losing bucket reduces its pool's budget, so overlap and adjustments are netted before anything is paid; a pool that misses the floor even at zero shares pays nothing and the PreFlop statement reports the shortfall. Unrelated pools do not cap each other.

Capped shares are flagged `capped by the joint profit guardrail` in the statement. The commercial team then decides between a higher margin for that channel and a lower tier. Tests prove the floor holds for the audit case (100bn turnover, 5bn GGR, 100k hands, 2k players: independent statements paid 2.8685bn and left PreFlop 1.8315bn against a 2.5bn floor; the joint statement pays at most 2.2bn), for a club with both kinds of traffic, for losing buckets, and on 400 random multi-club, multi-partner periods.

## 3. Placeholder policies

| Participant | Components | Floor / cap |
|---|---|---|
| **Club** (direct players at its tables) | **Content** by hands dealt (progressive): 5% → 8% @10k → 10% @30k → 12% @60k<br>**Distribution** by active players (whole-volume): 0% → 10% @25 → 15% @100 → 20% @500 → 25% @2,000 | 5% / 35% of GGR |
| **Provider club** (partner-acquired players at its tables) | Content only (as above) | 5% / 12% of GGR |
| **Betting company** | Distribution by monthly turnover, all currencies in EUR (progressive): 20% → 25% @€1M → 30% @€5M → 35% @€20M | 20% / 40% of GGR |
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
- Statement API: `GET /v1/org/:id/statements?period=YYYY-MM` (club, partner, organizer) and `GET /v1/admin/statements?period=YYYY-MM` (PreFlop team) return one statement per party and currency: per policy the bucket GGR and turnover, metric, tier reached, loss carried in, applied rate, base and amount, and the loss carried forward. Only share lines carry an amount, so the lines always add up to the total. The PreFlop statement shows GGR, the shares owed (each counted once), how many pools were capped and any shortfall below the floor.
- Code: `apps/api/src/lib/statements.ts` (buckets, metrics, carry) on top of `computeJointStatement()` in `packages/odds-engine/src/sharing.ts`.
- Known simplification: PreFlop does not yet record which club *acquired* a direct player, so all non-partner traffic at a club's tables counts as that club's direct traffic.
