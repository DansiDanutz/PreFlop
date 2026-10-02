# 17 — Tournaments

A **tournament** is a timed contest on the flops of the live (simulated) tables.
- Every entrant pays the same buy-in and gets the same **stack** of tournament points and the same number of **bets**.
- Whoever holds the biggest stack when the clock runs out wins.
- Ties go to the player who used fewer bets.

The owner's decisions apply as everywhere else:
- **free-chip tournaments** pay prizes in free chips and badges (no cash value);
- **chip and diamond tournaments** belong to one club or organizer, and live in its closed loop;
- **real-money tournaments** are built but refused while real money is off (`403 mode_disabled`).

## 1. Settings

| Field | Meaning |
|---|---|
| `mode`, `currency` | `play`/PLAY (PreFlop only), `virtual-chips`/CHIP and `diamonds`/DIAMOND (an organization's own), and real money (refused while off) |
| `buy_in_minor` | Paid from the player's wallet at registration. `0` makes a freeroll |
| `fee_bps` | 0–2,000. The owner's share of the buy-ins, kept at completion. Never charged on a freeroll or a cancelled tournament |
| `added_minor` | A fixed amount the owner adds to the prize pool at creation. PreFlop's comes from `PreFlop:play-issuance` (play) or `PreFlop:marketing`; an organization's comes from its treasury |
| `starting_stack` | Tournament points each entrant starts with. They have no cash value and exist only inside the tournament |
| `bets_allowed` | How many bets each entrant may place (1–500) |
| `min_stake`, `max_stake` | Limits per bet, in points. A stake can never exceed the current stack |
| `starts_at`, `duration_minutes` | The tournament runs from `starts_at` until `ends_at = starts_at + duration` (5 minutes to 7 days) |
| `late_reg_minutes` | Registration stays open this long after the start (default 0). A late entrant gets the full stack and every bet |
| `min_entries`, `max_entries` | If fewer than `min_entries` (default 2) have registered at the start, the tournament is cancelled and every buy-in refunded. `max_entries` caps the field |
| `payout_bps` | Share of the prize pool per final position, e.g. `[5000, 3000, 2000]`; it sums to 10,000 |

## 2. Playing
- **Registering** pays the buy-in into the tournament pool account (`tournament.buyin`). The player may unregister for a full refund until the start.
- **Responsible gaming:** a real-money buy-in counts against the player's daily loss limit (`403 limit_reached`), together with real-money bets. A tournament counts as buy-in minus prize; a cancelled or left tournament counts nothing.
- **Betting.** Between `starts_at` and `ends_at`, an entrant bets tournament points on any open flop at the PreFlop odds of the moment (the same prices as the lobby). Each bet:
  - uses one of the entrant's bets at once, whatever the result;
  - takes the stake off the stack at once;
  - pays `stake × odds` back to the stack if it wins.
- **One bet per flop per entrant.** Hedging every outcome of one flop is not possible.
- **Eligibility is checked on every bet, not only at registration.** The mode must still be on, and the account still active. For real money, the identity check must still be verified.
- **Out of the tournament (`busted`):** once nothing is waiting to settle and the stack is below the minimum stake (a stack of 0 included), the entrant can no longer bet and is out.
- **Finished:** an entrant who has used every bet, with nothing left to settle, is finished. Their stack is final.
- **When the clock ends:** no new bets are accepted. Bets already placed still settle with their flop, and the tournament stays `settling` until they do. An entrant with unused bets keeps the stack they have; unused bets are worth nothing.
- **A voided flop** (sweeper, review, paused table) gives the stake back *and* the bet back.

## 3. Ranking
Positions are recomputed after every bet and every settled flop, and pushed live to `tournament:<id>` on the WebSocket:
1. biggest stack first;
2. on the same stack, **fewer bets used first**;
3. the same stack and the same bets used is a **tie**: the players share the position.

Every standing shows the position, the stack (the points accumulated), bets used, bets left, bets waiting for a flop, the status, and the prize the position is worth.

## 4. Prizes
- `prize_pool = buy-ins − fee + added`.
- At completion, each paid position takes its share of the pool (`tournament.payout`) into the winner's wallet. That is `wallet` for free chips and real money, or `wallet-<org>` for chips and diamonds. The fee goes to its owner: `PreFlop:platform-fees` or the organization's treasury (`tournament.fee`).
- **Fewer entrants than paid places:** the shares of the places that exist are scaled up to 100%.
- **Ties:** tied players split the shares of the positions they occupy equally. Rounding goes to the earliest entrant, so the pool always ends at exactly 0.
- The top three get badges (`champion`, `podium`).
- **Real money:**
  - prizes go only to active, identity-verified players; anyone else keeps their position, the prize ranks close up, and the dashboard projects prizes the same way;
  - while the mode is off, completion waits (the team can cancel to refund). A field below `min_entries` is still cancelled and refunded, whatever the mode;
  - if no entrant is eligible for a prize at the end, the tournament is cancelled (`no eligible winner`): every buy-in is refunded and the added prize returned.

**Cancelling** (by the team or the owner, or automatically below `min_entries`) refunds every buy-in in full and returns the added amount to whoever put it in.

## 5. API
- **Player:**
  - `GET /v1/tournaments?status=upcoming|running|finished`, with `server_time` for the lobby countdowns;
  - `GET /v1/tournaments/:id`: the tournament, the standings, `you` with your bets, and `server_time` for the countdown;
  - `POST /v1/tournaments/:id/register`, `DELETE /v1/tournaments/:id/register`;
  - `POST /v1/tournaments/:id/bets {round_id, selection_id, stake, odds_centi, accept_price_change?, idempotency_key}`.
- **Team:** `GET/POST /v1/admin/tournaments`, `GET /v1/admin/tournaments/:id`, `POST /v1/admin/tournaments/:id/cancel {reason}`.
- **Organization** (club or organizer; chips and diamonds only): `GET/POST /v1/org/:id/tournaments`, `POST /v1/org/:id/tournaments/:t/cancel`.
- **Errors:**
  - `registration_closed`, `tournament_full`, `already_registered`, `not_registered`;
  - `tournament_not_running`, `not_enough_players`;
  - `entry_busted`, `no_bets_left`, `stake_too_high`, `invalid_stake`;
  - `one_bet_per_flop`, `round_locked`, `price_changed`, `not_offered`.
