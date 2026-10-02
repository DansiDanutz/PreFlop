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
- **Closes:** on the club's *deal-start* signal for hand N+1, which comes **before any hole card is dealt** (see `docs/04` §4).
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

All 46 items in the business plan are covered, grouped into **41 markets** with **244 selections** (241 offered; "exactly 3 aces", "total 6" and "total 42" each hit only 4 of 22,100 flops and are too rare to offer). The exact definition of each, its probability and its odds are in **[`odds-book.md`](./odds-book.md)**, which is generated from the code. Market ids, for example `suit-pattern:rainbow`, are the stable API identifiers.

| Family | Markets (id) | Plan items |
|---|---|---|
| A. Rank patterns | `rank-pattern`, `paired-board`, `pair-of-rank`, `pair-height`, `pair-face-kicker` | 1–6 |
| B. Suits and colours | `suit-pattern`, `monotone-suit`, `colour`, `red-count`, `suit-count-{s,h,d,c}` | 7–13 |
| C. High / low | `all-below`, `all-above`, `all-in-range`, `any-above`, `high-count`, `highest-card`, `lowest-card` | 14–20 |
| D. Face and named | `face-count`, `ace-count`, `any-ace`, `contains-rank`, `contains-card`, `broadway`, `ace-king` | 21–30 |
| E. Sequences | `straight`, `straight-flush`, `connected`, `one-gapper`, `exact-straight`, `span` | 31–37 |
| F. Totals | `sum-24`, `sum-20.5`, `sum-28.5`, `sum-band`, `sum-exact`, `sum-parity`, `odd-count` | 38–43 |
| G. Combined | `combo` (pair+all red, rainbow+below 9, straight+rainbow, monotone+face, pair+face) | 44–46 |

**First release** (plan §7): `rank-pattern`, `suit-pattern`, `colour`, `face-count`, `all-below` and `sum-24`. Everything else is priced and tested but switched off until the pilot has validated settlement.

## 5. Worked examples — flop K♥ K♦ 7♥

| Selection | Result | Why |
|---|---|---|
| `rank-pattern:pair` | **Win** | Exactly one pair (kings) |
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
