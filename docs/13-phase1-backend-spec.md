# 13 — Phase 1 Core Backend: Implementation Spec

Status: **specification for the implementing team (Codex), to be audited first.** It turns
`docs/01`, `02`, `10`, `11` and `12` into a buildable design. It reuses `@preflop/odds-engine` for every
calculation: pricing, exposure, settlement, sharing, evidence and readiness. **The backend must never
re-implement betting maths.**

## 1. Scope

**In scope for phase 1:**
- Fixed-odds betting where **PreFlop is the house**, in one mode per table. Start with play money or EUR.
- The round lifecycle driven by the Provider API.
- The double-entry ledger.
- Bet placement with exact exposure.
- Settlement on a verified, signed flop.
- The review queue.
- A hash-chained audit log.
- A simulated table for end-to-end tests.

**Out of scope for phase 1:**
- Organizer-as-house, pools, contests and diamonds. The engine supports them; the backend comes later.
- Payments and crypto: deposits are a back-office stub.
- KYC.
- The video pipeline.
- Player, club and dealer apps (Codex is producing the app designs).

## 2. Stack

- **Language and server:** TypeScript on Node 22, Fastify 5, and Zod for request schemas, with an OpenAPI spec generated from them.
- **Database:** PostgreSQL 16 through `pg`, with plain SQL migrations.
- **Layout:** a modular monolith in `apps/api` inside the existing pnpm workspace:
  ```
  apps/api/src/
    db/          pool, inTx(), migrate()
    ledger/      post(), balance(), lockAccount()
    rounds/      lifecycle service + table readiness
    bets/        placement + exposure registry
    settlement/  settleBets(), refundBets()
    http/        provider routes (HMAC), player routes, admin routes, problem+json errors
    audit.ts     hash-chained audit log
  apps/api/scripts/simulate.ts   simulated table (end-to-end)
  apps/api/migrations/*.sql
  ```
- **Engine dependency:** `@preflop/odds-engine` through `workspace:*`. Build it before the API (`pnpm -r build`), because it is consumed from `dist/`.

## 3. Database schema (migration `001_init.sql`)

Money is always a `bigint` in minor units.

- The ledger is append-only (triggers).
- A deferred constraint trigger requires every ledger transaction to sum to zero per currency.
- `(kind, ref)` makes each posting idempotent.
- Audit events are stored as the **exact JSON text that was hashed**, not as `jsonb`, because `jsonb` re-orders keys and would break the hash.

```sql
-- PreFlop core schema (phase 1). Money is always an integer in minor units (bigint).

create table clubs (
  id          text primary key,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table poker_tables (
  id               text primary key,
  club_id          text not null references clubs(id),
  name             text not null,
  provider_secret  text not null,                      -- HMAC key for the Provider API
  mode             text not null default 'real-fiat',
  currency         text not null default 'EUR',
  max_round_loss_minor bigint not null default 10000000,
  certification    jsonb not null default '{}'::jsonb, -- TableCertification flags
  link             jsonb,                              -- last LinkSample from the heartbeat
  link_at          timestamptz,
  created_at       timestamptz not null default now()
);

create table devices (
  id              text primary key,
  table_id        text not null references poker_tables(id),
  public_key_pem  text not null,
  revoked         boolean not null default false,
  last_seq        bigint not null default 0,
  last_hash       text not null default 'genesis',
  created_at      timestamptz not null default now()
);

create table rounds (
  id                   text primary key,
  table_id             text not null references poker_tables(id),
  hand_no              integer not null,
  mode                 text not null,
  currency             text not null,
  channel              text not null default 'direct',
  state                text not null check (state in ('OPEN','LOCKED','DEALT','REVIEW','SETTLED','VOID')),
  opened_at            timestamptz not null default now(),
  shuffle_complete_at  timestamptz,
  shuffle_source       text,
  locked_at            timestamptz,
  cut_depth            integer,
  cut_instruction_at   timestamptz,
  cut_at               timestamptz,
  deal_start_at        timestamptz,
  settled_at           timestamptz,
  voided_at            timestamptz,
  void_reason          text,
  review_reasons       jsonb,
  flop                 text[],
  flop_index           integer,
  unique (table_id, hand_no)
);
create index rounds_table_state on rounds (table_id, state);

create table flop_entries (
  round_id    text not null references rounds(id),
  source      text not null check (source in ('dealer','floor')),
  cards       text[] not null,
  entered_at  timestamptz not null default now(),
  primary key (round_id, source)
);

create table captures (
  round_id      text primary key references rounds(id),
  device_id     text not null references devices(id),
  seq           bigint not null,
  capture       jsonb not null,
  signature     text not null,
  image         bytea not null,
  received_at   timestamptz not null default now()
);

create table bets (
  id               text primary key,
  idempotency_key  text not null,
  user_id          text not null,
  round_id         text not null references rounds(id),
  selection_id     text not null,
  stake_minor      bigint not null check (stake_minor > 0),
  odds_centi       integer not null check (odds_centi >= 100),
  mode             text not null,
  currency         text not null,
  status           text not null check (status in ('accepted','won','lost','void')),
  payout_minor     bigint,
  placed_at        timestamptz not null default now(),
  settled_at       timestamptz,
  unique (user_id, idempotency_key)
);
create index bets_round on bets (round_id, status);

-- Double-entry ledger. Every transaction's entries sum to zero per currency.
create table ledger_tx (
  id          bigserial primary key,
  kind        text not null,
  ref         text not null,
  created_at  timestamptz not null default now(),
  unique (kind, ref)                                -- idempotency: one posting per (kind, ref)
);

create table ledger_accounts (
  id        text primary key,                       -- <owner>:<purpose>:<mode>:<currency>
  currency  text not null
);

create table ledger_entries (
  id            bigserial primary key,
  tx_id         bigint not null references ledger_tx(id),
  account_id    text not null references ledger_accounts(id),
  amount_minor  bigint not null,
  currency      text not null
);
create index ledger_entries_account on ledger_entries (account_id);

create function ledger_tx_balanced() returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from ledger_entries where tx_id = new.tx_id group by currency having sum(amount_minor) <> 0
  ) then
    raise exception 'ledger transaction % does not balance', new.tx_id;
  end if;
  return null;
end $$;

create constraint trigger ledger_entries_balanced
  after insert on ledger_entries
  deferrable initially deferred
  for each row execute function ledger_tx_balanced();

-- Ledger rows are append-only.
create function forbid_change() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;
create trigger ledger_entries_append_only before update or delete on ledger_entries for each row execute function forbid_change();
create trigger ledger_tx_append_only before update or delete on ledger_tx for each row execute function forbid_change();

-- Hash-chained audit log of every round transition, result and settlement.
create table audit_log (
  seq        bigserial primary key,
  at         timestamptz not null default now(),
  prev_hash  text not null,
  hash       text not null,
  event      text not null                         -- exact JSON text that was hashed
);
create trigger audit_log_append_only before update or delete on audit_log for each row execute function forbid_change();
```

## 4. Round lifecycle

```
OPEN ──Start hand (lock + random cut)──▶ LOCKED ──flop entered / captured──▶ DEALT ──verified──▶ SETTLED
  │                                        │                                    └─disagreement─▶ REVIEW ──floor──▶ SETTLED | VOID
  └──────────────────────── void ──────────┴────────────────────────────────────────────────────▶ VOID (refund all)
```

- **Round ids** are `<tableId>:h<handNo>`. A round for hand N takes bets **while hand N−1 is being played**.
- **Opening a round** requires `tableReadiness()`: every certification flag is true, and the last heartbeat is less than 5 s old with a healthy link and the **stream live**. Otherwise the call fails with `409 table_not_ready`.
  - Exactly one round per table may be OPEN.
  - `ensureOpenRound()` reopens betting after a pause, once the table is healthy again.
- **`shuffle-complete`** (OPEN): records the time and `source` (`shuffler` or `manual`). A manual shuffle is allowed to be recorded, but it later **voids** the hand.
- **`start`** (OPEN → LOCKED), all in one transaction:
  1. Require shuffle-complete.
  2. Lock the round.
  3. `drawCutDepth()` and store `cut_depth` / `cut_instruction_at`.
  4. Audit the lock.
  5. **Open round N+1** (skip silently if the table is not ready).
  6. Respond with `{ cut_depth }`.
- **`cut`** and **`deal-start`** (LOCKED): record the timestamps.
- **Dealer and floor flop entries, and the signed capture** (LOCKED or DEALT): the first one moves the round to DEALT. After each, call `resolve()`.
- **`resolve()`** runs once the capture and both entries exist:
  1. `handProcedureProblems(events)`. If there are any problems → **VOID** with the reason (refund every bet).
  2. `verifyCapture(...)`, passing:
     - the device's public key, revoked flag and `last_seq` / `last_hash`;
     - the server-stamped `locked_at` / `deal_start_at`;
     - the stored image bytes;
     - both entries.
  3. If the decision is `settle`: advance the device's `last_seq` / `last_hash`, then **settle**.
  4. Otherwise → **REVIEW**, with `review_reasons`.
- **REVIEW** is resolved by a floor manager with `resolveReview(roundId, operatorId, settle(cards) | void(reason))`, which is audited.
- **Void** is allowed from OPEN, LOCKED, DEALT or REVIEW, and refunds every accepted bet.

Server timestamps use `clock_timestamp()`, never the client's clock.

## 5. Bet placement (PreFlop is the house)

`POST /v1/bets` with an `Idempotency-Key` header.

1. **Replay check:** the same `(user, key)` returns the original bet.
2. **Validate:** the stake is an integer within limits, and the selection exists.
3. **Serialise per round** with an in-process keyed mutex. The exposure cache is per round and rebuilt from accepted bets when it's missing.
4. **Check the round and table:** the round must be `OPEN` (otherwise `409 round_locked`), and `tableReadiness()` must pass (otherwise `409 table_not_ready`).
5. **Check the price:** `price(statsFor(selection), round.channel)`. It must be offered, and must equal the client's `odds_centi` (otherwise `409 price_changed` with the new odds). The payout must be ≤ the maximum payout.
6. **Check exposure:** `RoundExposure.canAccept()` against `poker_tables.max_round_loss_minor`, otherwise `422 limit_exceeded`.
7. **One database transaction:**
   1. `lockAccount(wallet)`;
   2. re-check that `rounds.state = 'OPEN'` (`for share`), because a lock may have landed meanwhile;
   3. check balance ≥ stake;
   4. insert the bet;
   5. post `bet.stake` (wallet → `PreFlop:bankroll`);
   6. audit.
8. After commit, add the bet to the exposure cache.

**Scaling note:** the in-process mutex and exposure cache assume **one API process per region**. Horizontal scaling needs a shared exposure store, for example Redis with a Lua script doing the same worst-case check, or a per-round row lock plus a persisted exposure vector.

## 6. Settlement and refunds

All in the round's transaction, with postings keyed by bet id:
- **Settle:** `settle()` from the engine for each accepted bet. A win posts `bet.payout` (bankroll → wallet). Then update the bet status and payout.
- **Void:** post `bet.refund` (bankroll → wallet) for the full stake, and set the status to `void`.

Because a ledger transaction is unique on `(kind, ref)`, a retried settlement can never pay twice.

## 7. HTTP API (first slice of `docs/02`)

| Route | Auth | Purpose |
|---|---|---|
| `POST /v1/provider/tables/:t/heartbeat` | HMAC (table secret) | Link sample, including `streamLive` |
| `POST /v1/provider/tables/:t/hands/:n/shuffle-complete` | HMAC | `{source}` |
| `POST /v1/provider/tables/:t/hands/:n/start` | HMAC | Lock; returns `{cut_depth, next_round_id}` |
| `POST /v1/provider/tables/:t/hands/:n/cut` · `/deal-start` | HMAC | Procedure events |
| `POST /v1/provider/tables/:t/hands/:n/flop` | HMAC | `{source: dealer\|floor, cards}` |
| `POST /v1/provider/tables/:t/hands/:n/capture` | HMAC | `{capture, signature, image_base64}` |
| `POST /v1/provider/tables/:t/hands/:n/void` | HMAC | `{reason}` |
| `GET /v1/tables/:t/rounds/current` | Player | Open round, plus its prices from the book |
| `POST /v1/bets` | Player + `Idempotency-Key` | Place a bet |
| `GET /v1/me/bets` · `GET /v1/me/balance` | Player | History and balance |
| `POST /v1/admin/...` | Admin token | Clubs, tables, certification, devices (public key PEM), deposits, review decisions |

- **HMAC header:** `X-PreFlop-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>`. Reject anything older than 30 s, and compare with a constant-time check.
- **Errors:** `application/problem+json` with stable `type` codes: `round_locked`, `price_changed`, `limit_exceeded`, `insufficient_funds`, `table_not_ready`, `invalid_round_state`, `invalid_flop`, `unknown_device`.

## 8. Acceptance criteria

1. Ledger: every transaction balances (the trigger), and the sum of all accounts per currency is 0.
2. No bet is ever accepted after the lock, including under concurrent requests. Test with parallel placement racing `start`.
3. A procedure break (manual shuffle, missing cut, events out of order) voids the hand and refunds every bet.
4. A forged, replayed or edited capture, or a missing image, never settles. A dealer or floor mismatch goes to REVIEW.
5. Settlement is idempotent: running it twice pays once.
6. A round never opens while the table is uncertified, the heartbeat is stale, or the stream is off air.
7. The audit chain verifies from genesis.
8. **Simulated table:** 10,000 rounds, each following the real sequence:
   1. a crypto-random shuffle;
   2. Start hand;
   3. the cut performed at the issued depth;
   4. deal-start;
   5. hole cards for 9 seats, a burn, then the flop;
   6. a signed capture with dealer and floor entries.

   Random players bet throughout, and a late bet is attempted after every lock. Check that:
   - the ledger reconciles to zero;
   - every late bet is rejected;
   - the realised house edge is within statistical bounds of the book's edge.

## 9. Delivery order

1. Migrations, ledger and audit.
2. Rounds service and readiness.
3. Bets.
4. Settlement.
5. HTTP layer.
6. Simulator.
7. CI with a Postgres service container.
