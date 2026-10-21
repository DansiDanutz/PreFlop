-- Outbox jobs whose handler throws are retried with exponential backoff instead of being re-picked
-- first on every pass and aborting it (every job behind them waited forever). After the last attempt
-- (OUTBOX_MAX_ATTEMPTS in worker.ts) the job is parked (failed_at) and a critical alert is raised.
alter table outbox
  add column attempts        int not null default 0,
  add column next_attempt_at timestamptz not null default now(),
  add column last_error      text,
  add column failed_at       timestamptz;
create index outbox_due on outbox (next_attempt_at, id) where done_at is null and failed_at is null;

-- The organizer collateral reserve scans every accepted organizer-house bet of one (owner, currency)
-- on each room bet (bets/rooms.ts collateralReserved).
create index bets_organizer_accepted on bets (house_owner, currency) where status = 'accepted' and house_kind = 'organizer';
