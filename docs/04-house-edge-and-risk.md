# 04 — House Edge, Odds Book and Risk

This document explains why **the house always has the edge** on bets against PreFlop, and what can break that guarantee. Every number here is produced and tested by `packages/odds-engine`.

## 1. Exact probabilities

A flop is 3 cards from a 52-card deck, so there are **C(52,3) = 22,100** possible flops. With a fair shuffle they are all equally likely. The engine evaluates every selection on all 22,100 of them, so each probability is an exact fraction (`wins / 22100`) with no simulation error. The tests check these counts against hand-derived combinatorics, for example:

| Selection | Formula | Flops | p |
|---|---|---|---|
| Exactly one pair | 13 · C(4,2) · 48 | 3,744 | 16.94% |
| Trips | 13 · C(4,3) | 52 | 0.235% |
| Rainbow | C(4,3) · 13³ | 8,788 | 39.77% |
| Monotone | 4 · C(13,3) | 1,144 | 5.18% |
| All red | C(26,3) | 2,600 | 11.76% |
| Straight (A-2-3 … Q-K-A) | 12 · 4³ | 768 | 3.48% |
| Straight flush | 12 · 4 | 48 | 0.217% |
| All face cards | C(12,3) | 220 | 1.00% |

## 2. Pricing: how the edge is built in

```
fair odds      = 1 / p
margin m       = max( tier floor(p) , required net-EV margin for the channel )      ← docs/07
offered odds   = floorToTick( (1 − m) / p )
player return  = p · odds ≤ 1 − m      (exact integer check in tests, for every selection and channel)
house edge     = 1 − p · odds ≥ m
```

- **Tier floors** set the minimum gross margin for each probability band. Rare outcomes carry more variance and a bigger reward for cheating, so they pay more margin:

  | Band | Floor |
  |---|---|
  | p ≥ 25% | 5% |
  | 10–25% | 6% |
  | 3–10% | 8% |
  | 1–3% | 10% |
  | 0.3–1% | 12% |
  | < 0.3% | 15% |

- **Net-EV floor.** The margin is raised further until PreFlop keeps its **net** target after revenue shares, promotions and variable costs (`docs/07`). This is why the club channel (Model A) has slightly shorter odds than the direct app.
- **Rounding** always goes *down*, both onto the odds ladder and in payouts, which are floored to the minor unit. So rounding can only add to the edge.
- **Caps:** selections with fair odds above 1000 are not offered, and no odds are offered below 1.05.

Every **exhaustive** market, such as rainbow / two-tone / monotone, has an overround above 100%. Backing every side of a market loses about 6%.

Example prices (direct channel; the full list is in [`odds-book.md`](./odds-book.md)):

| Selection | Fair | Odds | House edge |
|---|---|---|---|
| Rainbow | 2.51 | **2.38** | 5.4% |
| Two-tone | 1.82 | **1.72** | 5.3% |
| Monotone | 19.32 | **17.50** | 9.4% |
| Exactly one pair | 5.90 | **5.50** | 6.8% |
| Trips | 425 | **361** | 15.1% |
| All red | 8.50 | **7.80** | 8.2% |
| Over 24 / Under 24 | 2.13 | **2.00** each | 5.9% |
| All below 8 | 10.92 | **10.00** | 8.4% |
| Straight | 28.78 | **26.25** | 8.8% |
| All face cards | 100 | **85** | 15.4% |

## 3. Why there is no "line moving"

Sportsbooks move their odds because the true probability is unknown. Here it is known exactly, so odds are **fixed per book version** and risk is managed through limits:

1. **Exact round exposure** (`RoundExposure`). For each round the engine keeps the house's net result for every one of the 22,100 flops. A new bet is accepted only if the *worst possible flop* still keeps the round's loss within its limit. Correlated bets, such as "pair", "pair of kings" and "all red" on the same flop, are handled exactly. The tests check this against a brute-force calculation.
2. **Maximum payout per bet and per user per round**, which matters most on long shots such as trips at 361.
3. **Bankroll sizing.** Set the round loss limit to a small fraction of the risk bankroll; 0.5–1% is suggested. The edge is positive on every bet, so over many rounds the law of large numbers works for the house. The limits are what keep a single unlucky round survivable.
4. **Hedging internally.** Opposite sides of a market offset each other in the exposure vector, so balanced action leaves room for more bets automatically.

## 4. What breaks the edge: information, not math

The margin protects the house only if **no bettor knows anything about the cards**. The engine's `probabilityGivenKnown()` measures how much a known card shifts the odds:

| Market | Fair p | Leak from one player's own 2 hole cards | Gross margin charged |
|---|---|---|---|
| All red / all one suit / all below 8 / all face | 11.8% / 1.3% / 9.2% / 1.0% | **+12.8%** | 6–10% |
| Over 24 (holding 2♠ 2♥) | 47.1% | **+9.2%** | 5.2% |
| Trips | 0.24% | +4.1% | 15% |

If 8 players at the table pool their 16 hole cards, the shift reaches **up to ×3.1** on suit and colour markets.

A single player at the table **beats a 5–10% margin**. Hence these rules:

1. **Betting on flop N+1 closes when the dealer starts hand N+1, before any hole card exists, and before PreFlop issues that hand's random cut** (`docs/01` §4). This is the most important rule in the product.
2. **Table players, dealers and club staff may not bet** at their own club. This is enforced at KYC (by employer and venue) and through device and location linking.
3. **No hole-card cameras** on the stream before the round is settled. The stream shows only public information.
4. **Dealer integrity:** an automatic shuffler is **mandatory**, the dealer **cuts before every hand**, a burn card is dealt before the flop, dealers rotate, and any card exposed before the lock voids the round (`docs/03` §3, `docs/11`).

## 5. Integrity monitoring

| Signal | Check | Action |
|---|---|---|
| Deck randomness per table | Chi-square on suit and rank frequencies, and on flop-pattern frequencies against the exact probabilities, over rolling windows | Alert, then pause the table |
| Rare-market winners | A user or cluster winning long shots (trips, straight flush, exact card) beyond binomial expectation | Hold payouts for review |
| Timing | Bets clustered in the last seconds before the lock, especially from accounts linked to the club | Lower that account's limits, then investigate |
| Linked accounts | Shared devices, IPs, payment instruments or locations near the club | Merge limits; possibly exclude |

## 6. Bets between players

Pools, heads-up, challenges and tournaments put **no house capital at risk**. PreFlop earns the fee whatever the outcome (P = B − F), so their edge is the fee rate, sized in `docs/07` to cover costs.
