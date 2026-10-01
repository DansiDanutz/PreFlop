# 05 — Fees, Pools and Tournaments

Implemented in `packages/odds-engine/src/fees.ts`. Amounts are integers in minor units.

## 1. The confirmed formula

```
P = B − F                                   net prize pool = buy-ins − fee
F = floor(B × fee_bps / 10 000)             (if the fee is a percentage; floor favours players)
Σ party shares = F                          largest-remainder rounding → never off by one unit
```

- **Role merging:** a party that holds several roles is paid once, with its shares added together. Example: a club that is both provider and organizer (Models A/D). The fee is never deducted twice.
- **Rounding:** fee shares are computed with integer division, and any remainder units go to the parties with the largest fractional remainders. Ties go by role order.

## 2. Distribution models

The percentages below are placeholders (`costModel.ts`). Only the structure is confirmed.

| Model | Fee recipients | Placeholder split | Notes |
|---|---|---|---|
| A — club's own players | PreFlop, club (provider + distributor) | 50 / 50 | One club entitlement |
| B — third-party platform | PreFlop, provider club, partner | 50 / 15 / 35 | For B2B, a seamless wallet is recommended |
| C — user-organized | PreFlop, provider club, organizer | 35 / 20 / **45** | The organizer's share must be the largest single share |
| D — club-organized | PreFlop, club (organizer + provider) | 50 / 50 | If a different club provides the flop, split the club side 30 organizer / 20 provider |

## 3. Parimutuel flop pools (players against each other, one flop)

- Each round can have a pool per market, for example rainbow / two-tone / monotone.
- Total stakes B; fee F; the winners share P = B − F in proportion to their stakes.
- **No winner** (nobody backed the outcome): every stake is refunded and no fee is taken.
- **Recommended for:** jurisdictions or launch phases where carrying fixed-odds risk is not wanted, and for social or private rooms.
- **Fee floor:** a pool's fee rate must be at least the contest channel's required fee (`docs/07`), otherwise PreFlop runs pools at a loss.

## 4. Tournaments, heads-up and challenges

**Recommended scoring (it answers plan §6's open question):**

1. Every entrant gets the same points stack, for example 10,000.
2. Each round, an entrant may place points on any allowed markets, up to a maximum per round (for example 20% of their stack).
3. A winning selection pays **points × fair odds**. There is no margin, because players compete against each other, not the house. The fair odds come from the same engine, so scoring is exactly fair: everyone's expected score stays constant.
4. Each flop settles in points immediately. **Prizes are paid only when the event finishes,** from P = B − F, following the prize schedule published before entry. A typical schedule pays the top 15%, weighted towards the top.
5. **Ties** split the prizes for the tied positions equally (largest remainder). A no-flop round is void for points and does not count towards the event's round total.
6. **Heads-up** is the same format with two players, winner takes P. **Challenges** set a target, such as "reach 20,000 points in 30 flops", and everyone who hits it shares P equally.

**Locked terms:** buy-in, fee, net prize pool, schedule, rounds and markets are shown before joining and frozen when the first entry is accepted (plan §5).

**Cancellation:** if an event is cancelled before it starts, buy-ins are refunded in full and no fee is taken. If it is cancelled mid-event (for example a provider outage), the standings at that point decide the prizes, or the event is refunded, according to the policy chosen when it was created. Refunds are always posted through the ledger, so buy-ins reconcile to refunds + prizes + fee.
