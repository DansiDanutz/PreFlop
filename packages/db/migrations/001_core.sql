-- Generated from docs/13-phase1-backend-spec.md §3 (keep in sync). Do not edit applied migrations; add a new file.
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

