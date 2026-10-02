# 08 — Play Modes and Currencies

PreFlop runs the same live flop game in five modes. Each mode has its **own currency, wallets and ledger accounts**, and balances never move from one mode to another. The code is in `packages/odds-engine/src/modes.ts` and `globalRules.ts`.

| Mode | Currency | How players get it | Cash out | Fees / rake | Who can be the house | Licence |
|---|---|---|---|---|---|---|
| **Real money (fiat)** | EUR (cents) | Deposits | Yes, after KYC | Yes | PreFlop, a licensed organizer or partner, or a pool | Yes |
| **Real money (crypto)** | **USDT / USDC only** (6 decimals) | On-chain deposits | Yes, after KYC and Travel Rule checks | Yes | Same as fiat | Yes |
| **Play money** | PLAY | Free; **the player can reset the balance at any time** | Never | **None** | PreFlop (virtual) or a pool | No |
| **Virtual chips** | CHIP | Bought from PreFlop with EUR or USDT/USDC (100 chips = €1, placeholder), **or given to players by poker clubs and organizers via online transfer** | Never | Yes, the organizer sets them within global bounds | PreFlop, an organizer, or a pool | No* |
| **Diamonds** | DIAMOND | Organizers buy them from PreFlop **with EUR or crypto (USDT/USDC)** and transfer them to their players | Never on PreFlop | A fixed PreFlop fee per bet, plus organizer rake within global bounds | **The organizer** or a pool | No* |

\* Purchased currencies that cannot be cashed out are treated as social gaming in many territories, but not all. Get legal advice for each territory before launching chips or diamonds there.

## How each mode works

**Play money: fun only.**
- Uses the same odds book as real money, so the game feels identical.
- No fees and no revenue. Nobody earns or loses anything real.
- The player can **reset the balance to the starting amount at any time**, so running out is never a problem.
- Its job is to bring in and teach new players, and to give clubs a way to demo PreFlop to their members.

**Virtual chips: players buy fun currency.**
- Players get chips in two ways:
  - they **buy** them from PreFlop with EUR or USDT/USDC;
  - their **poker club or organizer gives them chips by online transfer** (`POST /v1/chips/transfers`). The club or organizer first buys the chips from PreFlop, then sends them to its members, for example as a welcome balance, a prize or a loyalty reward.
- Every transfer is recorded in the ledger (from, to, amount, reason) and has limits per sender.
- Fees apply. In pools and contests, the rake leaves the chip economy, so players or their clubs buy more chips.
- PreFlop's real revenue is chip sales. That revenue is shared with the room organizer and the provider club in proportion to the rake their rooms produced (see `docs/profitability.md`, chips scenario).

**Diamonds: organizers buy currency and set their own rules.**
- An organizer (a club, community, streamer or betting company) buys diamond packs, with volume discounts. It can pay **in EUR or in crypto (USDT/USDC)**, and crypto purchases are credited after on-chain confirmation.
- The organizer transfers diamonds to its players online (`POST /v1/diamonds/transfers`). Every transfer is in the ledger.
- The organizer configures its room within the global rules: rake %, minimum stake, and who gets a share of the rake.
- Every diamond bet is split **at placement**, and the split is stamped on the bet:

  ```
  stake = PreFlop fixed fee (1 ◆, sunk) + organizer rake (split by predefined shares) + at-risk amount
  ```

  The at-risk amount plays against the organizer's house, or goes into a pool.
- PreFlop's fixed fee **leaves the organizer's economy** on every bet. The organizer's supply shrinks with play, and the organizer rebuys. This is PreFlop's diamond revenue.
- The **dilution tracker** reports, for each organizer:
  - diamonds bought and in circulation;
  - diamonds sunk to PreFlop;
  - rake collected for each holder;
  - the house's net result;
  - how many times a diamond is staked before it is consumed;
  - how many bets the remaining stock supports.
- Provider clubs in diamond rooms are paid **in EUR** from PreFlop's diamond revenue (placeholder: 20%). Diamonds stay a closed loop, and clubs still earn real money.
- The global rules guarantee that the fixed fee is never more than 5% of the minimum stake. The defaults are a 1 ◆ fee and a 20 ◆ minimum stake.

**Real money: fiat and stablecoins.**
- Licensed territories only. KYC, responsible gaming limits and AML apply.
- Crypto accepts **USDT and USDC only**, so stakes, odds and payouts keep a stable value and nobody carries price risk.
  - Each user gets a custodial deposit address.
  - Funds are credited after N confirmations.
  - Withdrawals go through a queue with AML / Travel Rule screening.
  - Amounts are kept to 6 decimals in integer minor units.
  - USDT and USDC have **separate accounts** (`<owner>:<purpose>:<mode>:<currency>`), so one token can never fund a bet in the other.

## Global rules (placeholders, `globalRules.ts`)

| Rule | Value |
|---|---|
| Minimum margin on an organizer-run book | 3% (tier floors 5–15% still apply per market) |
| Platform fee on organizer-house bets (money and chip modes) | 1.5% of stake, minimum 2 minor units per bet |
| Minimum expected value the organizer must keep after fees | 0.5% of turnover |
| Diamond fee to PreFlop | **1 ◆ per bet, fixed** |
| Diamond minimum stake | 20 ◆ |
| Diamond organizer rake | 0–15% |
| Diamond price | €1.00 per 100 ◆, falling to €0.70 per 100 ◆ for 10M+ ◆ |
| Chips organizer rake | 3–15% |
| Pool / contest rake | 5–20% |
