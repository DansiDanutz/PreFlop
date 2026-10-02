# 16 — Leaderboards, prize pools, promotions and agents

The owner's decisions, 2 October 2026:
- prize pools may be funded from all four sources;
- play-money boards pay **free chips and badges only**;
- all four ranking metrics are available;
- agents are paid on **two levels, on net gaming revenue (NGR)**.

These rules stay in force:
- physical-table play is disabled;
- real money stays off until a licence exists;
- free chips have no cash value.

Everything below runs on the balanced ledger (`lib/ledger.ts`). Every movement of value is a `post()` with a unique `(kind, ref)`, so a retry can never pay twice.

## 1. Leaderboards

A **leaderboard** ranks players over a period, in one currency:

| Field | Values |
|---|---|
| `owner` | PreFlop (null) or an organization (club or organizer). Chip and diamond boards always have an organization owner, because those currencies live in its closed loop; their prizes land in the winner's wallet for that organization (`org_required` otherwise) |
| `mode`, `currency` | `play`/PLAY, `diamonds`/DIAMOND, `virtual-chips`/CHIP, `real-fiat`/EUR, `real-crypto`/USDT·USDC |
| `scope` | `global`, one club's tables (`org`), one table, or one room |
| `metric` | `net` (returned − staked), `volume` (staked), `roi` (returned ÷ staked), `points` (each correct prediction scores `round(odds × 10)`) |
| `period` | `starts_at` … `ends_at` (daily, weekly or monthly presets in the UI) |
| `min_rounds` | the number of settled rounds needed to qualify (defaults: `roi` 20, `net` 10, otherwise 1) |
| `prize_split_bps` | the share of the pool per rank, e.g. `[5000, 3000, 2000]`; it must sum to 10,000 |
| `status` | `scheduled` → `active` → `settled` (or `cancelled`) |

**Standings** are computed live from settled and voided bets in scope and period: `bets` joined to `rounds` and `poker_tables`. Voided bets do not count. Self-excluded and suspended users are left out.
- Ties are broken by fewer rounds, then by who reached the score first.
- Players see their own rank and the top 50.
- A board on an invite-only room is visible only to those who can see the room: its members, the organization's portal members and the PreFlop team. Everyone else gets `404`, and the board is left out of the list.

**Responsible gaming:** a `volume` board shows a "volume rewards activity" note. A setting can switch volume boards off, and that setting defaults to **on** for play money only.

## 2. Prize pools (the jackpot)

Every leaderboard owns a pool account: `leaderboard:<id>:pool:<mode>:<currency>`. Four sources can fund it, configured per board:

| Source | How | Allowed for |
|---|---|---|
| **PreFlop margin %** (`margin_bps`) | A worker accrual every 5 minutes. It takes PreFlop's house result in scope (stakes − payouts on `PreFlop:bankroll`) since the last accrual and moves `margin_bps` of any positive result into the pool (`pool.accrue`). Losses are not clawed back. | diamonds, chips, real (play money uses sponsor issuance instead) |
| **Club or organizer funded** (`fund`) | The owner moves a fixed amount from its treasury into the pool, at creation or later. It is held there like collateral. | chips, diamonds, real |
| **Player contribution** (`contribution_bps`) | At settlement of each bet in scope, `contribution_bps` of the stake moves from PreFlop's bankroll share into the pool. The player's price is unchanged: the contribution comes out of the house edge, so the odds book stays proven. | **real money only**, so it is blocked while real money is off |
| **PreFlop sponsored** (`sponsor`) | A fixed amount, posted when the board is created. For play money it is issued (`PreFlop:play-issuance`); for other currencies it comes from `PreFlop:marketing`. | all |

**Paying out:** at `ends_at` the worker closes the board. It takes the final standings and pays `prize_split_bps` of the pool to the qualifying ranks in order (`pool.payout`, ref `<board>:<rank>`). It awards badges, and anything unallocated (fewer qualifiers than prize ranks, or rounding) returns to whoever funded the board, pro rata (`pool.return`).
- **Play money:** prizes are free chips into `wallet:play`, plus badges (`champion`, `podium`, `top10`). There are never diamonds, real money or goods. The UI says "Free chips. No cash value."
- **Real money:** creating and funding a board requires `modes_enabled` for that mode. Today the API refuses real-money boards with `403 mode_disabled`.
  - Settlement waits while the mode is switched off. The board settles once the mode is back on, or the team cancels it and the pool returns to its funders.
  - Only verified (KYC), active players can take a prize. Anyone else steps aside and the ranks close up. Self-excluded and suspended players are already out of the standings. Responsible-gaming limits cap deposits and losses, so they do not block a prize credit.

## 3. Promotions

A promotion is a player-facing offer with an owner (PreFlop or an organization), a window, an audience and a type:

| Type | What the player gets |
|---|---|
| `announcement` | A card with text and a link (e.g. "New table at Atlas"). |
| `leaderboard` | A card that links to a leaderboard and shows its pool. |
| `free-chips` | **Claim** N free chips, once per player (`promo.claim`, ref `<promo>:<user>`). PreFlop only. |
| `org-drop` | An organizer or club gives N chips or diamonds from its treasury to each player who claims, once, within a budget. Only players already in the organizer's rooms are eligible. |

**Lifecycle:** `draft` → `pending_review` (club or organizer promotions) → `approved` → shown between `starts_at` and `ends_at`. PreFlop's own promotions skip review. The PreFlop team (admin, ops) approves or rejects with a reason, and every decision is audited.
- The budget is enforced in the claim transaction by locking the promotion row: claims stop when it would go over.
- Promotions never offer real-money bonuses while real money is off. Wording rules from `docs/15` apply: no pressure and no "last chance".

## 4. Agents (two-level affiliate)

- An **agent** is a user approved by the PreFlop team (admin or ops). Each agent has a referral code and rates:
  - `rate_l1_bps` (≤ 4,000) on the NGR of the players they referred;
  - `rate_l2_bps` (≤ 1,000) on the NGR of the players referred by agents they recruited.
- An agent may have one parent agent, and that parent must be a top-level agent. An agent who already has sub-agents cannot be given a parent. **Depth is therefore capped at two levels**: an agent's commission never reaches a third level.
- **Applying:** a player applies from their profile (`applied`). The team approves with rates and an optional parent (`active`), or rejects. A rejected player may apply again. An active agent can be `suspended`; their code then stops binding new players.
- **Referral:** a player who registers through `/register?ref=CODE` (the app sends `ref` in the register body) is bound to that agent for good (`users.referred_by_agent`). Unknown, inactive or self codes are ignored silently, so registration never fails because of a code.
- **NGR** is per month and currency: settled stakes − payouts − the value of promotions claimed. It counts only modes with cash value (`real-fiat` EUR, `real-crypto` USDT and USDC). Free chips, chips and diamonds never earn commission.
- **Closing a month** builds a statement per agent, currency and level:
  - L1 = `rate_l1 × max(0, ΣNGR(own players) + carry-in)`, where the carry-in is last month's negative balance (zero or less). A negative result is carried out to the next month.
  - L2 = `rate_l2 × max(0, ΣNGR(sub-agents' players))`. Level 2 has no carry.
  - Closing the same month again creates nothing new (unique per agent, month, currency and level).
- Statements go `draft` → `approved` (admin or ops) → `paid` (super admin only). Paying posts `agent.commission` from `PreFlop:marketing` to the agent's wallet in that mode and currency, and needs the mode switched on.
- While real money is off, statements still compute in the sandbox, but none can be paid (`403 mode_disabled`).

## 5. Surfaces

- **Player app:**
  - a **Leaderboards** page with tabs for Free chips, Diamonds and Real money (the last explains it is off), each board's pool, end date, standings and your rank;
  - a **Promotions** page with offer cards and Claim;
  - **Profile → Become an agent** (an application), and the agent's referral link once approved.
- **Console, PreFlop team:**
  - a **Growth** group: Leaderboards (create, fund, close), Promotions (create, review the queue), Agents (applications, rates, tree, statements);
  - settings for volume boards and the commission caps.
- **Console, club and organizer:** Leaderboards (scoped to their tables or rooms, funded from their treasury) and Promotions (create, submit for review, results).
- **Console, agent portal:** referral link, players, sub-agents, monthly statements.

## 6. API (summary)

- Public: `GET /v1/leaderboards?mode=` · `GET /v1/leaderboards/:id` (standings, pool, your rank) · `GET /v1/promotions` · `POST /v1/promotions/:id/claim`.
- Agents: `POST /v1/me/agent/apply` · `GET /v1/me/agent` (code, players, sub-agents, statements).
- Team: `POST/PUT /v1/admin/leaderboards` · `POST /v1/admin/leaderboards/:id/fund|close` · `GET/POST /v1/admin/promotions` · `POST /v1/admin/promotions/:id/decision` · `GET/PUT /v1/admin/agents` · `POST /v1/admin/agents/statements/close?month=` · `POST /v1/admin/agents/statements/:id/approve|pay`.
- Organization: `GET/POST /v1/org/:id/leaderboards` · `POST /v1/org/:id/leaderboards/:lb/fund` · `GET/POST /v1/org/:id/promotions` (they start as `pending_review`).
