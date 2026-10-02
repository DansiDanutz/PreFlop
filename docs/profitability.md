# PreFlop Profitability by Participant

> **Generated file — do not edit by hand.** Run `pnpm book`. Every input is a placeholder in
> `packages/odds-engine/src/{scenarios,sharing,globalRules,costModel}.ts`. Figures are **expected values per month**;
> real months vary with luck, which is why houses hold bankroll or collateral.

Each scenario reconciles: what players are expected to lose (or pay) equals the sum of every participant's income plus costs.

## Summary

| Scenario | Mode | Who pays the winnings | Bets / month | Turnover (EUR) | PreFlop | Others | Reconciles |
|---|---|---|---|---|---|---|---|
| Club with 100 players, 2 tables — PreFlop is the house (EUR) | Real money (fiat) | PreFlop | 108,000 | €432,000 | **€22,490** | Club €7,920 | ✅ |
| Same club grown to 1,000 players, 4 tables — higher tiers apply | Real money (fiat) | PreFlop | 2,160,000 | €8,640,000 | **€404,004** | Club €204,194 | ✅ |
| Betting company with 50,000 players — PreFlop is the house (EUR) | Real money (fiat) | PreFlop | 12,960,000 | €77,760,000 | **€2,980,933** | Betting company €1,763,209; Provider clubs (10) €313,020 | ✅ |
| Same betting company creates prize pools inside the app (EUR, no house) | Real money (fiat) | Nobody — players' pool | 1,440,000 | €14,400,000 | **€645,000** | Betting company €576,000; Provider clubs €216,000 | ✅ |
| Same betting company as the house (EUR) — PreFlop takes a platform fee | Real money (fiat) | Betting company | 12,960,000 | €77,760,000 | **€933,120** | Betting company €2,815,315; Provider clubs (10) €546,093 | ✅ |
| Diamond organizer — community of 300 players, organizer is the house | Diamonds | Organizer | 270,000 | €243,000 | **€1,899** | Organizer €2,070; Provider club €486 | ✅ |
| Virtual-chips social room — 2,000 players, pools (no house) | Virtual chips | Nobody — players' pool | 1,080,000 | €540,000 | **€21,300** | Organizer €12,960; Provider club €8,640 | ✅ |
| Play money — 5,000 players, fun only | Play money (fun only) | Nobody (no money) | 6,750,000 | €0 | **−€750** |  | ✅ |

## Club with 100 players, 2 tables — PreFlop is the house (EUR)

A poker club brings 100 of its own players to PreFlop and streams 2 table(s). PreFlop is the house and pays all winnings; the club earns a dynamic share of GGR for content (hands dealt) and distribution (players brought).

Activity: 100 players · 18,000 flops/month · 5.00% bet on each flop · 1.2 bets each · average stake 4 EUR → **108,000 bets, 432,000 EUR turnover**.

| Participant | Role | Expected EUR / month | How |
|---|---|---|---|
| PreFlop | House (pays the winnings) | €22,490 | GGR €37,126 − shares − promotions − variable costs |
| Club | Provider + distributor | €7,920 | 21.33% of GGR |
| Payment / KYC / infra providers | Variable costs | €4,860 | 1.13% of turnover |
| **Players** | Bettors | **−€35,270** | expected cost of play (house edge / rake, net of promotions) |

Book edge (market mix): 8.59% · GGR €37,126 · external shares applied: 21.33% of GGR.
- Club: content 6.33% + distribution 15.00% → **21.33%** (floor 5%, cap 35%)

Checks: ✅ PreFlop net ≥ target × turnover · ✅ Every partner share ≥ 0

## Same club grown to 1,000 players, 4 tables — higher tiers apply

A poker club brings 1000 of its own players to PreFlop and streams 4 table(s). PreFlop is the house and pays all winnings; the club earns a dynamic share of GGR for content (hands dealt) and distribution (players brought).

Activity: 1,000 players · 36,000 flops/month · 5.00% bet on each flop · 1.2 bets each · average stake 4 EUR → **2,160,000 bets, 8,640,000 EUR turnover**.

| Participant | Role | Expected EUR / month | How |
|---|---|---|---|
| PreFlop | House (pays the winnings) | €404,004 | GGR €742,525 − shares − promotions − variable costs |
| Club | Provider + distributor | €204,194 | 27.50% of GGR |
| Payment / KYC / infra providers | Variable costs | €97,200 | 1.13% of turnover |
| **Players** | Bettors | **−€705,399** | expected cost of play (house edge / rake, net of promotions) |

Book edge (market mix): 8.59% · GGR €742,525 · external shares applied: 27.50% of GGR.
- Club: content 7.50% + distribution 20.00% → **27.50%** (floor 5%, cap 35%)

Checks: ✅ PreFlop net ≥ target × turnover · ✅ Every partner share ≥ 0

## Betting company with 50,000 players — PreFlop is the house (EUR)

A large betting company embeds PreFlop. Its traffic bets on 10 provider-club tables. PreFlop is the house; the partner's share rises progressively with the turnover it generates; each provider club earns a content share by hands dealt.

Activity: 50,000 players · 144,000 flops/month · 0.15% bet on each flop · 1.2 bets each · average stake 6 EUR → **12,960,000 bets, 77,760,000 EUR turnover**.

| Participant | Role | Expected EUR / month | How |
|---|---|---|---|
| PreFlop | House (pays the winnings) | €2,980,933 | GGR €5,290,441 − shares − promotions − variable costs |
| Betting company | Distributor (turnover tiers) | €1,763,209 | 33.33% of GGR |
| Provider clubs (10) | Flop providers (content tiers) | €313,020 | 5.92% of GGR |
| Payment / KYC / infra providers | Variable costs | €233,280 | 0.30% of turnover |
| **Players** | Bettors | **−€5,290,441** | expected cost of play (house edge / rake, net of promotions) |

Book edge (market mix): 6.80% · GGR €5,290,441 · external shares applied: 39.24% of GGR.
- Betting company: distribution 33.33% → **33.33%** (floor 20%, cap 40%)
- Provider clubs (10): content 5.92% → **5.92%** (floor 5%, cap 12%)

Checks: ✅ PreFlop net ≥ target × turnover · ✅ Every partner share ≥ 0

## Same betting company creates prize pools inside the app (EUR, no house)

The betting company runs 600 prize pools a month on PreFlop flops. Players play against each other; nobody is the house. The rake is split between PreFlop, the pool creator (share grows with pools created) and the provider club.

Activity: 20,000 players · 144,000 flops/month · 0.05% bet on each flop · 1 bets each · average stake 10 EUR → **1,440,000 bets, 14,400,000 EUR turnover**.

| Participant | Role | Expected EUR / month | How |
|---|---|---|---|
| Betting company | Pool creator (pools-created tiers) | €576,000 | 40.0% of rake |
| Provider clubs | Flop provider | €216,000 | 15.0% of rake |
| PreFlop | Platform (no risk) | €645,000 | 45.0% of rake |
| Infra providers | Variable costs | €3,000 | €0.15 per active player (paid by PreFlop) |
| **Players** | Bettors | **−€1,440,000** | expected cost of play (house edge / rake, net of promotions) |

Rake 10.0% of pool turnover = €1,440,000. Creator share from 600 pools/month: 40%.

Checks: ✅ Rake within global bounds · ✅ PreFlop net ≥ 0

## Same betting company as the house (EUR) — PreFlop takes a platform fee

The betting company holds the licence and the bankroll: it is the house and pays the winnings from collateral locked on PreFlop. PreFlop earns a risk-free platform fee per bet; the company pays the provider clubs a share of its GGR.

Activity: 50,000 players · 144,000 flops/month · 0.15% bet on each flop · 1.2 bets each · average stake 6 EUR → **12,960,000 bets, 77,760,000 EUR turnover**.

| Participant | Role | Expected EUR / month | How |
|---|---|---|---|
| Betting company | House (pays the winnings from its collateral) | €2,815,315 | GGR €5,460,928 − platform fee − provider share − own costs |
| PreFlop | Platform (no risk) | €933,120 | fee €0.090 per bet − infra |
| Provider clubs (10) | Flop provider | €546,093 | 10% of organizer GGR |
| Payment / KYC / infra providers | Variable costs | €1,166,400 | organizer + PreFlop |
| **Players** | Bettors | **−€5,460,928** | expected cost of play (house edge / rake, net of promotions) |

Organizer book edge: 7.02% · platform fee 1.50% of stake · organizer EV per unit staked 3.90%.

Checks: ✅ Organizer house config valid (has the edge after fees) · ✅ Organizer net ≥ 0 · ✅ PreFlop net ≥ 0 with zero risk

## Diamond organizer — community of 300 players, organizer is the house

An organizer (a poker community, streamer or club) buys diamonds from PreFlop, gives them to its 300 members and runs a room on one provider table. Every bet pays PreFlop a fixed 1 ◆ (sunk), plus the organizer's 3% rake; the rest plays against the organizer's diamond house. The organizer charges its members off-platform (here €15/month) and rebuys the diamonds PreFlop's fee consumes.

Activity: 300 players · 9,000 flops/month · 10.00% bet on each flop · 1 bets each · average stake 100 DIAMOND → **270,000 bets, 27,000,000 DIAMOND turnover**.

| Participant | Role | Expected EUR / month | How |
|---|---|---|---|
| Organizer | House in diamonds (pays winnings from its diamond collateral) | €2,070 | off-platform income €4,500 − diamond rebuys €2,430; rake + house wins (2,505,918 ◆) recirculate to its players |
| PreFlop | Diamond seller + platform | €1,899 | 270,000 ◆ fees sunk × €0.0090 − provider share − ops |
| Provider club | Flop provider (paid in EUR) | €486 | 20% of PreFlop diamond revenue |
| Infra providers | Variable costs | €45 | €0.15 per active player |
| **Players** | Bettors | **−€4,500** | what members pay the organizer off-platform |

Diamond flows / month: 270,000 ◆ sunk to PreFlop (fixed 1 ◆ per bet) · organizer rebuys 270,000 ◆ at 0.90 cents each · players' diamond cost 2,775,918 ◆ (fee + rake + house edge), most of it recirculating to the organizer.

**Dilution tracker:** sink rate 1.00% of every diamond staked · a diamond is staked ~100 times before it is consumed · 1.00 ◆ consumed per bet · with 3 months of float the organizer's stock lasts 540,000 more bets.

Checks: ✅ Fixed fee ≤ 5% of minimum stake · ✅ Organizer net ≥ 0 · ✅ Diamonds conserved per bet

## Virtual-chips social room — 2,000 players, pools (no house)

Players get chips by buying them from PreFlop (100 chips = €1) or by online transfer from their club or organizer, then play pools against each other. The rake leaves the chip economy, so players buy more chips; the chip-sales revenue that the rake represents is shared with the room organizer and provider club.

Activity: 2,000 players · 18,000 flops/month · 3.00% bet on each flop · 1 bets each · average stake 50 CHIP → **1,080,000 bets, 54,000,000 CHIP turnover**.

| Participant | Role | Expected EUR / month | How |
|---|---|---|---|
| PreFlop | Platform (no risk) | €21,300 | 50.0% of rake |
| Organizer | Room organizer | €12,960 | 30.0% of rake |
| Provider club | Flop provider | €8,640 | 20.0% of rake |
| Infra providers | Variable costs | €300 | €0.15 per active player (paid by PreFlop) |
| **Players** | Bettors | **−€43,200** | expected cost of play (house edge / rake, net of promotions) |

Rake 8.0% of pool turnover = €43,200.

Checks: ✅ Rake within global bounds · ✅ PreFlop net ≥ 0

## Play money — 5,000 players, fun only

Free play with the real odds book and no fees. No revenue; it is PreFlop's acquisition funnel into chips, diamonds and real-money rooms.

Activity: 5,000 players · 18,000 flops/month · 5.00% bet on each flop · 1.5 bets each · average stake 100 PLAY → **6,750,000 bets, 675,000,000 PLAY turnover**.

| Participant | Role | Expected EUR / month | How |
|---|---|---|---|
| PreFlop | Virtual house (no money at stake) | −€750 | acquisition cost: streaming + infra |
| Infra providers | Variable costs | €750 | €0.15 per active player |
| **Players** | Bettors | **€0** | free |


Checks: ✅ No fees charged in play mode

## Share tiers used

**club** — Poker club — content (hands dealt at its tables) + distribution (its own active players) (base: GGR, floor 5%, cap 35%)

- content by `handsDealt` (progressive): 0+ → 5% · 10,000+ → 8% · 30,000+ → 10% · 60,000+ → 12%
- distribution by `activePlayers` (whole-volume): 0+ → 0% · 25+ → 10% · 100+ → 15% · 500+ → 20% · 2,000+ → 25%

**provider** — Poker club supplying flops for players brought by others — content share only (base: GGR, floor 5%, cap 12%)

- content by `handsDealt` (progressive): 0+ → 5% · 10,000+ → 8% · 30,000+ → 10% · 60,000+ → 12%

**partner** — Betting company — distribution share, progressive by monthly turnover (EUR cents) (base: GGR, floor 20%, cap 40%)

- distribution by `turnoverMinor` (progressive): 0 EUR+ → 20% · 1,000,000 EUR+ → 25% · 5,000,000 EUR+ → 30% · 20,000,000 EUR+ → 35%

**pool-creator** — Creator of prize pools / contests (partner, club or user) — share of rake by pools created (base: RAKE, floor 30%, cap 45%)

- creator by `poolsCreated` (whole-volume): 0+ → 30% · 50+ → 35% · 500+ → 40% · 5,000+ → 45%

Example (progressive): a partner with €77,760,000 monthly turnover earns 33.33% of GGR.
