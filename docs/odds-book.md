# PreFlop Odds Book

> **Generated file — do not edit by hand.** Run `pnpm book` after changing markets or
> `packages/odds-engine/src/costModel.ts`. Cost figures are planning placeholders, not agreed terms.

Every probability is exact: each selection is evaluated on all **22,100** equally likely flops (C(52,3)).
Odds are decimal (stake included). See `docs/04-house-edge-and-risk.md` and `docs/07-unit-economics.md` for the method.

## How a price is set

```
margin m   = max( tier floor for p ,  (net target + c_t) / (1 − s − b) )
odds       = floorToTick( (1 − m) / p )          → player EV ≤ 1 − m, always
gross edge = 1 − p · odds                         (house GGR per unit staked)
net EV     = gross edge · (1 − s − b) − c_t       (what PreFlop keeps per unit staked)
```

s = revenue shares, b = promotions (fractions of GGR); c_t = variable costs per unit staked. Net EV target: **2.50%** of turnover.
Selections with fair odds above 1000 are not offered.

### Margin tier floors

| Probability band | Minimum gross margin |
|---|---|
| Common (p ≥ 25%) | 5% |
| Frequent (10–25%) | 6% |
| Medium (3–10%) | 8% |
| Long (1–3%) | 10% |
| Rare (0.3–1%) | 12% |
| Very rare (< 0.3%) | 15% |

### Channels (distribution models)

| Channel | Plan model | Bet type | Paid away (s + b) | Variable cost c_t | Required gross margin / fee |
|---|---|---|---|---|---|
| PreFlop app (direct players) (`direct`) | Direct — PreFlop + provider club | Fixed odds vs house | 30.0% | 1.13% | **5.18%** |
| Club's own players (`club`) | Model A — club is provider and distributor | Fixed odds vs house | 55.0% | 1.13% | **8.06%** |
| Third-party betting platform (`partner`) | Model B — partner distributes, PreFlop is the house | Fixed odds vs house | 50.0% | 0.30% | **5.60%** |
| User-organized tournament / challenge (`contest-user`) | Model C — organizer gets the largest single share | Contest / pool fee | 65.0% | 3.00% | **15.71%** |
| Club-organized event (`contest-club`) | Model D — club is organizer and provider (shares combined) | Contest / pool fee | 50.0% | 3.00% | **11.00%** |

For contest channels the last column is the **minimum fee rate on buy-ins** that keeps PreFlop at the net target.

### Break-even (placeholders)

Fixed costs €85,000/month − subscriptions €15,000/month (10 clubs × €1,500)
→ break-even turnover at the 2.50% net target: **€2,800,000 staked per month**.

## Headline markets (first release)

| Selection | Wins / 22,100 | Probability | Fair odds | Direct odds | Club (A) odds | Partner (B) odds | Direct net EV |
|---|---|---|---|---|---|---|---|
| Three different ranks | 18,304 | 82.82% | 1.21 | **1.14** | 1.11 | 1.13 | 2.78% |
| Exactly one pair | 3,744 | 16.94% | 5.90 | **5.50** | 5.40 | 5.50 | 3.65% |
| Three of a kind | 52 | 0.24% | 425 | **361.00** | 361.00 | 361.00 | 9.42% |
| High card: no pair, flush or straight | 16,440 | 74.39% | 1.34 | **1.27** | 1.23 | 1.26 | 2.74% |
| Pair: two of a kind | 3,744 | 16.94% | 5.90 | **5.50** | 5.40 | 5.50 | 3.65% |
| Flush: three of the same suit, not in sequence | 1,096 | 4.96% | 20.16 | **18.50** | 18.50 | 18.50 | 4.65% |
| Straight: three in sequence, not all one suit | 720 | 3.26% | 30.69 | **28.00** | 28.00 | 28.00 | 5.02% |
| Three of a kind | 52 | 0.24% | 425 | **361.00** | 361.00 | 361.00 | 9.42% |
| Straight flush | 48 | 0.22% | 460 | **391.00** | 391.00 | 391.00 | 9.43% |
| Rainbow (three suits) | 8,788 | 39.76% | 2.51 | **2.38** | 2.31 | 2.37 | 2.63% |
| Two-tone (exactly two suits) | 12,168 | 55.06% | 1.82 | **1.72** | 1.66 | 1.71 | 2.58% |
| Monotone (one suit) | 1,144 | 5.18% | 19.32 | **17.70** | 17.70 | 17.70 | 4.74% |
| All red | 2,600 | 11.76% | 8.50 | **7.95** | 7.80 | 7.95 | 3.40% |
| All black | 2,600 | 11.76% | 8.50 | **7.95** | 7.80 | 7.95 | 3.40% |
| Mixed colours | 16,900 | 76.47% | 1.31 | **1.23** | 1.20 | 1.23 | 3.03% |
| All below 6 | 560 | 2.53% | 39.46 | **35.50** | 35.50 | 35.50 | 5.91% |
| All below 7 | 1,140 | 5.16% | 19.39 | **17.80** | 17.80 | 17.80 | 4.60% |
| All below 8 | 2,024 | 9.16% | 10.92 | **10.00** | 10.00 | 10.00 | 4.77% |
| All below 9 | 3,276 | 14.82% | 6.75 | **6.30** | 6.20 | 6.30 | 3.50% |
| All below T | 4,960 | 22.44% | 4.46 | **4.18** | 4.09 | 4.18 | 3.21% |
| All below J | 7,140 | 32.31% | 3.10 | **2.93** | 2.84 | 2.92 | 2.61% |
| Exactly 0 face cards | 9,880 | 44.71% | 2.24 | **2.12** | 2.05 | 2.11 | 2.53% |
| Exactly 1 face card | 9,360 | 42.35% | 2.36 | **2.23** | 2.17 | 2.22 | 2.76% |
| Exactly 2 face cards | 2,640 | 11.95% | 8.37 | **7.85** | 7.65 | 7.85 | 3.23% |
| All face cards (3) | 220 | 1.00% | 100 | **88.00** | 88.00 | 88.00 | 7.55% |
| Over 24 (25+) | 10,400 | 47.06% | 2.13 | **2.01** | 1.95 | 2.00 | 2.66% |
| Under 24 (23-) | 10,400 | 47.06% | 2.13 | **2.01** | 1.95 | 2.00 | 2.66% |
| Exactly 24 | 1,300 | 5.88% | 17.00 | **15.60** | 15.60 | 15.60 | 4.64% |

## Full catalogue — direct channel

Columns: gross margin applied, decimal odds, the house's gross edge at those odds, and PreFlop's net EV after costs. Club (A) and partner (B) odds are in `docs/odds-book.json`.

### A. Rank patterns

#### Rank pattern — `rank-pattern`

How many distinct ranks the flop has. _Catalogue items: 1, 2, 3._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Three different ranks | 18304 | 82.824% | 1.21 | 5.18% | **1.14** | 5.58% | 2.78% |
| Exactly one pair | 3744 | 16.941% | 5.90 | 6.00% | **5.50** | 6.82% | 3.65% |
| Three of a kind | 52 | 0.235% | 425 | 15.00% | **361.00** | 15.06% | 9.42% |

Book overround (Σ 1/odds): **106.18%**

#### Flop hand — `hand-class`

The best three-card poker hand the flop makes (the app's main prediction grid). Every flop is exactly one of these. _Catalogue items: 1, 2, 3, 31, 32._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| High card: no pair, flush or straight | 16440 | 74.389% | 1.34 | 5.18% | **1.27** | 5.53% | 2.74% |
| Pair: two of a kind | 3744 | 16.941% | 5.90 | 6.00% | **5.50** | 6.82% | 3.65% |
| Flush: three of the same suit, not in sequence | 1096 | 4.959% | 20.16 | 8.00% | **18.50** | 8.25% | 4.65% |
| Straight: three in sequence, not all one suit | 720 | 3.258% | 30.69 | 8.00% | **28.00** | 8.78% | 5.02% |
| Three of a kind | 52 | 0.235% | 425 | 15.00% | **361.00** | 15.06% | 9.42% |
| Straight flush | 48 | 0.217% | 460 | 15.00% | **391.00** | 15.08% | 9.43% |

Book overround (Σ 1/odds): **106.43%**

#### Paired board — `paired-board`

Whether any rank appears at least twice (a pair or trips). _Catalogue items: 1, 2._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Board is paired (pair or trips) | 3796 | 17.176% | 5.82 | 6.00% | **5.45** | 6.39% | 3.35% |
| Board is unpaired | 18304 | 82.824% | 1.21 | 5.18% | **1.14** | 5.58% | 2.78% |

Book overround (Σ 1/odds): **106.07%**

#### Pair of a named rank — `pair-of-rank`

Exactly two cards of the chosen rank (trips do not count). _Catalogue items: 4._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Pair of 2s | 288 | 1.303% | 76.74 | 10.00% | **69.00** | 10.08% | 5.93% |
| Pair of 3s | 288 | 1.303% | 76.74 | 10.00% | **69.00** | 10.08% | 5.93% |
| Pair of 4s | 288 | 1.303% | 76.74 | 10.00% | **69.00** | 10.08% | 5.93% |
| Pair of 5s | 288 | 1.303% | 76.74 | 10.00% | **69.00** | 10.08% | 5.93% |
| Pair of 6s | 288 | 1.303% | 76.74 | 10.00% | **69.00** | 10.08% | 5.93% |
| Pair of 7s | 288 | 1.303% | 76.74 | 10.00% | **69.00** | 10.08% | 5.93% |
| Pair of 8s | 288 | 1.303% | 76.74 | 10.00% | **69.00** | 10.08% | 5.93% |
| Pair of 9s | 288 | 1.303% | 76.74 | 10.00% | **69.00** | 10.08% | 5.93% |
| Pair of Ts | 288 | 1.303% | 76.74 | 10.00% | **69.00** | 10.08% | 5.93% |
| Pair of Js | 288 | 1.303% | 76.74 | 10.00% | **69.00** | 10.08% | 5.93% |
| Pair of Qs | 288 | 1.303% | 76.74 | 10.00% | **69.00** | 10.08% | 5.93% |
| Pair of Ks | 288 | 1.303% | 76.74 | 10.00% | **69.00** | 10.08% | 5.93% |
| Pair of As | 288 | 1.303% | 76.74 | 10.00% | **69.00** | 10.08% | 5.93% |

#### Paired rank low / high — `pair-height`

Exactly one pair, with the paired rank in the chosen band. _Catalogue items: 5._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Pair of 2s to 7s | 1728 | 7.819% | 12.79 | 8.00% | **11.70** | 8.52% | 4.84% |
| Pair of 8s to 10s | 864 | 3.910% | 25.58 | 8.00% | **23.50** | 8.13% | 4.56% |
| Pair of Js to As | 1152 | 5.213% | 19.18 | 8.00% | **17.60** | 8.26% | 4.65% |

#### Pair with a face-card kicker — `pair-face-kicker`

Exactly one pair and the unpaired card is J, Q or K. _Catalogue items: 6._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Pair + face kicker | 864 | 3.910% | 25.58 | 8.00% | **23.50** | 8.13% | 4.56% |

### B. Suits and colours

#### Suit pattern — `suit-pattern`

Number of distinct suits on the flop. _Catalogue items: 7, 8, 9._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Rainbow (three suits) | 8788 | 39.765% | 2.51 | 5.18% | **2.38** | 5.36% | 2.63% |
| Two-tone (exactly two suits) | 12168 | 55.059% | 1.82 | 5.18% | **1.72** | 5.30% | 2.58% |
| Monotone (one suit) | 1144 | 5.176% | 19.32 | 8.00% | **17.70** | 8.38% | 4.74% |

Book overround (Σ 1/odds): **105.81%**

#### All one named suit — `monotone-suit`

All three cards are of the chosen suit. _Catalogue items: 10._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| All spades | 286 | 1.294% | 77.27 | 10.00% | **69.50** | 10.06% | 5.92% |
| All hearts | 286 | 1.294% | 77.27 | 10.00% | **69.50** | 10.06% | 5.92% |
| All diamonds | 286 | 1.294% | 77.27 | 10.00% | **69.50** | 10.06% | 5.92% |
| All clubs | 286 | 1.294% | 77.27 | 10.00% | **69.50** | 10.06% | 5.92% |

#### Card colour — `colour`

Red = hearts and diamonds, black = spades and clubs. _Catalogue items: 11._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| All red | 2600 | 11.765% | 8.50 | 6.00% | **7.95** | 6.47% | 3.40% |
| All black | 2600 | 11.765% | 8.50 | 6.00% | **7.95** | 6.47% | 3.40% |
| Mixed colours | 16900 | 76.471% | 1.31 | 5.18% | **1.23** | 5.94% | 3.03% |

Book overround (Σ 1/odds): **106.46%**

#### Number of red cards — `red-count`

Exactly N red cards (hearts or diamonds). _Catalogue items: 12._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Exactly 0 red | 2600 | 11.765% | 8.50 | 6.00% | **7.95** | 6.47% | 3.40% |
| Exactly 1 red | 8450 | 38.235% | 2.62 | 5.18% | **2.47** | 5.56% | 2.77% |
| Exactly 2 red | 8450 | 38.235% | 2.62 | 5.18% | **2.47** | 5.56% | 2.77% |
| Exactly 3 red | 2600 | 11.765% | 8.50 | 6.00% | **7.95** | 6.47% | 3.40% |

Book overround (Σ 1/odds): **106.13%**

#### Number of spades — `suit-count-s`

Exactly N spades on the flop. _Catalogue items: 13._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Exactly 0 spades | 9139 | 41.353% | 2.42 | 5.18% | **2.29** | 5.30% | 2.59% |
| Exactly 1 spade | 9633 | 43.588% | 2.29 | 5.18% | **2.17** | 5.41% | 2.66% |
| Exactly 2 spades | 3042 | 13.765% | 7.26 | 6.00% | **6.80** | 6.40% | 3.35% |
| Exactly 3 spades | 286 | 1.294% | 77.27 | 10.00% | **69.50** | 10.06% | 5.92% |

Book overround (Σ 1/odds): **105.90%**

#### Number of hearts — `suit-count-h`

Exactly N hearts on the flop. _Catalogue items: 13._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Exactly 0 hearts | 9139 | 41.353% | 2.42 | 5.18% | **2.29** | 5.30% | 2.59% |
| Exactly 1 heart | 9633 | 43.588% | 2.29 | 5.18% | **2.17** | 5.41% | 2.66% |
| Exactly 2 hearts | 3042 | 13.765% | 7.26 | 6.00% | **6.80** | 6.40% | 3.35% |
| Exactly 3 hearts | 286 | 1.294% | 77.27 | 10.00% | **69.50** | 10.06% | 5.92% |

Book overround (Σ 1/odds): **105.90%**

#### Number of diamonds — `suit-count-d`

Exactly N diamonds on the flop. _Catalogue items: 13._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Exactly 0 diamonds | 9139 | 41.353% | 2.42 | 5.18% | **2.29** | 5.30% | 2.59% |
| Exactly 1 diamond | 9633 | 43.588% | 2.29 | 5.18% | **2.17** | 5.41% | 2.66% |
| Exactly 2 diamonds | 3042 | 13.765% | 7.26 | 6.00% | **6.80** | 6.40% | 3.35% |
| Exactly 3 diamonds | 286 | 1.294% | 77.27 | 10.00% | **69.50** | 10.06% | 5.92% |

Book overround (Σ 1/odds): **105.90%**

#### Number of clubs — `suit-count-c`

Exactly N clubs on the flop. _Catalogue items: 13._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Exactly 0 clubs | 9139 | 41.353% | 2.42 | 5.18% | **2.29** | 5.30% | 2.59% |
| Exactly 1 club | 9633 | 43.588% | 2.29 | 5.18% | **2.17** | 5.41% | 2.66% |
| Exactly 2 clubs | 3042 | 13.765% | 7.26 | 6.00% | **6.80** | 6.40% | 3.35% |
| Exactly 3 clubs | 286 | 1.294% | 77.27 | 10.00% | **69.50** | 10.06% | 5.92% |

Book overround (Σ 1/odds): **105.90%**

### C. High / low and rank ranges

#### All cards below X — `all-below`

Every card is strictly below the chosen rank (ace is high). _Catalogue items: 14._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| All below 6 | 560 | 2.534% | 39.46 | 10.00% | **35.50** | 10.05% | 5.91% |
| All below 7 | 1140 | 5.158% | 19.39 | 8.00% | **17.80** | 8.18% | 4.60% |
| All below 8 | 2024 | 9.158% | 10.92 | 8.00% | **10.00** | 8.42% | 4.77% |
| All below 9 | 3276 | 14.824% | 6.75 | 6.00% | **6.30** | 6.61% | 3.50% |
| All below T | 4960 | 22.443% | 4.46 | 6.00% | **4.18** | 6.19% | 3.21% |
| All below J | 7140 | 32.308% | 3.10 | 5.18% | **2.93** | 5.34% | 2.61% |

#### All cards above X — `all-above`

Every card is strictly above the chosen rank (ace is high). _Catalogue items: 15._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| All above 7 | 3276 | 14.824% | 6.75 | 6.00% | **6.30** | 6.61% | 3.50% |
| All above 8 | 2024 | 9.158% | 10.92 | 8.00% | **10.00** | 8.42% | 4.77% |
| All above 9 | 1140 | 5.158% | 19.39 | 8.00% | **17.80** | 8.18% | 4.60% |
| All above T | 560 | 2.534% | 39.46 | 10.00% | **35.50** | 10.05% | 5.91% |

#### All cards in a range — `all-in-range`

Every card is within the inclusive rank interval. _Catalogue items: 16._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| All between 5 and 9 | 1140 | 5.158% | 19.39 | 8.00% | **17.80** | 8.18% | 4.60% |
| All between 6 and T | 1140 | 5.158% | 19.39 | 8.00% | **17.80** | 8.18% | 4.60% |
| All between 7 and J | 1140 | 5.158% | 19.39 | 8.00% | **17.80** | 8.18% | 4.60% |
| All between 8 and Q | 1140 | 5.158% | 19.39 | 8.00% | **17.80** | 8.18% | 4.60% |

#### At least one card above / below X — `any-above`

At least one card strictly above (or below) the chosen rank. _Catalogue items: 17._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| At least one above J (Q, K or A) | 12220 | 55.294% | 1.81 | 5.18% | **1.71** | 5.45% | 2.69% |
| At least one below 5 (2, 3 or 4) | 12220 | 55.294% | 1.81 | 5.18% | **1.71** | 5.45% | 2.69% |

#### Number of high cards (J or higher) — `high-count`

Exactly N cards ranked J, Q, K or A. _Catalogue items: 18._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Exactly 0 J-or-higher | 7140 | 32.308% | 3.10 | 5.18% | **2.93** | 5.34% | 2.61% |
| Exactly 1 J-or-higher | 10080 | 45.611% | 2.19 | 5.18% | **2.07** | 5.59% | 2.78% |
| Exactly 2 J-or-higher | 4320 | 19.548% | 5.12 | 6.00% | **4.80** | 6.17% | 3.20% |
| Exactly 3 J-or-higher | 560 | 2.534% | 39.46 | 10.00% | **35.50** | 10.05% | 5.91% |

Book overround (Σ 1/odds): **106.09%**

#### Highest card — `highest-card`

The rank of the highest card on the flop (ace is high). _Catalogue items: 19._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| 8 or lower | 3276 | 14.824% | 6.75 | 6.00% | **6.30** | 6.61% | 3.50% |
| 9 high | 1684 | 7.620% | 13.12 | 8.00% | **12.00** | 8.56% | 4.87% |
| T high | 2180 | 9.864% | 10.14 | 8.00% | **9.30** | 8.26% | 4.66% |
| J high | 2740 | 12.398% | 8.07 | 6.00% | **7.55** | 6.39% | 3.35% |
| Q high | 3364 | 15.222% | 6.57 | 6.00% | **6.15** | 6.39% | 3.35% |
| K high | 4052 | 18.335% | 5.45 | 6.00% | **5.10** | 6.49% | 3.42% |
| A high | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |

Book overround (Σ 1/odds): **107.22%**

#### Lowest card — `lowest-card`

The rank of the lowest card on the flop (ace is high). _Catalogue items: 20._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Lowest card 2 | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |
| Lowest card 3 | 4052 | 18.335% | 5.45 | 6.00% | **5.10** | 6.49% | 3.42% |
| Lowest card 4 | 3364 | 15.222% | 6.57 | 6.00% | **6.15** | 6.39% | 3.35% |
| Lowest card 5 | 2740 | 12.398% | 8.07 | 6.00% | **7.55** | 6.39% | 3.35% |
| Lowest card 6 | 2180 | 9.864% | 10.14 | 8.00% | **9.30** | 8.26% | 4.66% |
| Lowest card 7 or higher | 4960 | 22.443% | 4.46 | 6.00% | **4.18** | 6.19% | 3.21% |

Book overround (Σ 1/odds): **106.94%**

### D. Face cards and named ranks

#### Number of face cards — `face-count`

Exactly N face cards (J, Q, K). Three = "all images". _Catalogue items: 21, 22, 23._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Exactly 0 face cards | 9880 | 44.706% | 2.24 | 5.18% | **2.12** | 5.22% | 2.53% |
| Exactly 1 face card | 9360 | 42.353% | 2.36 | 5.18% | **2.23** | 5.55% | 2.76% |
| Exactly 2 face cards | 2640 | 11.946% | 8.37 | 6.00% | **7.85** | 6.23% | 3.23% |
| All face cards (3) | 220 | 0.995% | 100 | 12.00% | **88.00** | 12.40% | 7.55% |

Book overround (Σ 1/odds): **105.89%**

#### Number of aces — `ace-count`

Exactly N aces on the flop. _Catalogue items: 24, 25, 26._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Exactly 0 aces | 17296 | 78.262% | 1.28 | 5.18% | **1.21** | 5.30% | 2.59% |
| Exactly 1 ace | 4512 | 20.416% | 4.90 | 6.00% | **4.60** | 6.09% | 3.13% |
| Exactly 2 aces | 288 | 1.303% | 76.74 | 10.00% | **69.00** | 10.08% | 5.93% |
| Exactly 3 aces | 4 | 0.018% | 5525 | — | not offered | — | fair odds 5525 above cap 1000 |

#### Any ace — `any-ace`

At least one ace / no ace. _Catalogue items: 24, 25._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| At least one ace | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |
| No ace | 17296 | 78.262% | 1.28 | 5.18% | **1.21** | 5.30% | 2.59% |

Book overround (Σ 1/odds): **105.79%**

#### Contains a named rank — `contains-rank`

At least one card of the chosen rank. _Catalogue items: 27._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Contains a 2 | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |
| Contains a 3 | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |
| Contains a 4 | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |
| Contains a 5 | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |
| Contains a 6 | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |
| Contains a 7 | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |
| Contains a 8 | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |
| Contains a 9 | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |
| Contains a T | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |
| Contains a J | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |
| Contains a Q | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |
| Contains a K | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |
| Contains a A | 4804 | 21.738% | 4.60 | 6.00% | **4.32** | 6.09% | 3.14% |

#### Contains an exact card — `contains-card`

The chosen card is one of the three flop cards. _Catalogue items: 28._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Contains 2s | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 2h | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 2d | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 2c | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 3s | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 3h | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 3d | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 3c | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 4s | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 4h | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 4d | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 4c | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 5s | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 5h | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 5d | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 5c | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 6s | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 6h | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 6d | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 6c | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 7s | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 7h | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 7d | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 7c | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 8s | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 8h | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 8d | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 8c | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 9s | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 9h | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 9d | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains 9c | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Ts | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Th | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Td | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Tc | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Js | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Jh | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Jd | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Jc | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Qs | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Qh | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Qd | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Qc | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Ks | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Kh | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Kd | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Kc | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains As | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Ah | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Ad | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |
| Contains Ac | 1275 | 5.769% | 17.33 | 8.00% | **15.90** | 8.27% | 4.66% |

#### All Broadway — `broadway`

Every card is 10, J, Q, K or A. _Catalogue items: 29._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| All Broadway | 1140 | 5.158% | 19.39 | 8.00% | **17.80** | 8.18% | 4.60% |

#### Ace and King — `ace-king`

The flop contains at least one ace and at least one king. _Catalogue items: 30._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Contains A and K | 752 | 3.403% | 29.39 | 8.00% | **27.00** | 8.13% | 4.56% |

### E. Sequences and gaps

#### Three-card straight — `straight`

Three consecutive distinct ranks. A-2-3 and Q-K-A count; K-A-2 does not. _Catalogue items: 31._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Straight | 768 | 3.475% | 28.78 | 8.00% | **26.25** | 8.78% | 5.02% |

#### Three-card straight flush — `straight-flush`

Three consecutive ranks, all of the same suit. _Catalogue items: 32._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Straight flush | 48 | 0.217% | 460 | 15.00% | **391.00** | 15.08% | 9.43% |

#### Connected ranks — `connected`

Whether any two cards are adjacent in rank (A is adjacent to K and 2). _Catalogue items: 33, 34._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| At least two adjacent ranks | 8944 | 40.471% | 2.47 | 5.18% | **2.34** | 5.30% | 2.58% |
| No adjacent ranks | 13156 | 59.529% | 1.68 | 5.18% | **1.59** | 5.35% | 2.62% |

Book overround (Σ 1/odds): **105.63%**

#### One-gap sequence — `one-gapper`

Three distinct ranks spanning four ranks with one gap, e.g. 5-6-8 or 5-7-8 (ace high only). _Catalogue items: 35._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| One-gap run | 1280 | 5.792% | 17.27 | 8.00% | **15.80** | 8.49% | 4.82% |

#### Exact straight — `exact-straight`

The flop ranks are exactly the chosen consecutive set, any suits. _Catalogue items: 36._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Exactly A-2-3 | 64 | 0.290% | 345 | 15.00% | **293.00** | 15.15% | 9.48% |
| Exactly 2-3-4 | 64 | 0.290% | 345 | 15.00% | **293.00** | 15.15% | 9.48% |
| Exactly 3-4-5 | 64 | 0.290% | 345 | 15.00% | **293.00** | 15.15% | 9.48% |
| Exactly 4-5-6 | 64 | 0.290% | 345 | 15.00% | **293.00** | 15.15% | 9.48% |
| Exactly 5-6-7 | 64 | 0.290% | 345 | 15.00% | **293.00** | 15.15% | 9.48% |
| Exactly 6-7-8 | 64 | 0.290% | 345 | 15.00% | **293.00** | 15.15% | 9.48% |
| Exactly 7-8-9 | 64 | 0.290% | 345 | 15.00% | **293.00** | 15.15% | 9.48% |
| Exactly 8-9-T | 64 | 0.290% | 345 | 15.00% | **293.00** | 15.15% | 9.48% |
| Exactly 9-T-J | 64 | 0.290% | 345 | 15.00% | **293.00** | 15.15% | 9.48% |
| Exactly T-J-Q | 64 | 0.290% | 345 | 15.00% | **293.00** | 15.15% | 9.48% |
| Exactly J-Q-K | 64 | 0.290% | 345 | 15.00% | **293.00** | 15.15% | 9.48% |
| Exactly Q-K-A | 64 | 0.290% | 345 | 15.00% | **293.00** | 15.15% | 9.48% |

#### Rank spread (highest minus lowest) — `span`

Highest rank minus lowest rank, ace high (0 = trips, maximum 12). _Catalogue items: 37._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Spread 0 to 4 | 5780 | 26.154% | 3.82 | 5.18% | **3.62** | 5.32% | 2.60% |
| Spread 5 to 8 | 10080 | 45.611% | 2.19 | 5.18% | **2.07** | 5.59% | 2.78% |
| Spread 9 to 12 | 6240 | 28.235% | 3.54 | 5.18% | **3.35** | 5.41% | 2.66% |

Book overround (Σ 1/odds): **105.78%**

### F. Totals and parity

#### Total over / under (24 loses both) — `sum-24`

Rank total over 24 or under 24. A total of exactly 24 (5.9%) loses both sides; it can be backed separately. _Catalogue items: 38._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Over 24 (25+) | 10400 | 47.059% | 2.13 | 5.18% | **2.01** | 5.41% | 2.66% |
| Under 24 (23-) | 10400 | 47.059% | 2.13 | 5.18% | **2.01** | 5.41% | 2.66% |
| Exactly 24 | 1300 | 5.882% | 17.00 | 8.00% | **15.60** | 8.24% | 4.64% |

Book overround (Σ 1/odds): **105.91%**

#### Total over / under 20.5 — `sum-20.5`

Rank total line 20.5. _Catalogue items: 38._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Over 20.5 | 15464 | 69.973% | 1.43 | 5.18% | **1.35** | 5.54% | 2.75% |
| Under 20.5 | 6636 | 30.027% | 3.33 | 5.18% | **3.15** | 5.41% | 2.67% |

Book overround (Σ 1/odds): **105.82%**

#### Total over / under 28.5 — `sum-28.5`

Rank total line 28.5. _Catalogue items: 38._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Over 28.5 | 5508 | 24.923% | 4.01 | 6.00% | **3.77** | 6.04% | 3.10% |
| Under 28.5 | 16592 | 75.077% | 1.33 | 5.18% | **1.26** | 5.40% | 2.66% |

Book overround (Σ 1/odds): **105.89%**

#### Total band — `sum-band`

Rank total within the inclusive band. _Catalogue items: 39._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| 6 to 15 | 2112 | 9.557% | 10.46 | 8.00% | **9.60** | 8.26% | 4.65% |
| 16 to 20 | 4524 | 20.471% | 4.89 | 6.00% | **4.59** | 6.04% | 3.10% |
| 21 to 23 | 3764 | 17.032% | 5.87 | 6.00% | **5.50** | 6.33% | 3.30% |
| Exactly 24 | 1300 | 5.882% | 17.00 | 8.00% | **15.60** | 8.24% | 4.64% |
| 25 to 27 | 3764 | 17.032% | 5.87 | 6.00% | **5.50** | 6.33% | 3.30% |
| 28 to 32 | 4524 | 20.471% | 4.89 | 6.00% | **4.59** | 6.04% | 3.10% |
| 33 to 42 | 2112 | 9.557% | 10.46 | 8.00% | **9.60** | 8.26% | 4.65% |

Book overround (Σ 1/odds): **107.18%**

#### Exact total — `sum-exact`

Rank total equals the chosen number (6..42). Extreme totals are too rare to offer. _Catalogue items: 40._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Total 6 | 4 | 0.018% | 5525 | — | not offered | — | fair odds 5525 above cap 1000 |
| Total 7 | 24 | 0.109% | 921 | 15.00% | **782.00** | 15.08% | 9.43% |
| Total 8 | 48 | 0.217% | 460 | 15.00% | **391.00** | 15.08% | 9.43% |
| Total 9 | 92 | 0.416% | 240 | 12.00% | **211.00** | 12.16% | 7.39% |
| Total 10 | 136 | 0.615% | 163 | 12.00% | **143.00** | 12.00% | 7.27% |
| Total 11 | 200 | 0.905% | 111 | 12.00% | **97.00** | 12.22% | 7.43% |
| Total 12 | 268 | 1.213% | 82.46 | 10.00% | **74.00** | 10.26% | 6.06% |
| Total 13 | 352 | 1.593% | 62.78 | 10.00% | **56.50** | 10.01% | 5.88% |
| Total 14 | 440 | 1.991% | 50.23 | 10.00% | **45.00** | 10.41% | 6.16% |
| Total 15 | 548 | 2.480% | 40.33 | 10.00% | **36.25** | 10.11% | 5.95% |
| Total 16 | 656 | 2.968% | 33.69 | 10.00% | **30.25** | 10.21% | 6.02% |
| Total 17 | 784 | 3.548% | 28.19 | 8.00% | **25.75** | 8.65% | 4.93% |
| Total 18 | 916 | 4.145% | 24.13 | 8.00% | **22.00** | 8.81% | 5.05% |
| Total 19 | 1040 | 4.706% | 21.25 | 8.00% | **19.50** | 8.24% | 4.64% |
| Total 20 | 1128 | 5.104% | 19.59 | 8.00% | **18.00** | 8.13% | 4.56% |
| Total 21 | 1212 | 5.484% | 18.23 | 8.00% | **16.70** | 8.41% | 4.77% |
| Total 22 | 1256 | 5.683% | 17.60 | 8.00% | **16.10** | 8.50% | 4.82% |
| Total 23 | 1296 | 5.864% | 17.05 | 8.00% | **15.60** | 8.52% | 4.84% |
| Total 24 | 1300 | 5.882% | 17.00 | 8.00% | **15.60** | 8.24% | 4.64% |
| Total 25 | 1296 | 5.864% | 17.05 | 8.00% | **15.60** | 8.52% | 4.84% |
| Total 26 | 1256 | 5.683% | 17.60 | 8.00% | **16.10** | 8.50% | 4.82% |
| Total 27 | 1212 | 5.484% | 18.23 | 8.00% | **16.70** | 8.41% | 4.77% |
| Total 28 | 1128 | 5.104% | 19.59 | 8.00% | **18.00** | 8.13% | 4.56% |
| Total 29 | 1040 | 4.706% | 21.25 | 8.00% | **19.50** | 8.24% | 4.64% |
| Total 30 | 916 | 4.145% | 24.13 | 8.00% | **22.00** | 8.81% | 5.05% |
| Total 31 | 784 | 3.548% | 28.19 | 8.00% | **25.75** | 8.65% | 4.93% |
| Total 32 | 656 | 2.968% | 33.69 | 10.00% | **30.25** | 10.21% | 6.02% |
| Total 33 | 548 | 2.480% | 40.33 | 10.00% | **36.25** | 10.11% | 5.95% |
| Total 34 | 440 | 1.991% | 50.23 | 10.00% | **45.00** | 10.41% | 6.16% |
| Total 35 | 352 | 1.593% | 62.78 | 10.00% | **56.50** | 10.01% | 5.88% |
| Total 36 | 268 | 1.213% | 82.46 | 10.00% | **74.00** | 10.26% | 6.06% |
| Total 37 | 200 | 0.905% | 111 | 12.00% | **97.00** | 12.22% | 7.43% |
| Total 38 | 136 | 0.615% | 163 | 12.00% | **143.00** | 12.00% | 7.27% |
| Total 39 | 92 | 0.416% | 240 | 12.00% | **211.00** | 12.16% | 7.39% |
| Total 40 | 48 | 0.217% | 460 | 15.00% | **391.00** | 15.08% | 9.43% |
| Total 41 | 24 | 0.109% | 921 | 15.00% | **782.00** | 15.08% | 9.43% |
| Total 42 | 4 | 0.018% | 5525 | — | not offered | — | fair odds 5525 above cap 1000 |

#### Total odd / even — `sum-parity`

Parity of the rank total. _Catalogue items: 41, 42._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Odd total | 11096 | 50.208% | 1.99 | 5.18% | **1.88** | 5.61% | 2.80% |
| Even total | 11004 | 49.792% | 2.01 | 5.18% | **1.90** | 5.40% | 2.65% |

Book overround (Σ 1/odds): **105.82%**

#### Number of odd-ranked cards — `odd-count`

Exactly N cards with an odd rank value (3, 5, 7, 9, J=11, K=13). _Catalogue items: 43._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Exactly 0 odd | 3276 | 14.824% | 6.75 | 6.00% | **6.30** | 6.61% | 3.50% |
| Exactly 1 odd | 9072 | 41.050% | 2.44 | 5.18% | **2.30** | 5.59% | 2.78% |
| Exactly 2 odd | 7728 | 34.968% | 2.86 | 5.18% | **2.71** | 5.24% | 2.54% |
| Exactly 3 odd | 2024 | 9.158% | 10.92 | 8.00% | **10.00** | 8.42% | 4.77% |

Book overround (Σ 1/odds): **106.25%**

### G. Combined conditions

#### Combined conditions — `combo`

Both conditions must hold. Probabilities are counted jointly over all flops. _Catalogue items: 44, 45, 46._

| Selection | Wins | Probability | Fair | Margin | Odds | Gross edge | Net EV |
|---|---|---|---|---|---|---|---|
| Pair and all red | 312 | 1.412% | 70.83 | 10.00% | **63.50** | 10.35% | 6.12% |
| Rainbow and all below 9 | 1372 | 6.208% | 16.11 | 8.00% | **14.80** | 8.12% | 4.56% |
| Straight and rainbow | 288 | 1.303% | 76.74 | 10.00% | **69.00** | 10.08% | 5.93% |
| Monotone with a face card | 664 | 3.005% | 33.28 | 8.00% | **30.50** | 8.36% | 4.73% |
| Pair and at least one face card | 1584 | 7.167% | 13.95 | 8.00% | **12.80** | 8.26% | 4.65% |
