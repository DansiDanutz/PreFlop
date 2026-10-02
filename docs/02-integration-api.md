# 02 — Integration APIs

Status: **proposed** contract. There are three integration surfaces, all versioned under `/v1`. Each comes with an OpenAPI 3.1 spec generated from the server's Zod schemas.

| Surface | Who uses it | Auth |
|---|---|---|
| **Provider API** | Poker clubs (dealer tablet, shuffler or RFID bridge, encoder) | Per-device API key + HMAC-SHA256 request signature; mTLS for hardware bridges |
| **Partner API** | Betting companies (Model B) | OAuth2 client credentials; webhooks signed with HMAC |
| **Player API** | PreFlop web and mobile apps, and the white-label widget | User session tokens (OIDC) |

Common rules:
- Every write takes an `Idempotency-Key`. A replay returns the original response.
- Money is always an **integer in minor units**, with an ISO currency. Odds are integers in hundredths (`odds_centi: 238` means 2.38).
- Times are RFC 3339 UTC, stamped by the server.
- Errors follow `application/problem+json` with stable `type` codes, for example `round_locked`, `price_changed`, `limit_exceeded` and `self_excluded`.

---

## 1. Provider API (clubs)

A club has to do very little: run a tablet app (or a hardware bridge) that sends three signals per hand.

```
POST /v1/provider/tables/{tableId}/hands                 # hand N+1 is about to be shuffled → opens nothing, registers hand
POST /v1/provider/tables/{tableId}/hands/{n}/start       # LOCK: no more bets on hand n's flop (before the deck is shuffled)
    → 200 { "shuffle_command": { "nonce": "…" } }       # single-use command for the Trusted Shuffler
GET  /v1/provider/tables/{tableId}/hands/{n}/shuffle-command    # Table Box shuffler bridge fetches the nonce
POST /v1/provider/tables/{tableId}/hands/{n}/shuffle-complete   # fresh shuffle, signed by the Trusted Shuffler for the nonce (mandatory)
    → 200 { "cut_depth": 27 }                          # random cut depth, drawn by PreFlop after the shuffle
POST /v1/provider/tables/{tableId}/hands/{n}/cut         # dealer cut at the instructed depth (mandatory)
POST /v1/provider/tables/{tableId}/hands/{n}/deal-start  # dealing begins
POST /v1/provider/tables/{tableId}/hands/{n}/flop        # dealer / floor manual entry {cards:["Kh","Kd","7h"], source:"dealer|floor"}
POST /v1/provider/tables/{tableId}/hands/{n}/capture     # Table Box signed capture {capture, signature} + image upload (docs/12 §5)
POST /v1/provider/tables/{tableId}/hands/{n}/flop/confirm   # second, independent confirmation (pilot: floor supervisor)
POST /v1/provider/tables/{tableId}/hands/{n}/void        # {reason:"misdeal|no_flop|stream_down|..."}
POST /v1/provider/tables/{tableId}/pause | /resume
GET  /v1/provider/tables/{tableId}/state
POST /v1/provider/tables/{tableId}/heartbeat             # every 1 s: upload, RTT, jitter, loss, backup link, encoder status
POST /v1/provider/tables/{tableId}/connection-tests      # 30-min soak test result (certification)
```

Authentication: one Ed25519 credential **per device and per staff member and role** (dealer, floor, floor manager), each scoped to one table. Every request is signed over a canonical envelope covering the method, path, query, timestamp, single-use nonce, idempotency key and body hash. The exact format is in `docs/13` §7. Reused nonces and requests older than 30 s are rejected.

Hardware bridges (automatic shuffler, RFID table) send the same calls, using `source: "rfid"`. When both a dealer entry and an RFID reading exist and they disagree, the round stays in DEALT and an exception is raised in the back office.

## 2. Partner API (betting companies)

### Distribution options
1. **Widget (fastest).** A JS embed, `<script src=".../widget.js" data-partner="..." data-session="...">`. It brings its own lobby, video, bet slip and history, themeable to the partner's brand. Money moves through the partner's wallet (see below).
2. **Full API.** The partner builds its own UI from the feeds and endpoints below.

### Feeds
```
GET  /v1/lobby                                  # clubs, rooms, tables, live status
GET  /v1/tables/{tableId}/rounds/current        # round id, hand no, state, closes_at, book_version
GET  /v1/books/{bookVersion}?channel=partner    # markets, selections, odds_centi
WS   /v1/stream  (subscribe: table:{id})        # round.opened, round.locked, round.dealt, round.settled, round.voided, price.updated
```

### Betting
```
POST /v1/bets
{
  "round_id": "rnd_…", "selection_id": "suit-pattern:rainbow",
  "stake_minor": 1000, "currency": "EUR", "odds_centi": 237,
  "player_ref": "partner-player-123", "accept_price_change": false
}
→ 201 { "bet_id": "bet_…", "status": "accepted", "odds_centi": 237, "potential_payout_minor": 2370 }
→ 409 { "type": "price_changed", "odds_centi": 236 }   |  409 round_locked  |  422 limit_exceeded
GET  /v1/bets/{betId}      GET /v1/bets?player_ref=…&round_id=…
```

### Wallet modes
| Mode | How money moves | Who holds player funds |
|---|---|---|
| **Seamless** (recommended for B2B) | PreFlop calls the partner: `POST {partner}/wallet/debit` when a bet is placed, then `/credit` at settlement or refund. Each call is idempotent and keyed by `bet_id` + operation | Partner |
| **Transfer** | The player moves funds into a PreFlop sub-wallet and bets from it | PreFlop |

If a debit times out, the bet is **not accepted**, and a reconciliation job retries `/wallet/rollback` until it succeeds. Credits are retried with backoff until acknowledged. A daily reconciliation file lists every bet, settlement and fee line.

### Webhooks (to the partner)
`bet.settled`, `bet.voided`, `round.voided`, `event.finished`, `fee.statement.ready`. They are signed like the Provider API requests, retried for 24 h, and the partner must deduplicate them by `event_id`.

### Revenue reporting
`GET /v1/partners/me/statements?period=2026-10` returns turnover, GGR and fee shares per party (PreFlop, provider club, partner), produced from the ledger.

## 3. Player API (apps and widget)

```
GET  /v1/lobby · /v1/clubs/{id} · /v1/tables/{id}
GET  /v1/tables/{id}/rounds/current · /v1/books/{version}
POST /v1/bets · GET /v1/me/bets · GET /v1/me/ledger
POST /v1/events (create tournament/challenge) · POST /v1/events/{id}/invites · POST /v1/events/{id}/join
POST /v1/pools/{roundId}/entries   (parimutuel)
PUT  /v1/me/limits (deposit / loss / session) · POST /v1/me/self-exclusion
```

## 4. Modes, houses, diamonds and chips

```
GET  /v1/modes                                     # enabled play modes per territory
POST /v1/organizers/{id}/collateral/deposits       # organizer-as-house: fund collateral per mode
GET  /v1/organizers/{id}/collateral                # balance, reserved (open rounds' worst case), available
PUT  /v1/organizers/{id}/rules                     # rake %, min stake, rake shares — validated against global rules
GET  /v1/diamonds/packs · POST /v1/diamonds/purchases {diamonds, pay_with: "EUR"|"USDT"|"USDC"}
POST /v1/diamonds/transfers · POST /v1/chips/transfers   # club / organizer → player, online
POST /v1/me/play/reset                             # player resets play money at any time
GET  /v1/organizers/{id}/dilution?period=YYYY-MM   # diamonds bought, sunk, rake, house net, bets until empty
GET  /v1/partners/me/statements?period=YYYY-MM     # dynamic shares: metrics, tier, rate, base, amount
```

Every bet and round carries `mode` and `house_id`. A diamond bet also returns its split: `preflop_fee`, `rake`, `rake_shares`, `at_risk`.

## 5. Versioning and SDKs

- Breaking changes go into `/v2`. Within a version, fields are only ever added.
- Book versions are immutable. A bet records the `book_version` and `odds_centi` it was accepted at.
- SDKs are generated from the OpenAPI spec: TypeScript first, then Kotlin/Swift for mobile and PHP/Java for operators.
- A sandbox environment has a **simulated table** that deals random flops every 20 s, so partners can integrate without a live club.
