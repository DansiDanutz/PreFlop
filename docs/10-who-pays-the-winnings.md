# 10 — Who Pays the Winnings

Every round of every room has a **house model**. It decides whose money pays the winners, who keeps the house edge, and how PreFlop earns. The code is in `packages/odds-engine/src/houses.ts`.

| | **PreFlop is the house** | **Organizer is the house** | **No house (pool / contest)** |
|---|---|---|---|
| Who runs it | PreFlop | A club, betting company or diamond organizer | Anyone who creates a pool or event |
| Stakes go to | `PreFlop:bankroll:<mode>` | `<organizer>:collateral:<mode>` | The pool |
| Winnings paid from | PreFlop's bankroll | **The organizer's collateral** (PreFlop never pays an organizer's winners) | The pool: P = B − F |
| Keeps the house edge | PreFlop, after paying dynamic shares | The organizer | Nobody; players share P |
| PreFlop earns | GGR − shares − promotions − costs | **Platform fee per bet, with no risk:**<br>money and chips: 1.5% of stake<br>diamonds: **fixed 1 ◆** | Its share of the rake |
| Risk control | Exact exposure per round (`RoundExposure`) | Collateral covers every open round's worst-case loss | None needed |
| Modes | Real money, chips, play (virtual) | Real money (licensed organizer), chips, diamonds | All |

## 1. PreFlop is the house

```
place:  player wallet ──stake──▶ PreFlop bankroll
settle: PreFlop bankroll ──payout──▶ player wallet          (only if the bet won)
period: PreFlop ──dynamic shares of GGR──▶ club, partner     (docs/09)
```

- **Edge:** PreFlop's own odds book, built from exact probabilities, a tier margin, and the margin needed to hit the net EV target (`docs/04`, `docs/07`).
- **Bankroll for each mode:** EUR, USDT/USDC, chips. The per-round loss limit is a small fraction of it.

## 2. The organizer is the house

```
setup:  organizer ──deposits──▶ organizer collateral (on PreFlop, per mode)
place:  player wallet ──stake──▶ organizer collateral
        organizer collateral ──platform fee──▶ PreFlop            (fixed ◆ in diamonds, % in money/chips)
settle: organizer collateral ──payout──▶ player wallet
period: organizer ──provider share of its GGR──▶ provider club   (money modes)
```

Several rules protect players, the organizer and PreFlop:

1. **Validated book.** An organizer may only be the house if its book keeps a margin of at least the global minimum (3%, and the per-market tier floors still apply), and if it still has positive expected value after PreFlop's fee and the provider share (at least 0.5%). `validateOrganizerHouse()` rejects anything else. *Example:* 6% margin, 10% provider share and a 1.5% fee leave the organizer **+3.9%** per unit staked.
2. **Collateral before betting.** Each open round reserves its worst-case loss, computed exactly over the 22,100 flops, plus PreFlop's platform fee, which is owed whatever the flop. A bet that would push the total reserved above the collateral is **refused**. The ledger is the only record of the collateral balance; the risk engine reads it from the ledger and never changes it, so no result is ever counted twice. Winners are therefore always paid, and PreFlop never carries an organizer's risk.
3. **Licence.** In real-money modes, an organizer that is the house must hold the licence itself; this is typically a betting company. In chips and diamonds no money is at stake, so any approved organizer can be the house.
4. **Diamonds:** the organizer is always the house (or runs pools). PreFlop's income is the fixed diamond fee per bet, which leaves the organizer's economy, so the organizer rebuys diamonds.

## 3. No house: pools and contests

The winners share the net pool P = B − F. The fee F is split by roles (`docs/05`): PreFlop, the provider club, and the creator, whose share grows with the pools they create (`docs/09`). If nobody backed the winning outcome, every stake is refunded and no fee is taken.

## 4. Which model to choose

| Situation | Recommended model |
|---|---|
| PreFlop's own app, licensed territory | PreFlop is the house |
| Club bringing its own players | PreFlop is the house; the club earns dynamic shares |
| Big betting company that wants to keep the GGR | The betting company is the house; PreFlop earns a platform fee |
| Big betting company without a risk appetite | PreFlop is the house; the betting company earns turnover-tiered shares |
| Private community, streamer or club events | Diamonds with the organizer as house, or pools |
| Social or unlicensed territory | Virtual chips or play money |

Expected monthly P&L for each participant in each model is in [`profitability.md`](./profitability.md).
