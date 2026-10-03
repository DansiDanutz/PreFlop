-- Replaces 018's change counter with a change log (statements cache, lib/statements.ts). A counter
-- advanced before its transaction committed could leave a cached result stale; a log of
-- transaction ids lets a cached result check its own snapshot instead.
--
-- Every transaction that inserts, updates or deletes bets records its id once (statement-level
-- trigger, one row per transaction, no shared row to contend on). A cached result remembers the
-- snapshot it was computed in and is stale as soon as a committed change is not visible in that
-- snapshot (pg_visible_in_snapshot), including a transaction that was running during the
-- computation and committed afterwards.
--
-- finished_at is set by the worker once the transaction is no longer running (its id is below
-- every running snapshot's xmin); a row is deleted only well after that, so a long-running
-- transaction's row is never pruned while a cached result may still need it.
create table bets_changes (
  xid         xid8 primary key,
  at          timestamptz not null default now(),
  finished_at timestamptz
);
create index bets_changes_unfinished on bets_changes (xid) where finished_at is null;

-- Same function name as 018, so the existing trigger now writes the log.
create or replace function bets_changed() returns trigger language plpgsql as $$
begin
  insert into bets_changes (xid) values (pg_current_xact_id()) on conflict do nothing;
  return null;
end $$;

drop sequence bets_change_seq;
