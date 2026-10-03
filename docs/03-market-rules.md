# 03 — Market Rules

Status: **proposed** rulebook. Every rule here is implemented in `packages/odds-engine/src/markets.ts`. The same predicate prices a selection (by enumeration) and settles it, so the published rule and the settlement rule cannot drift apart.

## 1. Conventions (resolving plan §7 / §14 item 8)

| Topic | Rule |
|---|---|
| Flop | The first three community cards of the target hand, evaluated as an **unordered set**. Dealing order never matters |
| Rank values | 2–10 at face value, **J = 11, Q = 12, K = 13, A = 14**. Used for thresholds, totals, spread and parity |
| Ace in sequences | The ace plays **high or low**: Q-K-A and A-2-3 are both straights. There is no wrap-around, so K-A-2 is not a straight. Everywhere else the ace is 14 |
| "Colour" | Means **red/black**. Red = ♥ ♦, black = ♠ ♣. Markets about one suit are called "suit", never "colour" |
| Face cards ("images") | **J, Q, K** only. The ace is not a face card |
| Broadway | 10, J, Q, K, A |
| Below / above X | **Strictly** below or above. "All below 8" means every card is 2–7 |
| Ranges | Inclusive. "All between 6 and 10" means every card is 6, 7, 8, 9 or 10 |
| Pair | **Exactly** one pair. Trips are not a pair (there is a separate "paired board" market for pair-or-trips) |
| Totals | Sum of rank values (6–42, mean 24) |
| Odd-ranked | 3, 5, 7, 9, J(11), K(13) |
| Adjacent | Ranks that differ by 1. The ace is adjacent to both K and 2 |

## 2. Betting window

- **Opens:** when the flop of hand N has been captured.
- **Closes:** when the dealer presses *Start hand* for hand N+1. This comes **before any hole card is dealt** (see `docs/04` §4), and before PreFlop issues the random cut for that hand (`docs/12` §6).
- Bets are accepted at the odds shown when the bet is placed. If the book version has changed, the bet is rejected with the new price, unless the player has opted in to accepting changes.

## 3. Void and refund

The round is voided and every stake refunded in full when:
1. the hand ends before the flop and no *PreFlop flop* is dealt;
2. the dealer exposes a card before the round has locked, or a misdeal reaches the flop;
3. the result cannot be verified (the entries disagree and no evidence settles it) within the club's SLA;
4. the table goes offline between LOCKED and RESULT_VERIFIED for longer than the SLA;
5. integrity staff void it after investigation, with a reason that is logged and audited;
6. the hand's procedure was broken: no *shuffle complete* from the automatic shuffler, no dealer cut, or events out of order (`docs/11`);
7. the table's connection went down (no heartbeat for more than 5 s, or video more than 6 s behind) and the flop could not be verified.

A corrected result after settlement is handled with compensating entries (`docs/01` §5).

## 4. Catalogue

All 46 items in the business plan are covered, grouped into **42 markets** with **250 selections** (247 offered; "exactly 3 aces", "total 6" and "total 42" each hit only 4 of 22,100 flops and are too rare to offer). Probabilities and odds are in **[`odds-book.md`](./odds-book.md)**, which is generated from the code. Selection ids, for example `suit-pattern:rainbow`, are the stable API identifiers (`<market id>:<key>`).

| Family | Markets (id) | Plan items |
|---|---|---|
| A. Rank patterns | `rank-pattern`, `hand-class`, `paired-board`, `pair-of-rank`, `pair-height`, `pair-face-kicker` | 1–6, 31–32 |
| B. Suits and colours | `suit-pattern`, `monotone-suit`, `colour`, `red-count`, `suit-count-{s,h,d,c}` | 7–13 |
| C. High / low | `all-below`, `all-above`, `all-in-range`, `any-above`, `high-count`, `highest-card`, `lowest-card` | 14–20 |
| D. Face and named | `face-count`, `ace-count`, `any-ace`, `contains-rank`, `contains-card`, `broadway`, `ace-king` | 21–30 |
| E. Sequences | `straight`, `straight-flush`, `connected`, `one-gapper`, `exact-straight`, `span` | 31–37 |
| F. Totals | `sum-24`, `sum-20.5`, `sum-28.5`, `sum-band`, `sum-exact`, `sum-parity`, `odd-count` | 38–43 |
| G. Combined | `combo` (pair+all red, rainbow+below 9, straight+rainbow, monotone+face, pair+face) | 44–46 |

**First release** (plan §7): `rank-pattern`, `hand-class`, `suit-pattern`, `colour`, `face-count`, `all-below` and `sum-24`. Everything else is priced and tested but switched off until the pilot has validated settlement.

### 4.1 Flop hand (`hand-class`)

The best three-card poker hand the flop makes. This is the app's main prediction grid. Every flop is in **exactly one** class, so the classes never overlap.

A **sequence** is three different, consecutive ranks. The ace plays high (Q-K-A) or low (A-2-3); K-A-2 is not a sequence. **Same suit** means all three cards share one suit (a monotone flop).

| Selection | Wins when | Flops |
|---|---|---|
| `hand-class:straight-flush` | A sequence, all the same suit | 48 |
| `hand-class:trips` | All three cards the same rank | 52 |
| `hand-class:straight` | A sequence, not all the same suit | 720 |
| `hand-class:flush` | All the same suit, not a sequence | 1,096 |
| `hand-class:pair` | Exactly two cards of one rank | 3,744 |
| `hand-class:high-card` | Three different ranks, not a sequence, not all the same suit | 16,440 |

The table runs from strongest to weakest, as in three-card poker: a straight flush pays only as a straight flush, never also as a straight or a flush. Trips and pairs cannot be flushes or straights, because a flop never holds the same card twice and a sequence needs three different ranks. Note that the separate `straight` market (§4.2) wins on any sequence, straight flushes included.

### 4.2 Rules for every market

The conventions in §1 apply throughout. "N" is the number chosen by the selection.

| Market | A selection wins when |
|---|---|
| `rank-pattern` | The flop has three different ranks (`no-pair`), exactly one pair (`pair`) or three of a kind (`trips`) |
| `hand-class` | See §4.1 |
| `paired-board` | `yes`: some rank appears at least twice (pair or trips). `no`: three different ranks |
| `pair-of-rank` | Exactly two cards of the chosen rank. Trips do not count |
| `pair-height` | Exactly one pair, and the paired rank is 2–7 (`low`), 8–10 (`mid`) or J–A (`high`) |
| `pair-face-kicker` | Exactly one pair, and the unpaired card is J, Q or K |
| `suit-pattern` | Three suits (`rainbow`), exactly two suits (`two-tone`) or one suit (`monotone`) |
| `monotone-suit` | All three cards are of the chosen suit |
| `colour` | All red (`all-red`), all black (`all-black`) or both colours present (`mixed`) |
| `red-count` | Exactly N red cards (♥ ♦), N = 0–3 |
| `suit-count-s`, `-h`, `-d`, `-c` | Exactly N cards of that suit (♠, ♥, ♦, ♣), N = 0–3 |
| `all-below` | Every card is strictly below the chosen rank (6, 7, 8, 9, 10 or J). The ace is high |
| `all-above` | Every card is strictly above the chosen rank (7, 8, 9 or 10). The ace is high |
| `all-in-range` | Every card is in the inclusive range 5–9, 6–10, 7–J or 8–Q |
| `any-above` | `above-J`: at least one Q, K or A. `below-5`: at least one 2, 3 or 4 |
| `high-count` | Exactly N cards ranked J, Q, K or A |
| `highest-card` | The highest card is 8 or lower (`le-8`), or exactly 9, 10, J, Q, K or A. The ace is high |
| `lowest-card` | The lowest card is exactly 2, 3, 4, 5 or 6, or is 7 or higher (`ge-7`). The ace is high |
| `face-count` | Exactly N face cards (J, Q, K). N = 3 is "all images" |
| `ace-count` | Exactly N aces |
| `any-ace` | `yes`: at least one ace. `no`: no ace |
| `contains-rank` | At least one card of the chosen rank |
| `contains-card` | The chosen card (e.g. `As`) is one of the three flop cards |
| `broadway` | Every card is 10, J, Q, K or A |
| `ace-king` | At least one ace and at least one king |
| `straight` | The flop is a sequence (§4.1), any suits. Straight flushes count |
| `straight-flush` | A sequence, all the same suit |
| `connected` | `yes`: two of the flop's ranks differ by one, with the ace next to both K and 2. `no`: no such pair. A pair alone is not connected |
| `one-gapper` | Three different ranks where highest minus lowest is exactly 3 (e.g. 5-6-8, 5-7-8). The ace is high only |
| `exact-straight` | The ranks are exactly the chosen sequence (A-2-3, 2-3-4, …, Q-K-A), any suits |
| `span` | Highest rank minus lowest rank (ace = 14) is 0–4, 5–8 or 9–12. Trips have spread 0 |
| `sum-24` | Rank total over 24 (`over`), under 24 (`under`) or exactly 24 (`exactly`). A total of 24 loses both `over` and `under` |
| `sum-20.5`, `sum-28.5` | Rank total over or under the line |
| `sum-band` | Rank total in the inclusive band 6–15, 16–20, 21–23, 24, 25–27, 28–32 or 33–42 |
| `sum-exact` | Rank total equals the chosen number, 6–42 |
| `sum-parity` | Rank total is odd or even |
| `odd-count` | Exactly N cards with an odd rank (3, 5, 7, 9, J, K) |
| `combo` | Both conditions hold: exactly one pair and all red (`pair-all-red`); three suits and every card 2–8 (`rainbow-below-9`); a sequence on three suits (`straight-rainbow`); one suit and at least one J, Q or K (`monotone-face`); exactly one pair and at least one J, Q or K (`pair-face`) |

## 5. Worked examples — flop K♥ K♦ 7♥

| Selection | Result | Why |
|---|---|---|
| `rank-pattern:pair` | **Win** | Exactly one pair (kings) |
| `hand-class:pair` | **Win** | A pair; not a flush because ♦ breaks the suit |
| `pair-of-rank:K` | **Win** | Two kings, not three |
| `suit-pattern:two-tone` | **Win** | Two suits: ♥ and ♦ |
| `colour:all-red` | **Win** | ♥ ♦ ♥ are all red |
| `face-count:2` | **Win** | K and K are face cards; 7 is not |
| `sum-24:over` | **Win** | 13 + 13 + 7 = 33 |
| `straight:yes` | Lose | Ranks are not three distinct consecutive values |
| `all-below:8` | Lose | K is above 7 |

Flop A♠ 2♦ 3♣: `straight:yes` **wins** (the ace plays low), but `all-below:6` **loses** (outside sequences the ace is 14) and the total is 14 + 2 + 3 = **19**.

## 6. Combined markets

A combined condition is priced on its **joint** count over all flops, never by multiplying the probabilities of its parts. For example, "pair and all red" wins on 312 flops (1.41%), whereas multiplying the separate probabilities would wrongly give 0.169 × 0.118 = 1.99%.
