# 06 — Roadmap and Decisions

## Open decisions (plan §14), each with a recommendation

| # | Decision | Recommendation | Status |
|---|---|---|---|
| 1 | Real money or play chips; territory; operator | Pilot with **play chips** at one club, then real money under a licensed operator in the first territory. The Partner API lets a licensed betting company act as the operator from day one | Open: founder and legal |
| 2 | Permissions for online distribution | Get legal advice per territory before real money. Architecture: one deployment region per licence | Open |
| 3 | Subscription price and tiers | Placeholder €1,500/month per club, entitlement per table. Validate in the pilot | Open |
| 4 | Fee basis and percentages | Percentage of buy-ins, deducted when entries close. Use the minimums in `docs/07` | Structure proposed; numbers open |
| 5 | Way bets are resolved | **All three:** fixed odds (house), parimutuel pools, contests (`docs/01` §3) | Proposed |
| 6 | Flop settlement vs tournament prizes | Points settle each flop at fair odds; prizes are paid at the end of the event (`docs/05` §4) | Proposed |
| 7 | Card capture and cutoff | Lock on **deal-start, before hole cards**. Dealer + floor dual entry for the pilot, RFID later | Proposed; critical |
| 8 | Colour, card values, sequences | Colour = red/black; A = 14; A-2-3 and Q-K-A are straights; strict thresholds (`docs/03` §1) | Proposed |
| 9 | Tournament scoring, ties, limits | `docs/05` §4 | Proposed |
| 10 | Cancellations, outages, no flop | Deal a PreFlop flop anyway, otherwise VOID and refund (`docs/03` §3) | Proposed |
| 11 | Web, mobile or both | Web (PWA) first, React Native next. The partner widget covers B2B | Proposed |
| 12 | Third-party settlement duties | Seamless wallet; PreFlop is the house; daily reconciliation (`docs/02` §2) | Proposed |
| 13 | **Net EV target and cost figures** | 2.5% net target; placeholder costs in `costModel.ts` | **Founder to confirm** |
| 14 | Dynamic share tiers | Tier ladders for each participant type, with a profit guardrail (`docs/09`) | **Founder to confirm the tier values** |
| 15 | Play modes | Real fiat, real crypto (USDT/USDC), play (reset at any time), chips (bought or transferred by clubs and organizers), diamonds (bought by organizers with fiat or crypto) (`docs/08`) | Proposed |
| 16 | Who pays the winnings | PreFlop house, organizer house with collateral, or pool (`docs/10`) | Proposed |
| 17 | Diamond economics | 1 ◆ fixed fee per bet, 20 ◆ minimum stake, €1 per 100 ◆ with volume discounts, provider clubs paid 20% in EUR | **Founder to confirm** |
| 18 | Club table requirements | Automatic shuffler and a dealer cut before every hand are mandatory. Tested connection (≥ 10 Mbps up, ≤ 150 ms, ≤ 3 s video) with a backup line and live monitoring (`docs/11`) | Confirmed by the founder; thresholds are placeholders |

## Delivery phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 — Foundations** ✅ (this PR) | Odds engine: exact probabilities, pricing with net EV, exposure, settlement, fees, dynamic sharing, play modes, house models, diamonds, profitability scenarios. Generated odds book and P&L; architecture and API docs | 90 tests green; generated docs checked in CI |
| **1 — Core backend** | Fastify API, Postgres ledger, round state machine, Provider API, bet placement with exposure, settlement, back-office minimum | A simulated table runs 10k rounds; ledger reconciles to zero; no bet accepted after lock |
| **2 — Player app + pilot club** | Web lobby, live table with video, bet slip, history; club tablet app; dual-entry results; play chips | 4 weeks live at one table; ≥ 99.9% of rounds verified; zero settlement errors |
| **3 — Contests** | Pools, tournaments, heads-up, challenges, invitations, organizer reports | Fees reconcile across Models A–D; standings and ties match the rules |
| **4 — Real money and partners** | KYC, payments, responsible gaming, Partner API + widget, seamless wallet, statements | Licence in place; first partner live in the sandbox, then in production |
| **5 — Scale** | RFID capture, more clubs and tables, integrity analytics, more markets, leaderboards | Per-table chi-square monitoring; automated pauses on anomalies |

## Pilot measures (plan §13)

These come from the ledger and the round log:
- result accuracy (corrections per 1,000 rounds);
- time from lock to settlement;
- void rate by reason;
- reconciliation differences (target: 0);
- realized gross edge against the theoretical edge per market;
- repeat participation;
- support tickets from clubs and organizers.
