# 13 — Phase 1 Core Backend: Implementation Spec

Status: **specification for the implementing team (Codex), to be audited first.** It turns
`docs/01`, `02`, `10`, `11` and `12` into a buildable design. It reuses `@preflop/odds-engine` for every
calculation: pricing, exposure, settlement, sharing, evidence and readiness. **The backend must never
re-implement betting maths.**

## 1. Scope

**In scope for phase 1:**
- Fixed-odds betting where **PreFlop is the house**, in one mode per table. **Physical-table play is disabled in every mode, including non-redeemable play money** (owner decision, re-audit of 2026-10-02). Certification of the PreFlop Trusted Shuffler (`docs/12` §2a, audit finding F01) is a **prerequisite for reconsidering** that decision, not permission to enable it automatically. Phase 1 runs end to end on the **simulated table** only; simulated practice play is a separate scope. Real-money modes are built and tested, but stay switched off.
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
    http/        provider routes (signed envelope, per-person roles), player routes, admin routes, problem+json errors
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
  mode             text not null default 'real-fiat',
  currency         text not null default 'EUR',
  max_round_loss_minor bigint not null default 10000000,
  -- TableCertification items with provenance: {"<flag>": {"ok": true, "by": "<staff id>", "at": "<ts>", "expires_at": "<ts>"}}
  -- An item that is missing, false or past expires_at counts as NOT certified (per-shift items expire at shift end).
  certification    jsonb not null default '{}'::jsonb,
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

-- One credential per PERSON (never per table). Role decides what the credential may do;
-- the entry source is derived from the role, never sent by the caller.
create table staff_credentials (
  id              text primary key,
  table_id        text not null references poker_tables(id),   -- credentials are scoped to one table
  person_id       text not null,
  role            text not null check (role in ('dealer','floor','floor_manager')),
  public_key_pem  text not null,                               -- Ed25519, generated in the managed tablet's keystore
  revoked         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (table_id, person_id, role)
);

-- Replay protection: every signed request carries a nonce, consumed exactly once per credential.
create table request_nonces (
  credential_id  text not null,
  nonce          text not null,
  seen_at        timestamptz not null default now(),
  primary key (credential_id, nonce)
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
  procedure_step       text not null default 'open' check (procedure_step in
                         ('open','locked','shuffle_commanded','shuffled','cut_instructed','cut','dealing')),
  shuffle_command_nonce text,                              -- single-use, issued at Start hand
  shuffle_command_at   timestamptz,
  shuffle_complete_at  timestamptz,
  shuffle_source       text,
  shuffle_attested_nonce text,                             -- nonce in the shuffler's signed completion
  locked_at            timestamptz,
  cut_depth            integer,
  cut_instruction_at   timestamptz,
  cut_at               timestamptz,
  deal_start_at        timestamptz,
  settled_at           timestamptz,
  voided_at            timestamptz,
  void_reason          text,
  voided_by            text,                               -- staff credential id, or 'system:sweeper'
  review_reasons       jsonb,
  review_started_at    timestamptz,                         -- set on entering REVIEW; the review SLA runs from here
  flop                 text[],
  flop_index           integer,
  unique (table_id, hand_no)
);
create index rounds_table_state on rounds (table_id, state);

create table flop_entries (
  round_id       text not null references rounds(id),
  source         text not null check (source in ('dealer','floor')),   -- derived from the credential's role
  credential_id  text not null references staff_credentials(id),
  person_id      text not null,
  cards          text[] not null,
  entered_at     timestamptz not null default now(),
  primary key (round_id, source)
);
-- The two confirmations must come from two different people.
create unique index flop_entries_distinct_people on flop_entries (round_id, person_id);

-- Durable post-commit work: every result input enqueues an idempotent resolve job.
create table outbox (
  id          bigserial primary key,
  kind        text not null,                -- e.g. 'resolve_round'
  ref         text not null,                -- e.g. round id
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
-- At most one pending job per (kind, ref); enqueue with "on conflict do nothing".
create unique index outbox_pending on outbox (kind, ref) where done_at is null;

-- Per-hand procedure events with server-assigned ordinals (strictly increasing per round,
-- assigned under the round lock as max(ord)+1), so steps can never tie on a timestamp.
create table round_events (
  round_id      text not null references rounds(id),
  ord           integer not null,
  step          text not null,     -- lock | shuffle_command | shuffle_complete | cut_instruction | cut | deal_start
  at            timestamptz not null default clock_timestamp(),
  credential_id text,
  primary key (round_id, ord),
  unique (round_id, step)
);

-- Generic write idempotency for every non-bet write route (start, cut, deal-start, entries, void,
-- review, transfers…). The stored response is written in the SAME transaction as the effect, so a
-- retry after a lost response returns exactly what was committed and never runs twice.
create table idempotency_responses (
  principal        text not null,          -- credential id or user id
  idempotency_key  text not null,
  method           text not null,
  path             text not null,
  request_sha256   text not null,          -- same key with a different request → 422 idempotency_mismatch
  status           integer not null,
  body             text not null,
  created_at       timestamptz not null default now(),
  primary key (principal, idempotency_key)
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
OPEN ──Start hand (lock + shuffle command)──▶ LOCKED ──authentic AND admitted capture──▶ DEALT ──content verified, 3-way match──▶ SETTLED
  │                                        │  (entries alone, or a capture failing      ├─entries disagree─▶ REVIEW ──floor manager──▶ SETTLED | VOID
  │                                        │   authenticity, stay LOCKED)               └─content rejected─▶ EVIDENCE_REJECTED ──auto void──▶ VOID
  │                                        └─authentic but NOT admitted (premature / malformed)─▶ EVIDENCE_REJECTED ──auto void──▶ VOID
  └──────────────────────── void ──────────┴──── result deadline: still LOCKED or DEALT at locked_at + SLA ─────▶ VOID (refund all)

LOCKED substates (procedure_step, enforced; each step is refused unless the previous one is recorded):
  locked ─▶ shuffle_commanded ─▶ shuffled ─▶ cut_instructed ─▶ cut ─▶ dealing
  (Start)   (nonce issued)        (fresh trusted   (random depth    (dealer   (deal-start)
                                   shuffle, signed  drawn)           cut)
                                   for the nonce)
```

- **Round ids** are `<tableId>:h<handNo>`.
- **Betting window** (same as `docs/01` §4): the round for hand N+1 **opens when flop N is captured**, meaning an **authentic and admitted** signed capture of flop N has been recorded and round N has moved to DEALT. Dealer and floor entries alone never open betting. Players bet on flop N+1 while the rest of hand N is played. Betting closes at Start hand N+1.
- **Concurrency contract (applies to every operation below):**
  - Every operation that reads or changes a round runs in **one transaction that starts with `select … from rounds where id = $1 for update`**. That covers start, cut, deal-start, a manual entry, a capture, an image, `resolve()`, a void, a review decision, the sweeper and `ensureOpenRound()`. Concurrent inputs for one round are therefore strictly serialised, and each one sees every input committed before it.
  - A capture also locks its device row (`select … from devices where id = $2 for update`) for the sequence check and update.
  - **Lock order, everywhere: one round row first, then the device, then wallet accounts in ascending account-id order.** A transaction locks **at most one round**, and **never takes a round lock while holding a wallet lock**. Bet placement follows the same order (§5). With every transaction acquiring locks in this one global order, no wait-for cycle can form by design.
  - **Backstop and retry:** PostgreSQL's deadlock detector still runs. Any transaction that fails with `40P01 deadlock_detected` or `40001 serialization_failure` is rolled back completely and **retried from the start up to 3 times** with jittered backoff (10–50 ms, then 50–200 ms, then 200–800 ms). Retries are safe because every write is idempotent (`Idempotency-Key`, `(kind, ref)` on ledger transactions, the terminal compare-and-set). After the last retry the caller gets `503 retry_later`; a worker job is simply left in the outbox. Every retry is counted in metrics and a non-zero deadlock rate raises an alert, because it means a code path broke the lock order.
  - Every input that could complete a round's evidence also **enqueues a `resolve_round` job in `outbox`** in the same transaction. After commit, a worker runs `resolve()` (idempotent: a no-op unless the round is DEALT and every input is present). The sweeper re-enqueues any DEALT round that has all its inputs.
  - **Exactly one terminal outcome:** money moves only after the caller **wins the terminal transition** in the same transaction. That transition is a compare-and-set on an **explicit expected source state that depends on who is settling**: `update rounds set state = 'SETTLED' … where id = $1 and state = $expected returning id`, where `$expected = 'DEALT'` for automatic settlement by `resolve()` and `$expected = 'REVIEW'` for an authorized floor-manager decision in `resolveReview()`. A void is `… set state = 'VOID' … where id = $1 and state in (<voidable states>) returning id`. No other path may settle, and the two settlement paths can never both win because a round is in exactly one state. If no row is returned, the round was already settled or voided, so no payout or refund is posted. Bet rows are updated with the same rule (`where status = 'accepted'`). A refund and a payout for the same bet can therefore never both commit.
  - So two entries committed concurrently, a crash between commit and resolve, or a settle racing a void can never leave a round stuck or paid twice.
- **Opening a round** requires `tableReadiness()`: every certification flag is true **and not expired**, and the last heartbeat is less than 5 s old with a healthy link and the **stream live**. Otherwise the call fails with `409 table_not_ready`.
  - Exactly one round per table may be OPEN.
  - `ensureOpenRound()` reopens betting after a pause, once the table is healthy again.
- **Procedure steps are substates, not timestamps.** Each step below is accepted only from the previous `procedure_step`; anything else gets `409 invalid_procedure_step`. Each accepted step appends a `round_events` row with the next ordinal. `handProcedureProblems()` receives these **ordinals** (strictly increasing, never tied), plus the shuffle nonces.
- **`start`** (OPEN → LOCKED, `procedure_step` `open → shuffle_commanded`), all in one transaction:
  1. Lock the round (bets on this flop close).
  2. Generate a fresh 128-bit **shuffle command nonce**, store `shuffle_command_nonce` / `shuffle_command_at`.
  3. Audit the lock and the command.
  4. Respond with `{ shuffle_command: { nonce } }`; the Table Box's shuffler bridge receives the same command over its own signed channel (`GET …/hands/:n/shuffle-command`).

  `start` does **not** require a prior shuffle: the deck is shuffled **after** the lock (`docs/12` §2a), so no deck order exists while bets are open. `start` does **not** open the next round. Round N+1 opens when this round reaches DEALT (see the betting window above).
- **`shuffle-complete`** (`shuffle_commanded → shuffled`): the Trusted Shuffler performs a **fresh shuffle of one deck** for this command and signs a completion record `{shuffler_id, table_id, hand_no, nonce, completed_at}`; the Table Box forwards it with its **device signature**.
  - The `source` is **derived from the credential, never sent by the caller**: device-signed with a valid shuffler attestation → `shuffler`; any staff credential → `manual`.
  - The attested nonce is stored in `shuffle_attested_nonce`. A completion for another nonce, or a manual one, is recorded but **voids** the hand when `resolve()` runs.
  - In the same transaction PreFlop runs `drawCutDepth()`, stores `cut_depth` / `cut_instruction_at`, moves to `cut_instructed`, and pushes the depth to the dealer tablet (`round.cut_instruction`). The response is `{ cut_depth }`.
- **`cut`** (`cut_instructed → cut`) and **`deal-start`** (`cut → dealing`): staff `dealer`; record the step.

- **Dealer and floor flop entries** (LOCKED, DEALT, REVIEW or EVIDENCE_REJECTED):
  - Stored in `flop_entries`, each with the submitting `credential_id` and `person_id`. The **source is derived from the credential's role**: a `dealer` credential writes the dealer entry; a `floor` or `floor_manager` credential writes the floor entry. The body carries only the cards.
  - The two entries must come from **two different people** (a unique index enforces this). A dealer credential can never write the floor confirmation.
  - Entries **never change the round's state and never open betting**. Each one enqueues `resolve_round`.
- **Signed capture** (`POST …/capture`, device signature). Capture is handled in two stages. The **authenticity** stage runs immediately on receipt.
  - **Idempotent replay first, in any round state:** before any state or sequence check, look up `captures` by `(device_id, seq)`. If the row has the **same signature and identical record**, respond with the original `200 {authentic: true}` and change nothing, even if the round has since moved to DEALT, REVIEW, SETTLED or VOID. This covers a lost success response: the Table Box's retry of the identical record gets its acknowledgement and then advances. The same `seq` with a **different** signature is a conflict: log it in `capture_attempts`, raise a security alert, and respond `409 capture_conflict`.
  - **Authenticity check:**
    - the device is known, not revoked and bound to this table;
    - the Ed25519 signature is valid;
    - `seq = last_seq + 1`;
    - `prev_hash = last_hash`;
    - the capture names this table, round and hand.

    Codex should split the engine check into `verifyCaptureAuthenticity()` (this list, run **once, on receipt**) and `verifyCaptureContent()` (timing, image hash and 3-way match, run by `resolve()`). `verifyCapture()` stays as the two composed together, for standalone use.
  - **Otherwise the round must be LOCKED.** Any other state gets `409 invalid_round_state`, and the upload is logged in `capture_attempts`.
  - **Authentic** → in one transaction (round lock, then device lock):
    1. **Chain ingestion:** insert into `captures` and advance the device checkpoint (`last_seq`, `last_hash`). This always happens for an authentic record, so the Table Box chain stays continuous whatever happens to the round.
    2. **Admission** (`captureAdmissionProblems()` in the engine): deal-start must be recorded (`procedure_step = 'dealing'`); the signed `capturedAt` must fall after the lock and deal-start and within the capture window; and the record must hold three valid, distinct cards. These are all fields of the signed record, so this check runs now, before anything opens.
    3. **Admitted** → move LOCKED → DEALT, **open round N+1** (skipped silently if the table is not ready), and enqueue `resolve_round`.
    4. **Not admitted** (premature or malformed) → move to **EVIDENCE_REJECTED** with the reasons, raise a security alert, **enqueue a durable `void_round` job in `outbox` in the same transaction**, and **do not open round N+1**. Because N+1 never opened, no next-hand bets exist to unwind. The round auto-voids (see *EVIDENCE_REJECTED is always voided* below), and N+1 opens through `ensureOpenRound()` once the table is healthy.
    5. Respond `200 {authentic: true, admitted}`.
  - **Not authentic** →
    1. append the upload to `capture_attempts` with its problems, as evidence only (it is never used to settle);
    2. raise a security alert;
    3. leave the round **LOCKED** and the checkpoint unchanged;
    4. respond `422 evidence_rejected` with `{expected_seq, expected_prev_hash}`.
  - **Checkpoint sync when the Box has lost its buffer:** if the Table Box no longer holds the signed record for its pending `seq` (for example after a crash) and does not know whether the server committed it, it calls `GET /v1/provider/devices/:id/checkpoint` (device-signed). The server returns `{last_seq, last_hash, record, signature}`, where `record` and `signature` are the authentic capture it holds at `last_seq`.
    - The Box **verifies that signature with its own public key** and that `captureHash(record) = last_hash`, then adopts `last_seq + 1` and `last_hash` as its next sequence and `prev_hash`. A re-captured board is **never** accepted as a replay. The Box only learns that its earlier record was committed, and moves past it.
    - If the server holds nothing beyond the Box's own checkpoint, the Box re-captures under its pending `seq`.
    - A `409 capture_conflict` response also carries `{last_seq, last_hash}`, so the Box knows to sync.
    - Every sync is audited.
  - **Retry protocol (Table Box):** the Table Box keeps every signed capture in its encrypted local buffer and **advances its own `seq` only after the server answers `authentic: true`**. On `evidence_rejected` it re-sends the **same signed record** (same `seq` N, same `prev_hash`) from its buffer. If that record is lost, it re-captures the board and signs it again under the same `seq` N and `prev_hash`. The retry is checked against the unchanged checkpoint, so recovery never trusts anything that was rejected. On a timeout or lost response it also re-sends the same record, and the idempotent replay rule above answers `200`. After **3 failed attempts**:
    - the round goes to **VOID** with a refund;
    - the device is flagged;
    - the table pauses until a technician has inspected the Table Box;
    - round N+1 then opens through `ensureOpenRound()` once the table is healthy again.
- **Result deadline (sweeper):** a job runs every few seconds. Any round still **LOCKED or DEALT** at `locked_at + result SLA` is **VOIDed** with a full refund and audited, **whatever is missing**: an authentic capture, the image matching the signed hash, the dealer entry or the floor entry. A round in **REVIEW** has its own floor-decision SLA and voids the same way when that expires. A round in **EVIDENCE_REJECTED** is voided by the sweeper **immediately, with no SLA** (recovery backstop for the outbox job). After a void, round N+1 opens through `ensureOpenRound()` once the table is healthy. Accepted bets can therefore never stay pending.
- **Image upload:** the image bytes may come with the capture or in a separate upload. Bytes are stored only if their SHA-256 equals the **signed** `capture.imageSha256`. The hash can't be changed without breaking the signature, so a corrupted or swapped image can simply be re-uploaded.
- **`resolve()`** runs once an authentic capture, its matching image and both manual entries all exist:
  0. **Deadline first:** under the round lock, if `clock_timestamp() ≥ locked_at + result SLA`, **VOID** the round (refund) whatever evidence has arrived. Evidence that completes after the deadline never pays, even if the sweeper hasn't run yet.
  1. `handProcedureProblems(events)`. If there are any problems → **VOID** with the reason (refund every bet).
  2. `verifyCaptureContent(...)`: content checks only. Authenticity (device, signature, seq and chain) was already checked once on receipt, and is **not** checked again here. The device checkpoint has already moved past this capture, so re-running the sequence and chain checks would wrongly reject it as a replay. The content checks are:
     - the server-stamped `locked_at` / `deal_start_at` timing;
     - the stored image bytes against the signed hash;
     - the dealer and floor entries.
  3. Decision `settle` → **settle**.
  4. Decision `review` (authentic capture, but the dealer or floor entry disagrees) → **REVIEW**, with `review_reasons`.
  5. A content `reject` on an authentic capture (e.g. captured before the lock or deal-start, or after the deadline) → **EVIDENCE_REJECTED**, with the reasons, a security alert and a `void_round` outbox job, all in the same transaction.
- **REVIEW** is resolved only with a **`floor_manager` credential** belonging to a person who did **not** submit either entry for that round: `resolveReview(roundId, credentialId, settle(cards) | void(reason))`, audited with the person id. The floor manager decides after viewing the **verified** evidence image. In one transaction, under the round lock:
  1. **Review deadline first:** if `clock_timestamp() ≥ review_started_at + review SLA`, the decision is refused with `409 review_expired` and the round is **VOIDed** (refund) in that same transaction. A late decision can never pay.
  2. `settle(cards)` wins the terminal transition with `$expected = 'REVIEW'`, then posts payouts; `void(reason)` wins the void transition from REVIEW, then posts refunds. If no row is returned (the sweeper or another decision got there first), nothing is posted and the caller gets `409 invalid_round_state`.
- **EVIDENCE_REJECTED is always voided, durably.** The transaction that enters EVIDENCE_REJECTED also enqueues `void_round` in `outbox`. The worker runs the void (terminal compare-and-set from EVIDENCE_REJECTED, then refunds); the sweeper re-voids any EVIDENCE_REJECTED round it finds, with no SLA. A crash after the rejection commits but before the refund therefore always ends in VOID with every bet refunded exactly once.
- **EVIDENCE_REJECTED can never be settled by hand.** `resolveReview` refuses this state. Its only exit is **VOID** with a full refund, made automatically by the system and audited. A missing or mismatched image never reaches this state, because `resolve()` waits for image bytes that match the signed hash.
- **Void** is allowed from OPEN, LOCKED, DEALT, REVIEW or EVIDENCE_REJECTED, and refunds every accepted bet. It can be requested **only by a `floor_manager` credential** (recorded in `voided_by`) or by the system (sweeper, procedure break, evidence rejection). A dealer cannot void.

Server timestamps use `clock_timestamp()`, never the client's clock.

## 5. Bet placement (PreFlop is the house)

`POST /v1/bets` with an `Idempotency-Key` header.

1. **Replay check:** the same `(user, key)` returns the original bet.
2. **Validate:** the stake is an integer within limits, and the selection exists.
3. **Serialise per round** with an in-process keyed mutex. The exposure cache is per round and is rebuilt from the round's accepted bets in the database whenever it is missing, or when its bet count differs from the database's.
4. **Check the round and table:** the round must be `OPEN` (otherwise `409 round_locked`), and `tableReadiness()` must pass (otherwise `409 table_not_ready`).
5. **Check the price:** `price(statsFor(selection), round.channel)`. It must be offered, and must equal the client's `odds_centi` (otherwise `409 price_changed` with the new odds). The payout must be ≤ the maximum payout.
6. **Check exposure:** `RoundExposure.canAccept()` against `poker_tables.max_round_loss_minor`, otherwise `422 limit_exceeded`. This is a read-only check; the cache is not changed yet.
7. **One database transaction, in the global lock order (§4): round first, then the wallet:**
   1. `select state from rounds where id = $1 for share`, and re-check that it is `OPEN`, because a lock may have landed meanwhile (`FOR SHARE` lets bets on one round run in parallel, but conflicts with the `FOR UPDATE` taken by start, void and settlement);
   2. `lockAccount(wallet)`;
   3. check balance ≥ stake;
   4. insert the bet;
   5. post `bet.stake` (wallet → `PreFlop:bankroll`);
   6. audit;
   7. read the round's accepted-bet count, and compare it with the cache's count plus one.

   A deadlock or serialization failure rolls the whole transaction back and is retried per §4; the idempotency key makes the retry safe.
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

| Route | Auth (credential → role) | Purpose |
|---|---|---|
| `POST /v1/provider/tables/:t/heartbeat` | Device (Table Box) | Link sample, including `streamLive` |
| `POST /v1/provider/tables/:t/hands/:n/start` | Staff: `dealer` | Lock; returns `{shuffle_command: {nonce}}` |
| `GET /v1/provider/tables/:t/hands/:n/shuffle-command` | Device (Table Box shuffler bridge) | `{nonce}` once the round is LOCKED |
| `POST /v1/provider/tables/:t/hands/:n/shuffle-complete` | **Device** with a valid shuffler attestation for the nonce → `shuffler`; any staff credential → recorded as `manual` (voids the hand) | `{attestation}`; no body field for the source. Returns `{cut_depth}` |
| `POST /v1/provider/tables/:t/hands/:n/cut` · `/deal-start` | Staff: `dealer` | Procedure events |
| `POST /v1/provider/tables/:t/hands/:n/flop` | Staff: `dealer` → dealer entry; `floor` / `floor_manager` → floor entry | `{cards}` only; the source comes from the role, and the two entries must be from different people |
| `POST /v1/provider/tables/:t/hands/:n/capture` | Device (Table Box) | `{capture, signature, image_base64?}` → `200 {authentic: true, admitted}` (also returned for an identical replay, in any state), `422 evidence_rejected {expected_seq, expected_prev_hash}`, `409 capture_conflict`, or `409 invalid_round_state` |
| `GET /v1/provider/devices/:id/checkpoint` | Device (that same Table Box only) | `{last_seq, last_hash, record, signature}`, used to resynchronise after the Box loses its buffer |
| `PUT /v1/provider/tables/:t/hands/:n/capture/image` | Device (Table Box) | Raw image bytes; stored only if their SHA-256 equals the signed `imageSha256` |
| `POST /v1/provider/tables/:t/hands/:n/void` | Staff: **`floor_manager` only** | `{reason}` |
| `POST /v1/provider/rounds/:id/review` · `GET /v1/provider/rounds/:id/evidence` | Staff: **`floor_manager`**, not a person who entered the flop. The path has no `:t`, so the server **compares the credential's table with the round's `table_id`** and refuses any other table (`403 forbidden_table`) before reading or deciding | `{action: settle, cards} \| {action: void, reason}` |
| `GET /v1/tables/:t/rounds/current` | Player | Open round, plus its prices from the book |
| `POST /v1/bets` | Player + `Idempotency-Key` | Place a bet |
| `GET /v1/me/bets` · `GET /v1/me/balance` | Player | History and balance |
| `POST /v1/admin/...` | Admin (separate identity provider, MFA) | Clubs, tables, certification with provenance, devices and staff credentials (public key PEM), deposits |

- **Credentials:**
  - **Device:** one Ed25519 key per Table Box, held in its TPM and registered in `devices`.
  - **Staff:** one Ed25519 key **per person and per role**, generated in a managed tablet's hardware keystore and registered in `staff_credentials`. There is no shared table secret.
  - Every credential is **scoped to one table**: the `:t` in the path must equal the credential's `table_id`, otherwise the request gets `403`. Routes marked "Device" refuse staff credentials and vice versa. Each route also checks the role.
- **Signed request envelope** (the same for device and staff credentials). Header: `X-PreFlop-Auth: cred=<credential id>, ts=<unix ms>, nonce=<128-bit random, base64url>, sig=<base64 Ed25519>`. The signature covers this exact byte string:

  ```
  PREFLOP-SIG-1\n<METHOD>\n<path, exactly as sent>\n<query, keys sorted, percent-encoded>\n<ts>\n<nonce>\n<Idempotency-Key or "-">\n<hex SHA-256 of the raw body>
  ```

  Binding the method, path and query means a captured signature can't be replayed against a different route, hand or table.
- **Server checks, in this order:**
  1. the credential exists, is not revoked, and is scoped to this table;
  2. `|now − ts| ≤ 30 s`;
  3. the signature verifies;
  4. `insert into request_nonces (credential_id, nonce)` succeeds, meaning the nonce has never been used.

  A reused nonce gets `401 replayed_request`. Nonces older than 5 minutes are pruned, which is safe because a request older than 30 s is refused anyway.
- **Legitimate retries** (for example after a timeout) use a **new nonce** with the **same `Idempotency-Key`**. The server returns the stored response for that key, so a retry is never mistaken for a replay and never runs twice. **Every write route requires an `Idempotency-Key`.** For bets the key lives on `bets`; for every other write (start, shuffle-complete, cut, deal-start, entries, void, review, admin writes) the response is stored in `idempotency_responses` **in the same transaction as the effect** and returned verbatim on retry. The same key with a different request body or route gets `422 idempotency_mismatch`. The capture route also has its own `(device_id, seq, signature)` replay rule (§4).
- **Errors:** `application/problem+json` with stable `type` codes: `round_locked`, `price_changed`, `limit_exceeded`, `insufficient_funds`, `table_not_ready`, `invalid_round_state`, `invalid_flop`, `unknown_device`, `evidence_rejected`, `capture_conflict`, `replayed_request`, `forbidden_role`, `invalid_procedure_step`, `review_expired`, `idempotency_mismatch`, `retry_later`.

## 8. Acceptance criteria

1. Ledger:
   - every transaction balances (the trigger), and the sum of all accounts per currency is 0;
   - an entry whose currency differs from its account's is rejected (the composite FK).
2. No bet is ever accepted after the lock, including under concurrent requests. Test with parallel placement racing `start`.
3. A procedure break (manual shuffle, missing cut, events out of order) voids the hand and refunds every bet.
4. Evidence:
   - A forged, replayed or edited capture is logged in `capture_attempts`, leaves the round LOCKED and the checkpoint unchanged, and **can never settle**.
   - A retry of the same signed record at the same `seq` then verifies and settles the hand. The next hand's capture (`seq + 1`) also verifies.
   - After 3 failed attempts, the round voids and the table pauses.
   - **Lost response:** the server commits the capture but the `200` is dropped. The Box retries the identical record, gets `200 {authentic: true}`, advances, and its next capture verifies. This also holds when the retry arrives after the round has moved to DEALT, SETTLED or VOID. The same `seq` with a different signature gets `409 capture_conflict`.
   - **Lost buffer and lost response:** the server commits seq N, the response is lost and the Box loses its buffer. The Box's re-capture at N gets `409 capture_conflict` and is **not** accepted. The Box syncs through `GET …/checkpoint`, verifies its own signature on the stored record, moves to N+1, and the next hand's capture verifies.
   - **Deadline at settlement:** the image or a manual entry arriving after `locked_at + SLA`, but before the sweeper runs, leads to VOID, never to a payout.
   - **Settle racing void:** a resolver and the sweeper acting on the same DEALT round produce exactly one terminal state, and **no bet has both a refund and a payout** in the ledger.
   - **Admission gate:** an authentic capture sent before deal-start, timed before the lock, or with duplicate or invalid cards advances the device chain but goes to EVIDENCE_REJECTED, and **does not open round N+1**.
   - **Content-only resolution:** an authentic capture settles even though the device checkpoint has already advanced past it.
   - **Result deadline:** a round whose authentic capture's image never arrives, or that is missing a dealer or floor entry, is VOIDed with a refund at `locked_at + SLA`. No accepted bet stays pending after the deadline.
   - Dealer and floor entries alone never move the round to DEALT and never open round N+1. Only an authentic, admitted capture does.
   - An image whose hash differs from the signed hash is refused, and the round waits for the correct bytes. A capture timed before the lock goes to EVIDENCE_REJECTED and voids.
   - A dealer or floor mismatch on an authentic capture goes to REVIEW.
   - After a REVIEW or VOID hand, the same Table Box's next capture still verifies, because the checkpoint advanced.
   - A shuffle-complete sent with a staff credential is recorded as `manual` and voids the hand.
   - A shuffle-complete before Start hand, or attesting another hand's nonce, is refused (`invalid_procedure_step`) or recorded and voids the hand. Cut and deal-start out of order get `409 invalid_procedure_step`.
   - **Rejected evidence is refunded after a crash:** kill the process after the EVIDENCE_REJECTED transaction commits but before the refund. On restart the outbox worker (or the sweeper) voids the round and every bet is refunded exactly once.
5. **Roles and request authentication:**
   - A dealer credential cannot write the floor entry, cannot void, and cannot resolve a review.
   - Both entries from the same person are refused.
   - A floor manager who entered the flop cannot resolve that round's review.
   - A credential used on another table's path gets `403`.
   - A replayed request (same nonce) gets `401 replayed_request`. A signed request re-targeted to a different path, hand or method fails the signature check.
   - A retry with a new nonce and the same `Idempotency-Key` returns the original response.
   - An expired certification item blocks rounds from opening.
6. **Concurrency and crash safety** (PostgreSQL integration tests):
   - The dealer and floor entries submitted in parallel settle the round **exactly once**.
   - A settlement racing a void ends in exactly one of SETTLED or VOID, with a ledger that matches it.
   - A crash after commit but before resolve is completed by the outbox worker.
   - Two captures racing for one device produce one checkpoint advance.
   - **Bet versus void / settlement on the same wallet:** concurrent bet placement on round N+1 and a void or settlement of round N that pays the same wallet complete without deadlock (lock order), and an injected `40P01` is retried to success.
   - **Review settlement versus void:** a floor-manager `settle` and the sweeper's review-deadline void racing on one REVIEW round end in exactly one terminal state; a decision arriving after the review SLA is refused and the round is VOID.
   - **Generic idempotency:** `start` retried after a lost response returns the stored response and does not issue a second shuffle command.
7. Settlement is idempotent: running it twice pays once.
8. A round never opens while the table is uncertified, the heartbeat is stale, or the stream is off air.
9. The audit chain verifies from genesis, including after 50 concurrent transactions each appending events.
10. **Exposure survives partial failures:** inject a failure after the bet commit but before the cache update. The next bet must still be refused once the round's true worst case reaches the limit.
11. **Simulated table:** 10,000 rounds, each following the real sequence:
   1. Start hand;
   2. a simulated Trusted Shuffler performs a crypto-random shuffle for the command nonce and signs the completion;
   3. the cut performed at the issued depth;
   4. deal-start;
   5. hole cards for 9 seats, a burn, then the flop;
   6. a signed capture with dealer and floor entries.

   Random players bet throughout, and a late bet is attempted after every lock. Check that:
   - the ledger reconciles to zero;
   - every late bet is rejected;
   - the realised house edge is within statistical bounds of the book's edge.
12. **Stacked-deck monitoring:** a simulated shuffler that stacks the deck for "all red" (the audit's F01 construction) must trip the outcome-frequency monitor and pause the table within the configured number of hands (`docs/12` §2a).

## 9. Delivery order

1. Migrations, ledger and audit.
2. Rounds service and readiness.
3. Bets.
4. Settlement.
5. HTTP layer.
6. Simulator.
7. CI with a Postgres service container.
