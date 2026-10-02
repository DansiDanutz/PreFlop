# PreFlop — Product and Business Plan

Working draft · 2 October 2026

> This is the founder's original planning document, kept as the source of record. The engineering
> response — architecture, odds book, rules and economics — lives in the other files in `docs/`.

This document consolidates the concept, business model, betting catalogue, and delivery plan discussed so far. **Confirmed** means specified by the founder. **Proposed** means a suggested implementation or feature. **Open** means a decision is still required. No fee percentages, odds, or payout rates have been agreed.

## 1. Product concept

**Confirmed:** PreFlop is an app where users bet on properties of the three-card flop dealt live at a physical, licensed poker club. The poker club is the host and the **flop provider**.

Users browse a Poker Lobby, enter a club's room, choose a live table, watch the game, and place bets before the target flop is revealed. The app's bets concern the flop—for example, a pair, rainbow suits, or a card-value total.

The physical poker hand continues normally after the flop. App users can use that time to bet on the next flop.

## 2. Core betting cycle

**Confirmed sequence:**

1. Bets are available for an upcoming flop.
2. Users place their bets before that flop is dealt.
3. When the flop is dealt, its bets are settled and payouts are made.
4. While the physical hand continues, users can bet on the next flop.
5. The cycle repeats.

Every bet must identify its target table, hand, and flop round. A user watching the rest of hand N must clearly see that new bets concern flop N+1.

**Proposed control:** the host's authoritative round system closes betting before the physical reveal. A delayed video stream must not determine the cutoff.

**Open:** the exact cutoff signal, what information is visible before betting closes, and what happens if a hand ends without a flop.

## 3. Participants and responsibilities

| Participant | Role |
|---|---|
| PreFlop | Supplies the platform and receives an agreed share of event fees. |
| Poker club / flop provider | Hosts real poker, supplies live tables and flop results, and receives a fee share. |
| App user | Watches tables and participates in bets, tournaments, or challenges. |
| User organizer | Chooses a flop provider, configures a private event, invites participants, and receives an organizer fee share. |
| Third-party betting company | Adds the game to its own platform and receives the remaining agreed fee share in that distribution model. |
| Club organizer | Runs events for its own player database; may also be the flop provider. |

The earlier discussion of clubs having "shares" is now understood as **shares of fee revenue**. Equity ownership has not been established as part of the current model.

## 4. Club subscription and Poker Lobby

**Confirmed:** poker clubs can buy a monthly platform license. This subscription enables a club to create a room in the Poker Lobby, containing one or more tables streaming live poker from the club.

### User navigation

Poker Lobby → Club profile / room → Live table → Available flop bets → Bet confirmation → Result and payout.

### Proposed club dashboard

- Club identity, branding, profile, and room details.
- Monthly subscription and table entitlements.
- Table creation and live-stream connections.
- Staff accounts and operational permissions.
- Controls to start, pause, and manage betting rounds.
- Event scheduling and invitations.
- Reports covering viewers, participation, bets, fees, and settlements.

### Open subscription decisions

- Monthly price and whether there are multiple tiers.
- Table limits and features included in each tier.
- Club onboarding and verification requirements.
- Billing, renewal, cancellation, and suspended-subscription behavior.
- Provider availability and service expectations.

The monthly software subscription is separate from event fee sharing. Required operating permissions for the online model remain a launch-planning question; the subscription itself does not resolve that question.

## 5. Prize pools and fee sharing

**Confirmed:** total buy-ins form the gross prize pool. A fee is deducted, and that fee is shared among the relevant participants.

Let:

- **B** = total collected buy-ins.
- **F** = the deducted fee.
- **P** = the net prize pool available for player prizes.

Then:

**P = B − F**

**PreFlop share + provider share + organizer / distribution share = F**

If the fee is later defined as a percentage r of buy-ins, then F = B × r. This is a possible formula, not an agreed rate or fee structure.

Revenue shares apply to the deducted fee, not to the players' remaining prize pool. The applicable shares must together allocate 100% of F.

### Model A — Club's own players

The poker club brings players from its own database. PreFlop receives its agreed percentage of the fee; the club receives the rest.

If the same club acts as both provider and organizer, its role-based shares are combined into one club entitlement. The fee is not deducted twice.

### Model B — Third-party betting platform

A betting company integrates PreFlop into its platform. The fee is divided among:

1. PreFlop.
2. The poker club providing the live flop.
3. The third-party company, which receives the remaining agreed portion.

### Model C — User-organized tournament or challenge

A user selects a flop provider and organizes an event for invited people. The fee is divided among:

1. PreFlop.
2. The selected provider club.
3. The user organizer, who receives the **largest individual share**.

"Largest share" does not establish a particular percentage or necessarily mean more than 50%.

### Model D — Club-organized event

The club can be the organizer. Fee allocation follows the provider and organizer roles. If one club fills both roles, its entitlements are aggregated.

**Open:** the allocation when an organizing club selects a different club as its provider.

### Fee rules still to define

- Fixed fee, percentage fee, or another structure.
- Fee timing: collection, event start, or settlement.
- Percentages for each distribution model.
- Who sets those percentages and whether they vary by provider or event.
- Attribution of a participant to a club, third party, or user-organized event.
- Refunds, canceled events, rounding, and payout timing.
- Who collects buy-ins, holds balances, and executes payouts.
- How standalone flop betting uses the pool model versus tournament buy-ins.

**Proposed:** participants see the buy-in, fee, net prize pool, and prize rules before joining. Those terms are fixed for the event once entries are accepted.

## 6. User-created tournaments and challenges

**Confirmed:** a user creating an event must choose a FLOP provider from a list. The user can configure a tournament or challenge and invite people.

### Proposed creation flow

1. Choose tournament, heads-up, or challenge.
2. Select a provider club from the available list.
3. Select an available live table or provider slot.
4. Set the start time, buy-in, and participant limits.
5. Choose allowed bet markets, number of rounds, scoring, and prize distribution.
6. Review the fee, net prize pool, and organizer share.
7. Create invitations and admit participants.
8. Run the event using the selected provider's live flops.
9. Finalize results, prizes, and fee allocations.

Steps beyond selecting a provider, configuring an event, and inviting people are proposals requiring detailed rules.

### Formats

| Format | Current status |
|---|---|
| Tournaments | Requested; round structure, scoring, elimination, and prizes are open. |
| Heads-up | Requested; could be a two-user flop-prediction contest, subject to confirmation. |
| Challenges | Requested; objectives, duration, eligibility, and rewards are open. |
| Scheduled club events | Proposed way to organize provider availability and participation. |
| Leaderboards | Proposed supporting feature; scoring and ranking rules are open. |

**Important unresolved distinction:** individual flop bets settle at the flop, but tournament winnings may depend on the full event. The relationship between per-flop balances or points and the final tournament prize pool must be defined.

## 7. Flop betting catalogue

**Confirmed direction:** PreFlop controls which betting options are offered. Requested examples include one pair, colour, rainbow, all cards below a number, all face cards, a straight, and the sum of the cards.

The following catalogue expands those examples into proposed market families. It does not assign odds or imply every market should launch immediately.

### A. Rank patterns

1. Exactly one pair.
2. Three of a kind.
3. All three ranks different.
4. A pair of a specified rank, such as kings.
5. A paired rank below or above a chosen threshold.
6. A pair plus a face-card kicker.

### B. Suits and colours

7. Rainbow: three different suits.
8. Two-tone: exactly two distinct suits.
9. Monotone: all three cards share a suit.
10. All hearts, all diamonds, all clubs, or all spades.
11. All red or all black.
12. Exactly zero, one, two, or three red cards.
13. Exactly N cards of a chosen suit.

**Open:** whether the label "colour" means one suit or the red/black colour of cards. The interface should use unambiguous names once agreed.

### C. High / low and rank ranges

14. Every card strictly below X.
15. Every card strictly above X.
16. Every rank within a chosen interval.
17. At least one card above or below X.
18. Exactly N cards above or below X.
19. Highest card has rank X.
20. Lowest card has rank X.

### D. Face cards and named ranks

21. All face cards: J, Q, or K—the proposed meaning of "all images."
22. No face cards.
23. Exactly one or two face cards.
24. At least one ace.
25. No aces.
26. Exactly N aces.
27. Contains a specified rank.
28. Contains a specified exact card.
29. All cards have Broadway ranks: 10, J, Q, K, or A.
30. Contains both an ace and a king.

### E. Sequences and gaps

31. Three consecutive distinct ranks—the proposed three-card "straight" market.
32. Three consecutive ranks, all of the same suit.
33. At least one adjacent-rank pair.
34. No adjacent ranks.
35. Three distinct ranks with one gap.
36. An exact rank set, such as 7–8–9.
37. Highest rank minus lowest rank above or below X.

Sequence terminology must be defined specifically for the three-card flop. Ace-low, ace-high, and gap rules remain open.

### F. Totals and parity

38. Rank sum above or below a chosen line.
39. Rank sum inside a chosen range.
40. Exact rank sum.
41. Odd sum.
42. Even sum.
43. Exactly N odd-valued cards.

Ace and face-card numeric values must be agreed before these markets can be evaluated.

### G. Combined conditions

44. A pair and all cards red.
45. Rainbow and every card below X.
46. Consecutive ranks and rainbow suits.

Combined conditions need their own outcome evaluation and probability treatment. Their constituent conditions may overlap and cannot be assumed independent.

### Proposed first-release markets

Start with a limited set: pair, trips, rainbow, two-tone, monotone, all red / all black, face-card count, all below X, and sum over / under. Add sequences, exact ranks, and combined markets after the rules and settlement system are validated.

## 8. Market definitions and payout design

Each offered market needs a written specification covering:

- Market name and plain-language explanation.
- Eligible target round and betting window.
- Exact winning condition.
- Card-value conventions and boundary rules.
- Stake or entry rules.
- Payout calculation or tournament scoring.
- Void and refund conditions.
- Worked examples of wins and losses.

**Proposed default:** evaluate the flop as an unordered set unless a market explicitly depends on dealing order.

**Open payout architecture:** fixed odds, pooled winnings, tournament points, or a combination. The pool-and-fee model is confirmed, but how it determines individual winning-bet payouts is not yet specified. No odds have been calculated.

## 9. Live operations and integrity

The following are proposed implementation requirements for reliable live operation:

- Give every club, table, hand, and betting round a stable identifier.
- Use an authoritative host-side event to lock betting before physical card exposure.
- Track video timing separately from the betting state.
- Capture and verify the actual three-card flop.
- Retain evidence and timestamps for round transitions and results.
- Process each bet settlement once, including during retries or reconnects.
- Keep a balance ledger and separate records for prizes and each fee recipient.
- Pause or void affected rounds when the stream or result feed is unreliable.
- Define handling for no-flop hands, incorrect card reports, canceled events, and provider outages.

**Open:** card capture could use staff entry, card-reading equipment, or another verified process. No method has been selected.

## 10. Proposed application screens

### Player experience

- Poker Lobby and club discovery.
- Club room and available live tables.
- Live table with clear current-hand and target-flop labels.
- Market list and bet slip.
- Bet confirmation, pending bets, and settled results.
- Balance, prize, fee, and transaction history as applicable.
- Event discovery, invitations, and participation.

### Organizer experience

- Provider selection and availability.
- Tournament / challenge setup.
- Fee and prize-pool preview.
- Invitation and participant management.
- Live standings and final results.
- Organizer fee report.

### Club and platform operations

- Club subscription and room management.
- Table streams and round controls.
- Result verification and exception handling.
- Role and staff management.
- Partner integrations and revenue allocation reports.
- Platform-level support and operational audit views.

## 11. Proposed data model

| Relationship | Purpose |
|---|---|
| Club → Room → Table | Represents the physical provider in the lobby. |
| Table → Hand → Flop round | Identifies the exact source of a result. |
| Round → Markets → Bets → Settlements | Connects accepted bets to outcomes. |
| User → Ledger → Entries | Tracks financial or play-chip movements, subject to the chosen model. |
| Club → Subscription → Entitlements | Controls subscription-enabled platform features. |
| Event → Provider + Organizer + Participants | Records who supplies and runs each event. |
| Event → Buy-ins + Fee policy + Prize rules | Defines the event's pool and allocation terms. |
| Fee → PreFlop + Provider + Organizer / Partner | Records the fee split without double counting. |
| Third-party partner → Integration + Attributed events | Supports external distribution and reporting. |

## 12. Delivery roadmap

### Phase 1 — Agree the rules

- Select the first provider club and launch territory.
- Decide play chips versus real money and the operating model.
- Define the initial markets, numeric card values, and sequence rules.
- Specify the fee basis and commercial splits.
- Specify standalone bet payouts and tournament scoring / prizes.
- Resolve provider result capture and the physical betting cutoff.

### Phase 2 — Prototype a complete cycle

- Sketch lobby, room, live table, bet slip, and result screens.
- Demonstrate one complete flop betting round.
- Show betting rolling over to the next flop during the current hand.
- Demonstrate fee allocation and prize-pool accounting with test values.

### Phase 3 — One-club pilot

- One partner club and one live table.
- Initial market catalogue.
- Authoritative round controls and verified results.
- Bet history, balance ledger, and settlement reports.
- Controlled participant group and operational support.

### Phase 4 — Creator events

- Provider selection.
- Private tournaments and challenges with invitations.
- Explicit buy-in, fee, scoring, and prize rules.
- Organizer fee allocation and reports.

### Phase 5 — Expansion

- Additional tables and provider clubs.
- Third-party platform integrations.
- Additional event formats and betting markets.
- Optional leaderboards and scheduled competitions.

The phase order is proposed, not a committed delivery schedule.

## 13. Verification and pilot measures

Before a live pilot, verify:

- Bets cannot be accepted after the authoritative cutoff.
- A bet never moves accidentally to a different target flop.
- Every supported card pattern produces the correct result.
- Retries do not duplicate settlements or fee allocations.
- Buy-ins reconcile to net prizes plus the deducted fee, accounting explicitly for refunds.
- Fee recipients collectively receive exactly the allocated fee.
- Provider and organizer roles belonging to one club are handled correctly.
- Stream delay, dropped connections, no-flop hands, and canceled events have defined behavior.
- Tournament totals and tie outcomes match the published rules.

Proposed pilot measures: round-result accuracy, settlement time, failed or voided rounds, reconciliation discrepancies, repeat participation, and organizer / club support issues.

## 14. Decisions still open

1. Real money or play chips, first territory, and responsible betting operator.
2. Required permissions for the intended online distribution model.
3. Monthly subscription prices and entitlements.
4. Fee basis, deduction timing, and percentages for each commercial model.
5. Fixed odds, pooled payouts, points, or another bet-resolution model.
6. Relationship between immediate flop settlement and final tournament prizes.
7. Provider card capture, verification, and cutoff mechanism.
8. Meaning of colour; ace and face-card values; sequence and threshold rules.
9. Tournament scoring, duration, prize schedules, ties, and participant limits.
10. Cancellation, refunds, outages, and events with no valid flop.
11. Web, mobile, or both.
12. Exact third-party integration and settlement responsibilities.

## 15. Current project status

The Excalidraw board contains the product model, club-hosted platform plan, expanded flop betting catalogue, and fee-sharing / creator-event model. This document consolidates that plan for reading and further refinement. Software implementation, odds calculation, commercial percentages, and launch approvals are not completed by this planning document.
