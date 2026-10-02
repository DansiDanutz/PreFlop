# PreFlop: Audit Brief (for Codex, Kimi and any reviewer)

**Purpose:** an independent audit of the PreFlop plan before implementation starts. Please challenge anything: maths, rules, economics, security, architecture. Changes are welcome.

**State of the repo:**
- Specification and the mathematical core are done.
- The backend (`apps/api`) implements `docs/13` with PostgreSQL integration tests for its acceptance criteria; the player app, console portals and club tablet are in `apps/`.
- Physical-table play is disabled (owner decision); everything runs on simulated tables.

## 1. What PreFlop is (one paragraph)

Users bet on the 3-card **flop** dealt live at licensed poker clubs:
- against **the house** (fixed odds);
- against **each other** (pools, tournaments, challenges);
- inside **organizer rooms** that use diamonds or chips.

Clubs supply tables and live video. Betting companies integrate through an API. Organizers run their own rooms. Each participant earns a **dynamic share** of revenue. The founder's original plan is `docs/00-business-plan.md`.

## 2. Map of the repo

| Area | Where |
|---|---|
| Business plan (source of record) | `docs/00-business-plan.md` |
| Architecture, round lifecycle, data model | `docs/01-architecture.md` |
| APIs: Provider (clubs), Partner (betting companies), Player | `docs/02-integration-api.md` |
| Market rules and card conventions | `docs/03-market-rules.md` |
| House edge, odds pricing, exposure, integrity | `docs/04-house-edge-and-risk.md` |
| Fees, pools, tournaments (P = B − F) | `docs/05-fees-pools-tournaments.md` |
| Decisions (with status) and roadmap | `docs/06-roadmap-and-decisions.md` |
| Unit economics: net EV after costs | `docs/07-unit-economics.md` |
| Play modes: fiat, USDT/USDC, play money, chips, diamonds | `docs/08-play-modes-and-currencies.md` |
| Dynamic revenue sharing | `docs/09-dynamic-revenue-sharing.md` |
| Who pays the winnings (house models) | `docs/10-who-pays-the-winnings.md` |
| Club requirements: shuffler, cut, connectivity | `docs/11-club-requirements.md` |
| Table hardware, live stream, Table Box security, signed evidence | `docs/12-table-hardware-and-security.md` |
| **Phase 1 backend spec (to implement)** | `docs/13-phase1-backend-spec.md` |
| Generated odds book (every market's probability, odds, net EV) | `docs/odds-book.md`, `docs/odds-book.json` |
| Generated profit per participant (8 scenarios) | `docs/profitability.md` |
| Engine code (TypeScript, 131 tests) | `packages/odds-engine/src/*` |

Run it:

```bash
pnpm install && pnpm test && pnpm typecheck && pnpm build
pnpm book    # regenerate odds book and profitability
```

## 3. Invariants the engine guarantees (please try to break them)

1. **Exact probabilities.** Every market is evaluated on all C(52,3) = 22,100 flops.
2. **The house always has the edge on fixed odds.**
   - Odds are `floorToTick((1 − m) / p)`.
   - The margin `m` is the larger of a tier floor (5–15%) and the margin needed for a **net** EV target after revenue shares, promotions and variable costs.
   - Tested for every offered selection on every channel.
3. **Money is exact.**
   - Integer minor units throughout.
   - Fee and share splits use the largest-remainder method and always sum exactly.
   - Shares never exceed 100%.
   - Ledger postings balance, and each currency (USDT, USDC, EUR…) has its own accounts.
4. **Exposure is exact.** The worst-case house loss over all 22,100 flops is checked before every bet. An organizer's collateral must cover its worst case plus PreFlop's fees.
5. **Integrity:**
   - Betting closes **before hole cards exist**.
   - The deck is shuffled **after** the lock, by the PreFlop Trusted Shuffler, on a single-use command nonce that its signed completion must attest. The cut depth is random and drawn after that. **The cut is not a defence against a shuffler that controls the deck order** (audit F01). Shuffle integrity needs the Trusted Shuffler and outcome monitoring (`docs/12` §2a).
   - A broken lock → shuffle command → shuffle → cut → deal sequence (checked on server-assigned ordinals, never on timestamps) voids the hand.
   - **Physical-table play is disabled in every mode, including play money** (owner decision).
6. **Evidence.** A flop settles only when all three hold:
   - an Ed25519-signed, hash-chained Table Box capture verifies;
   - the image hash matches;
   - both the dealer's and the floor's entries match.

   Otherwise the round goes to review or is rejected.
7. **Live stream is mandatory.** No stream, or players visible in the stream, means no betting, or a switch to a board-only view.

## 4. Key decisions taken, with the reasoning

| Decision | Why | Where |
|---|---|---|
| Lock at **Start hand**, not at the flop reveal | One player's two hole cards give up to +12.8% on some markets, which beats the margin | `docs/04` §4 |
| Shuffle integrity rests on a **PreFlop Trusted Shuffler plus outcome monitoring**. The random cut is only a minor extra control | The 2026-10-02 audit (F01) showed that the cut does **not** defeat a shuffler that controls the deck order. **Owner decision: physical-table play is disabled in every mode, including play money.** Certification is a prerequisite for reconsidering, not automatic enablement | `docs/12` §2a |
| PreFlop never reads hole cards | Leaks from hole-card data in past cheating scandals | `docs/12` §1 |
| Ace = 14 everywhere; A-2-3 and Q-K-A count as straights; colour = red/black | Avoids rules that are open to interpretation | `docs/03` §1 |
| Three ways to resolve bets: fixed odds, parimutuel pools, contests | Keeps house risk separate from player-vs-player play | `docs/01` §3 |
| Organizer-as-house posts collateral; PreFlop takes a risk-free fee | PreFlop never pays an organizer's winners | `docs/10` |
| Diamonds: fixed 1 ◆ PreFlop fee per bet, sunk; provider clubs paid in EUR | The founder's rule; keeps diamonds a closed loop | `docs/08` |
| USDT and USDC only for crypto | No price volatility on stakes or the bankroll | `docs/08` |

## 5. Placeholders that need real numbers (from the founder and commercial team)

- **`packages/odds-engine/src/costModel.ts`:** the net EV target (2.5%), revenue shares per channel, payment/KYC/operations costs, fixed costs and subscription price.
- **`globalRules.ts`:** the platform fee (1.5%), the diamond fee, minimum stake and price, and rake bounds.
- **`sharing.ts`:** share tier ladders for clubs, providers, partners and pool creators.
- **`scenarios.ts`:** activity levels used in `docs/profitability.md`.
- **`tableReadiness.ts`:** connectivity thresholds (20 Mbps upload, 150 ms RTT, 3 s video delay).
- **`docs/12` §8:** equipment cost estimates (rough).

## 6. Questions we specifically want the auditors to answer

1. **Maths and pricing.**
   - Are the market rules unambiguous?
   - Any market whose odds could be exploited, for example through correlated selections or information timing?
   - Are the tier margins competitive yet safe?
2. **Integrity.**
   - Can any party (dealer, floor, club, player, organizer, insider) still learn or influence the flop before the lock?
   - Is the Trusted Shuffler plus monitoring plan in `docs/12` §2a sufficient? (The random cut alone was shown NOT to be: F01.)
   - What else would you require?
3. **Evidence chain.**
   - Weaknesses in the Table Box design (TPM key, attestation, outbound-only network) or in `verifyCapture`?
4. **Economics.**
   - Are the net-EV formula, the share guardrail and the per-participant P&L sound?
   - Is any participant structurally unprofitable?
5. **Organizer house and diamonds.**
   - Is the collateral and fee model safe?
   - Is the diamond sink and dilution design coherent?
6. **Backend spec (`docs/13`).**
   - Is the round state machine right?
   - Any concurrency hole between bet placement and the lock?
   - Is the ledger design sound?
   - What would you change before implementing?
7. **Regulation.** Which parts need licensing or legal review per territory: real money, crypto, chips, diamonds, streaming of dealers?
8. **Gaps.** What is missing for a one-club pilot?

## 7. How to report

For each finding, give:
- **severity** (blocker, major, minor);
- **file and section**;
- **what's wrong**;
- **a concrete fix**.

Where possible, add a failing test or a worked example. Proposed changes can go straight in as PRs.

## 8. Audit history

### Round 1: Codex, 2026-10-02 (audited `15c172f`)

Verdict: *request changes*. Every finding was accepted. Where each one now stands:

| # | Severity | Finding | Status |
|---|---|---|---|
| F01 | Blocker | The random cut does not defeat a compromised shuffler | **Accepted.** The claim was removed everywhere. `docs/12` §2a adds the PreFlop Trusted Shuffler, outcome monitoring, limits and a threat-model review. The attack is reproduced as a regression test. Physical play is now disabled entirely (see round 2) |
| F02 | Major | Capture retry fails after a lost success response | Fixed in the spec: identical-record replay returns the original `200` in any round state, checked before any state or sequence check |
| F03 | Major | Invalid signed content opens betting on the next hand | Fixed in the spec and engine: chain ingestion is separate from **admission** (`captureAdmissionProblems`). Only an admitted capture moves the round to DEALT and opens N+1 |
| F04 | Major | Resolution has no concurrency contract | Fixed in the spec: every round operation takes the round row lock, lock order is fixed, a durable outbox drives `resolve_round`, and concurrency and crash tests are added |
| F05 | Major | Shared staff credential | Fixed in the spec: per-person, per-role credentials; the entry source comes from the role; the two entries must come from different people; void and review are `floor_manager` only |
| F06 | Major | HMAC not bound to the route | Fixed in the spec: a canonical signed envelope (method, path, query, timestamp, nonce, idempotency key, body hash), single-use nonces, credentials scoped to one table |
| F07 | Major | Money helpers accept invalid values and lose precision | Fixed in the engine: validated odds, stakes and fees; exact safe-integer bounds; regression tests |
| F08 | Major | Missing organizer id selects a shared account | Fixed in the engine: `organizerId` is required by type and checked at runtime; `PreFlop` is reserved |
| F09 | Major | Duplicate share parties overwrite each other | Fixed in the engine: duplicates and the reserved `PreFlop` id are rejected |
| F10 | Major | Organizer EV checked only at the typical stake | Fixed in the engine: EV is validated at the room's **minimum** stake (the worst case for the fee rate); `assertOrganizerStake` refuses smaller stakes |
| F11 | Minor | The evidence API didn't match the spec | Fixed in the engine: `verifyCaptureAuthenticity`, `captureAdmissionProblems`, `verifyCaptureContent`; `verifyCapture` composes them |
| F12 | Minor | The checked-in ruleset isn't active protection | Template now targets `main` explicitly. **Closed in round 2:** the default branch is `main`, and ruleset 24343697 "Protect main" is active (verified live by Codex) |

Also from the audit's answers, both now added to the spec: certification items carry provenance (who and when) and an expiry, and stacked-deck monitoring has an acceptance test.

### Round 2: Codex re-audit, 2026-10-02 (audited `8cb639b`)

Verdict: *request changes*. F02, F03, F05, F06 and F11 materially addressed; F07–F09 counterexamples rejected; F12 closed by verified settings. Responses:

| # | Finding | Status |
|---|---|---|
| Owner decision | Keep physical-table play disabled, **including non-redeemable play money**. Certification is a prerequisite for reconsideration, not permission | **Applied** in `AUDIT.md`, `docs/06` (decision 7 and phase 2), `docs/12` §2a and `docs/13` §1. Simulated practice is a separate scope |
| R2-1 (F10) | The minimum-stake fee rate is not always the maximum (fee 2 at 199, 3 at 200) | **Fixed in the engine.** `feeRateUpperBound()` is a proven bound over every stake ≥ the minimum: `max(minPerBet/minStake, fixed/minStake + bps)`. `validateOrganizerHouse` uses it, so Codex's 199-stake configuration is now rejected. `assertOrganizerBet()` adds an exact per-bet admission check (true win count, integer payout and fee). Regression tests cover 199→200 and the fee-jump boundaries |
| R2-2 (F04) | Bet placement reversed the lock order | **Fixed in the spec.** One global order: one round (`FOR SHARE` for bets, `FOR UPDATE` otherwise) → device → wallets in ascending id; never a round lock while holding a wallet. The "never deadlock" claim is replaced by a design argument plus a backstop: `40P01`/`40001` roll back and retry up to 3 times with jitter. Tests: bet versus void/settlement on the same wallet, injected deadlock |
| R2-3 | Terminal transition blocked review settlement | **Fixed in the spec.** The compare-and-set uses an explicit expected source state: `DEALT` for `resolve()`, `REVIEW` for `resolveReview()`. The review deadline is checked inside the review transaction. Tests: review-settle versus void, late review decision |
| R2-4 | Post-lock trusted shuffle contradicted the lifecycle | **Fixed in the spec and engine.** One sequence: Start hand (lock + shuffle command nonce) → fresh trusted shuffle signed for the nonce → random cut → cut → deal-start, enforced as substates. `handProcedureProblems()` now checks this order on server ordinals and the nonce binding. Physical play stays disabled; this is a future-enablement prerequisite |
| R2-5 | Rejected-evidence refunds not explicitly durable | **Fixed in the spec.** Entering EVIDENCE_REJECTED enqueues a `void_round` outbox job in the same transaction; the sweeper voids EVIDENCE_REJECTED rounds immediately as a backstop. Test: crash after rejection, before refund |
| Note | Generic write idempotency and procedure ordinals | **Added to the spec:** `idempotency_responses` (stored response written with the effect) for every non-bet write; `round_events` with server-assigned ordinals |

**Distinction kept, as requested:** every backend item above, and the three Greptile-driven changes at `8cb639b` (atomic terminal transition, deadline at settlement, checkpoint sync), are **specification** fixes. They become executed guarantees only when the backend's PostgreSQL integration tests in `docs/13` §8 pass. The engine items (R2-1, R2-4's procedure check) are executed and tested now.

### Round 3: found while implementing the backend (2026-10-02)

| # | Finding | Status |
|---|---|---|
| I-1 | `OrganizerCollateral` reserved only each round's net loss (−minNet), but the ledger balance it is compared with already contains the open rounds' stakes. Example: an organizer with 850 plus a posted 100 stake (balance 950) could accept a bet paying 1,000 | **Fixed in the engine and the backend:** the reserve is the full worst-case outgo (stakes + certain costs − minNet). A regression test was added (`houses-diamonds.test.ts`), and the room bet path checks it under a per-organizer lock |
| I-2 | The daily deposit limit compared EUR cents with USDT/USDC micro-units | **Fixed:** limits are EUR-equivalent across currencies (integration test) |
| I-3 | The outcome monitor's first calibration (ratio 3, threshold 7) gave 327 false alarms in 50,000 fair flops. Ratio 5 / threshold 14 still alarmed once on the live simulator (atlas-07, after 233 hands); 1,000,000 fair flops measured one false alarm per ~52,600 hands | **Fixed:** ratio 5 / threshold 16 gives one false alarm per ~500,000 hands per table and catches a stacked "all red" deck in 10 hands. The simulator's dealing was checked unbiased over 300,000 hands (`apps/api/src/rounds/monitor.ts`) |

| I-4 | A pool nobody backed refunded only the pooled part, keeping the rake and PreFlop fee (engine rule: full refund, no fee) | **Fixed:** settlement reverses the whole placement; caught by a test that failed on all-black flops (~1 in 17 runs); deterministic regression test added |
| I-5 | Bet placement re-checked the table status before the wallet lock, while settlement posted payouts (FK key-share on wallets) before locking the table — a deadlock CI caught | **Fixed:** settlement locks the table first; global order round → user → table → wallets (`docs/13` §4) |

**Phase 1 exit criterion met:** `pnpm --filter @preflop/api soak` ran 10,000 simulated rounds with 8 random players (80,000 bets). All 10,000 settled, all 10,000 late bets were refused, the ledger sums to zero, and the audit chain verifies. The realised gross edge was 4.3%.

**Now executed, not only specified:** these `docs/13` §8 acceptance criteria are covered by PostgreSQL integration tests in `apps/api/test`:
- terminal compare-and-set;
- deadline voids;
- capture idempotency and conflict;
- durable void of rejected evidence;
- lock order, with no deadlock retries under a bet and settlement race;
- review settlement;
- generic idempotency;
- nonce replay;
- route-bound signatures;
- exposure after a crash;
- 200 simulated hands reconciling to zero;
- stacked-deck detection.
