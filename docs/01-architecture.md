# 01 — System Architecture

Status: **proposed** target architecture. Only `packages/odds-engine` is implemented so far; it is the
pricing, settlement and exposure core that every service below reuses.

## 1. Design goals

1. **The house never prices blind.** Every fixed-odds price comes from exact enumeration of the 22,100 possible flops, plus a margin that clears PreFlop's net-EV target after costs (`docs/04`, `docs/07`).
2. **Bets close before anyone can know a card.** The round's state comes from the club's authoritative signal, never from the video stream.
3. **Integrate anywhere.** A club connects with a tablet and a signed API key. A betting company connects over REST, WebSocket and webhooks, or embeds a widget. A player only needs a browser.
4. **Money is exact and auditable.** Amounts are integers in minor units and the ledger is double-entry. Every write is idempotent, and every round transition and result is in a hash-chained log.
5. **Risk lives apart from player-vs-player play.** Only the fixed-odds book puts house capital at risk. Pools and contests earn a fee and carry no risk.

## 2. Context

```
                ┌──────────────────────── PreFlop Platform ─────────────────────────┐
 Poker club     │                                                                    │   Players
 ─ dealer tab ──┼─► Provider API ─► Rounds ─► Results ─► Settlement ─► Ledger ◄──────┼── Web / mobile app
 ─ shuffler/RFID│        │            │          │            │          ▲          │
 ─ cameras ─────┼─► Stream ingest ────┼──────────┼────────────┼──────────┼──► CDN ──┼── (low-latency video)
                │                     ▼          ▼            ▼          │          │
                │                Bets + Risk ◄─ Odds engine ─ Fees/Pools ─┘          │   Betting companies
                │                     ▲                                             │── Partner API / widget
                │        Events (tournaments, challenges, heads-up)                 │   Organizers
                │        Identity/KYC · Responsible gaming · Back office · Audit    │── Event builder
                └────────────────────────────────────────────────────────────────────┘
```

## 3. Three ways to resolve a bet

| Engine | Who wins against whom | House risk | Revenue | Plan section |
|---|---|---|---|---|
| **Fixed odds** | Player against the house | Yes. Capped by the exposure engine | Margin built into the odds | §7, §8 |
| **Parimutuel pool** | Players against each other on one flop | None | Fee F; P = B − F is shared by the winners | §5 |
| **Contest** (tournament, heads-up, challenge) | Players against each other over many flops | None | Fee F on buy-ins, split by Models A–D | §5, §6 |

Contest scoring (recommended): each participant gets a points stack, places points on markets each round, and a win pays points × **fair odds** (no margin, since nobody plays against the house). The final standings decide the prize schedule from P. This settles each flop's bets immediately (in points) while prizes depend on the whole event, which answers the plan's open question in §6.

## 4. Round lifecycle (authoritative state machine)

```
            open_next(hand N+1)            deal_start(hand N+1)          flop_captured
SCHEDULED ─────────────────────► OPEN ────────────────────────► LOCKED ─────────────────► DEALT
                                  │                               │                         │ confirm (2nd person / RFID match)
                                  │ pause                         │ hand ends pre-flop       ▼
                                  ▼                               │  & no PreFlop flop   RESULT_VERIFIED ──► SETTLED
                               PAUSED ──► OPEN                    ▼                         │
                                  └───────────── void ────────► VOID (refund all) ◄─────────┘ dispute / mis-deal
```

- **Opening:** bets on flop N+1 open the moment flop N is captured, so players bet while hand N plays out. This matches the confirmed cycle.
- **Locking:** the round locks on the dealer's *deal start* for hand N+1, or on the automatic shuffler's *shuffle complete* signal. That happens **before any hole card exists**.
  - Locking any later leaks information. One player's own two hole cards give up to +12.8% on some markets (`docs/04` §4).
  - The lock is server time-stamped. A bet whose request arrives after the lock is rejected, whatever the client clock says.
- **No flop in the hand:** the club agreement requires the dealer to deal the *PreFlop flop* (burn plus three) even when the hand ends preflop. If that does not happen, the round goes to VOID and every stake is refunded.
- **Video:** stream delay is measured and shown to the player ("video is 2.1 s behind live") but never moves the cutoff.

Identifiers: `club_id / table_id / hand_no / round_id`. The bet slip always shows **"Flop of hand #N+1"**.

## 5. Result capture and verification

| Stage | Method | Verification |
|---|---|---|
| Pilot | The dealer enters the 3 cards on a tablet; the floor supervisor confirms on a second device | The two entries must match. A camera snapshot is attached to the result |
| Scale | RFID card-reading table or a shoe that reads the cards | RFID reading plus a camera image; a dealer entry is only a fallback |
| Always | Signed result message (HMAC with the club key) | Kept in a hash-chained audit log with the timestamps of every transition |

A wrong result found after settlement goes through a **correction workflow**: compensating ledger entries and a full audit trail. History is never rewritten.

## 6. Modules (start as a modular monolith; split later along these lines)

| Module | Responsibility | Key storage |
|---|---|---|
| Identity & KYC | Accounts, age and identity checks, self-exclusion, staff and player separation | Postgres |
| Wallet & Ledger | Double-entry accounts for players, the house, each fee party and prize pools. Integer minor units | Postgres (append-only) |
| Rounds | Lifecycle state machine above, driven by Provider API signals | Postgres + Redis |
| Results | Capture, dual-entry match, signatures, corrections | Postgres + object storage (images) |
| Bets | Bet slip, price lock, idempotent placement | Postgres |
| Risk | Exact per-round exposure over 22,100 flops (`RoundExposure`), plus limits per user, market and round, and maximum payouts | Redis (live) + Postgres |
| Pricing | Odds book per channel from `@preflop/odds-engine`, versioned and published | Postgres |
| Settlement | Pure `settle()` per bet, written exactly once per bet id; payouts to the ledger through the outbox | Postgres |
| Fees & Pools | P = B − F, role merging, largest-remainder split, parimutuel | Postgres |
| Events | Tournaments, heads-up, challenges, invitations, standings | Postgres |
| Partners | API keys, webhooks, wallet adapters, attribution, revenue reports | Postgres |
| Integrity | Chi-square checks of suit and rank frequencies per table, alerts on win patterns on rare markets, linking players to accounts | Postgres + jobs |
| Back office | Club dashboard, round controls, exception handling, support, reports | — |

**Tech choices:**
- Language and API: TypeScript with Node 22, Fastify, Zod schemas and an OpenAPI spec generated from them.
- Data: Postgres 16 (ledger and state) and Redis (live round state, exposure, pub/sub).
- Events: a transactional outbox, then a queue (NATS or SQS).
- Real time: WebSocket fan-out.
- Video: WebRTC or LL-HLS through a managed provider; each club runs an encoder.
- Infrastructure: Docker plus Terraform. One region per licensed territory, so data stays in that territory.

## 7. Bet placement path (≤ 50 ms target)

1. The client sends `POST /bets` with an `Idempotency-Key`, `round_id`, `selection_id`, `stake`, and the `odds` the player saw.
2. Check that the round is `OPEN`, using the Redis state stamped by the server. Then check the user: KYC done, not self-excluded, not a table player or staff member of that club.
3. Check that the price matches the current book version. If it has changed, reject with the new price, so a stale price is never filled.
4. Check limits: the user's stake limits, the market's limits, and `RoundExposure.canAccept()`. That last check is exact over all 22,100 flops.
5. In one Postgres transaction: debit the stake from the player's wallet into the round's *stakes held* account, insert the bet with its locked odds, and add an outbox event.
6. Update the Redis exposure and send the acceptance over WebSocket.

## 8. Data model (core tables)

`clubs, rooms, tables, subscriptions, entitlements`
· `hands(table_id, hand_no)`
· `rounds(id, table_id, hand_no, state, opened_at, locked_at, dealt_at, verified_at, book_version)`
· `results(round_id, card1, card2, card3, flop_index, source, signer, evidence_uri)`
· `markets, selections, book_versions, prices(book_version, channel, selection_id, odds_centi, margin_bps)`
· `bets(id, user_id, round_id, selection_id, stake_minor, odds_centi, channel, partner_id, status)`
· `settlements(bet_id UNIQUE, status, payout_minor)`
· `ledger_accounts, ledger_entries(tx_id, account_id, amount_minor)` with Σ = 0 per transaction
· `events, event_entries, fee_policies(role, party, bps)`
· `partners, api_keys, webhooks`
· `audit_log(seq, prev_hash, hash, payload)`

## 9. Non-functional targets

- 99.9% availability while tables are live. Each round fails safe: on any doubt it goes to PAUSED or VOID and refunds.
- Bet placement p99 under 100 ms. Settlement of a round under 2 s after `RESULT_VERIFIED`.
- Security: OWASP ASVS L2, mTLS or HMAC for clubs and partners, secrets in KMS, least-privilege staff roles, every back-office action audited.
- Responsible gaming: deposit, loss and session limits, reality checks, self-exclusion, and a minimum age check at onboarding.
