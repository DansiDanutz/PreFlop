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
  kind            text not null default 'table_box' check (kind in ('table_box')),  -- the Table Box also carries the paired shuffler bridge
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
  state                text not null check (state in ('OPEN','LOCKED','DEALT','REVIEW','EVIDENCE_REJECTED','SETTLED','VOID')),
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

-- Only AUTHENTIC captures (device, signature, seq and chain verified) are stored here: one per round.
create table captures (
  round_id      text primary key references rounds(id),
  device_id     text not null references devices(id),
  seq           bigint not null,
  capture       jsonb not null,
  signature     text not null,
  image         bytea,                             -- null until bytes matching capture.imageSha256 arrive
  received_at   timestamptz not null default now(),
  unique (device_id, seq)
);

-- Every upload that failed authenticity, kept as evidence. Nothing here is ever used to settle.
create table capture_attempts (
  id            bigserial primary key,
  round_id      text not null references rounds(id),
  device_id     text,
  seq           bigint,
  capture       jsonb not null,
  signature     text not null,
  problems      jsonb not null,
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
  currency  text not null,
  unique (id, currency)
);

create table ledger_entries (
  id            bigserial primary key,
  tx_id         bigint not null references ledger_tx(id),
  account_id    text not null,
  amount_minor  bigint not null,
  currency      text not null,
  -- composite FK: an entry's currency must be its account's currency (no EUR entry on a USDT account)
  foreign key (account_id, currency) references ledger_accounts (id, currency)
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
create trigger capture_attempts_append_only before update or delete on capture_attempts for each row execute function forbid_change();

-- Single-row head of the chain. Every append runs, in its own transaction:
--   select seq, hash from audit_head where id = 1 for update;   -- serialises all writers
--   insert into audit_log (prev_hash, hash, event)
--     values (head.hash, encode(sha256(convert_to(head.hash || event, 'UTF8')), 'hex'), event);
--   update audit_head set seq = <new seq>, hash = <new hash> where id = 1;
-- so concurrent transactions can never commit two events with the same predecessor.
create table audit_head (
  id    smallint primary key check (id = 1),
  seq   bigint not null,
  hash  text not null
);
insert into audit_head (id, seq, hash) values (1, 0, 'genesis');
create trigger audit_head_no_delete before delete on audit_head for each row execute function forbid_change();
```

## 4. Round lifecycle

```
OPEN ──Start hand (lock + random cut)──▶ LOCKED ──AUTHENTIC signed capture──▶ DEALT ──content verified, 3-way match──▶ SETTLED
  │                                        │  (entries alone, or a capture        ├─entries disagree─▶ REVIEW ──floor──▶ SETTLED | VOID
  │                                        │   failing authenticity, stay LOCKED) └─content rejected─▶ EVIDENCE_REJECTED ──auto void──▶ VOID
  └──────────────────────── void ──────────┴─────────── (no authentic capture by the result SLA) ───────────────▶ VOID (refund all)
```

- **Round ids** are `<tableId>:h<handNo>`.
- **Betting window** (same as `docs/01` §4): the round for hand N+1 **opens when flop N is captured**, meaning an **authentic signed capture** of flop N has been recorded and round N has moved to DEALT. Dealer and floor entries alone never open betting. Players bet on flop N+1 while the rest of hand N is played. Betting closes at Start hand N+1.
- **Opening a round** requires `tableReadiness()`: every certification flag is true, and the last heartbeat is less than 5 s old with a healthy link and the **stream live**. Otherwise the call fails with `409 table_not_ready`.
  - Exactly one round per table may be OPEN.
  - `ensureOpenRound()` reopens betting after a pause, once the table is healthy again.
- **`shuffle-complete`** (OPEN): records the time and a `source` that is **derived from the credential, never sent by the caller**.
  - Sent by the Table Box, which carries the paired shuffler bridge, with its **device signature** → `shuffler`.
  - Sent with the table's staff HMAC secret (dealer or floor tablet) → `manual`.

  A manual shuffle is recorded, but it **voids** the hand when `resolve()` runs. A staff tablet can therefore never pass off a hand shuffle as a machine shuffle.
- **`start`** (OPEN → LOCKED), all in one transaction:
  1. Require shuffle-complete.
  2. Lock the round.
  3. `drawCutDepth()` and store `cut_depth` / `cut_instruction_at`.
  4. Audit the lock.
  5. Respond with `{ cut_depth }`.

  `start` does **not** open the next round. Round N+1 opens when this round reaches DEALT (see the betting window above).
- **`cut`** and **`deal-start`** (LOCKED): record the timestamps.
- **Dealer and floor flop entries** (LOCKED, DEALT, REVIEW or EVIDENCE_REJECTED): stored in `flop_entries`. They **never change the round's state and never open betting**. After each one, call `resolve()`.
- **Signed capture** (`POST …/capture`, device signature, LOCKED). Capture is handled in two stages. The **authenticity** stage runs immediately on receipt:
  - **Authenticity check:**
    - the device is known, not revoked and bound to this table;
    - the Ed25519 signature is valid;
    - `seq = last_seq + 1`;
    - `prev_hash = last_hash`;
    - the capture names this table, round and hand.

    Codex should expose this half as `verifyCaptureAuthenticity()` in the engine, and keep `verifyCapture()` as the full check.
  - **Authentic** → in one transaction:
    1. insert into `captures`;
    2. **advance the device checkpoint** (`last_seq`, `last_hash`);
    3. move the round LOCKED → DEALT;
    4. **open round N+1**, skipped silently if the table is not ready;
    5. respond `{authentic: true}`;
    6. call `resolve()`.

    The checkpoint advances whatever happens to the round later (SETTLED, REVIEW, EVIDENCE_REJECTED or VOID), so the Table Box chain stays continuous and the next hand's capture always verifies.
  - **Not authentic** →
    1. append the upload to `capture_attempts` with its problems, as evidence only (it is never used to settle);
    2. raise a security alert;
    3. leave the round **LOCKED** and the checkpoint unchanged;
    4. respond `422 evidence_rejected` with `{expected_seq, expected_prev_hash}`.
  - **Retry protocol (Table Box):** the Table Box keeps every signed capture in its encrypted local buffer and **advances its own `seq` only after the server answers `authentic: true`**. On `evidence_rejected` it re-sends the **same signed record** (same `seq` N, same `prev_hash`) from its buffer. If that record is lost, it re-captures the board and signs it again under the same `seq` N and `prev_hash`. The retry is checked against the unchanged checkpoint, so recovery never trusts anything that was rejected. After **3 failed attempts**, or when the result SLA expires without an authentic capture:
    - the round goes to **VOID** with a refund;
    - the device is flagged;
    - the table pauses until a technician has inspected the Table Box;
    - round N+1 then opens through `ensureOpenRound()` once the table is healthy again.
- **Image upload:** the image bytes may come with the capture or in a separate upload. Bytes are stored only if their SHA-256 equals the **signed** `capture.imageSha256`. The hash can't be changed without breaking the signature, so a corrupted or swapped image can simply be re-uploaded.
- **`resolve()`** runs once an authentic capture, its matching image and both manual entries all exist:
  1. `handProcedureProblems(events)`. If there are any problems → **VOID** with the reason (refund every bet).
  2. `verifyCapture(...)` content checks:
     - the server-stamped `locked_at` / `deal_start_at` timing;
     - the stored image bytes against the signed hash;
     - the dealer and floor entries.
  3. Decision `settle` → **settle**.
  4. Decision `review` (authentic capture, but the dealer or floor entry disagrees) → **REVIEW**, with `review_reasons`.
  5. A content `reject` on an authentic capture (e.g. captured before the lock or deal-start, or after the deadline) → **EVIDENCE_REJECTED**, with the reasons, and a security alert.
- **REVIEW** is resolved by a floor manager with `resolveReview(roundId, operatorId, settle(cards) | void(reason))`, which is audited. The floor manager decides after viewing the **verified** evidence image.
- **EVIDENCE_REJECTED can never be settled by hand.** `resolveReview` refuses this state. Its only exit is **VOID** with a full refund, made automatically by the system and audited. A missing or mismatched image never reaches this state, because `resolve()` waits for image bytes that match the signed hash.
- **Void** is allowed from OPEN, LOCKED, DEALT, REVIEW or EVIDENCE_REJECTED, and refunds every accepted bet.

Server timestamps use `clock_timestamp()`, never the client's clock.

## 5. Bet placement (PreFlop is the house)

`POST /v1/bets` with an `Idempotency-Key` header.

1. **Replay check:** the same `(user, key)` returns the original bet.
2. **Validate:** the stake is an integer within limits, and the selection exists.
3. **Serialise per round** with an in-process keyed mutex. The exposure cache is per round and is rebuilt from the round's accepted bets in the database whenever it is missing, or when its bet count differs from the database's.
4. **Check the round and table:** the round must be `OPEN` (otherwise `409 round_locked`), and `tableReadiness()` must pass (otherwise `409 table_not_ready`).
5. **Check the price:** `price(statsFor(selection), round.channel)`. It must be offered, and must equal the client's `odds_centi` (otherwise `409 price_changed` with the new odds). The payout must be ≤ the maximum payout.
6. **Check exposure:** `RoundExposure.canAccept()` against `poker_tables.max_round_loss_minor`, otherwise `422 limit_exceeded`. This is a read-only check; the cache is not changed yet.
7. **One database transaction:**
   1. `lockAccount(wallet)`;
   2. re-check that `rounds.state = 'OPEN'` (`for share`), because a lock may have landed meanwhile;
   3. check balance ≥ stake;
   4. insert the bet;
   5. post `bet.stake` (wallet → `PreFlop:bankroll`);
   6. audit;
   7. read the round's accepted-bet count, and compare it with the cache's count plus one.
8. **After commit, update the cache, or evict it:**
   - If the commit succeeded and the count matched, apply the bet to the cache (`tryAdd`).
   - If applying throws, the commit outcome is unknown (for example a lost connection), or the counts differed, **evict the round's cache**. The next bet rebuilds it from the database before its exposure check.

   The cache can therefore never under-count accepted bets, and the round-loss limit holds even after a partial failure.

**Scaling note:** the in-process mutex and exposure cache assume **one API process per region**. Horizontal scaling needs a shared exposure store, for example Redis with a Lua script doing the same worst-case check, or a per-round row lock plus a persisted exposure vector.

## 6. Settlement and refunds

All in the round's transaction, with postings keyed by bet id:
- **Settle:** `settle()` from the engine for each accepted bet. A win posts `bet.payout` (bankroll → wallet). Then update the bet status and payout.
- **Void:** post `bet.refund` (bankroll → wallet) for the full stake, and set the status to `void`.

Because a ledger transaction is unique on `(kind, ref)`, a retried settlement can never pay twice.

## 7. HTTP API (first slice of `docs/02`)

| Route | Auth | Purpose |
|---|---|---|
| `POST /v1/provider/tables/:t/heartbeat` | Device signature (Table Box) | Link sample, including `streamLive` |
| `POST /v1/provider/tables/:t/hands/:n/shuffle-complete` | **Device signature** → `shuffler`; staff HMAC → recorded as `manual` (voids the hand) | No body field for the source |
| `POST /v1/provider/tables/:t/hands/:n/start` | Staff HMAC (dealer tablet) | Lock; returns `{cut_depth}` |
| `POST /v1/provider/tables/:t/hands/:n/cut` · `/deal-start` | HMAC | Procedure events |
| `POST /v1/provider/tables/:t/hands/:n/flop` | HMAC | `{source: dealer\|floor, cards}` |
| `POST /v1/provider/tables/:t/hands/:n/capture` | Device signature (Table Box) | `{capture, signature, image_base64?}` → `200 {authentic: true}` or `422 evidence_rejected {expected_seq, expected_prev_hash}` |
| `PUT /v1/provider/tables/:t/hands/:n/capture/image` | Device signature (Table Box) | Raw image bytes; stored only if their SHA-256 equals the signed `imageSha256` |
| `POST /v1/provider/tables/:t/hands/:n/void` | HMAC | `{reason}` |
| `GET /v1/tables/:t/rounds/current` | Player | Open round, plus its prices from the book |
| `POST /v1/bets` | Player + `Idempotency-Key` | Place a bet |
| `GET /v1/me/bets` · `GET /v1/me/balance` | Player | History and balance |
| `POST /v1/admin/...` | Admin token | Clubs, tables, certification, devices (public key PEM), deposits, review decisions |

- **Two credential types per table:**
  - **Device signature** for the Table Box, which also carries the paired shuffler bridge. Header `X-PreFlop-Device: <deviceId>,t=<unix>,sig=<base64 Ed25519(t + "." + rawBody)>`, verified with the key registered in `devices`. The private key lives in the TPM.
  - **Staff HMAC** for dealer and floor tablets. Header `X-PreFlop-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>`.

  For both, reject anything older than 30 s and compare with a constant-time check. Routes marked "device signature" refuse the staff HMAC.
- **Errors:** `application/problem+json` with stable `type` codes: `round_locked`, `price_changed`, `limit_exceeded`, `insufficient_funds`, `table_not_ready`, `invalid_round_state`, `invalid_flop`, `unknown_device`, `evidence_rejected`.

## 8. Acceptance criteria

1. Ledger:
   - every transaction balances (the trigger), and the sum of all accounts per currency is 0;
   - an entry whose currency differs from its account's is rejected (the composite FK).
2. No bet is ever accepted after the lock, including under concurrent requests. Test with parallel placement racing `start`.
3. A procedure break (manual shuffle, missing cut, events out of order) voids the hand and refunds every bet.
4. Evidence:
   - A forged, replayed or edited capture is logged in `capture_attempts`, leaves the round LOCKED and the checkpoint unchanged, and **can never settle**.
   - A retry of the same signed record at the same `seq` then verifies and settles the hand. The next hand's capture (`seq + 1`) also verifies.
   - After 3 failed attempts, or when the result deadline passes, the round voids and the table pauses.
   - Dealer and floor entries alone never move the round to DEALT and never open round N+1. Only an authentic capture does.
   - An image whose hash differs from the signed hash is refused, and the round waits for the correct bytes. A capture timed before the lock goes to EVIDENCE_REJECTED and voids.
   - A dealer or floor mismatch on an authentic capture goes to REVIEW.
   - After a REVIEW or VOID hand, the same Table Box's next capture still verifies, because the checkpoint advanced.
   - A shuffle-complete sent with the staff HMAC is recorded as `manual` and voids the hand.
5. Settlement is idempotent: running it twice pays once.
6. A round never opens while the table is uncertified, the heartbeat is stale, or the stream is off air.
7. The audit chain verifies from genesis, including after 50 concurrent transactions each appending events.
8. **Exposure survives partial failures:** inject a failure after the bet commit but before the cache update. The next bet must still be refused once the round's true worst case reaches the limit.
9. **Simulated table:** 10,000 rounds, each following the real sequence:
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
