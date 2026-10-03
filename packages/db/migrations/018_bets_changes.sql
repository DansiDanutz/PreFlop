-- Change log for bets, read by the statements cache (lib/statements.ts). Every transaction that
-- inserts, updates or deletes bets records its transaction id once (statement-level trigger, one
-- row per transaction, no shared row to contend on). A cached result remembers the snapshot it was
-- computed in; it is stale as soon as a committed change is not visible in that snapshot
-- (pg_visible_in_snapshot), which also catches a transaction that was still running while the
-- result was computed and committed afterwards. Rows older than any cached result are pruned by
-- the worker.
create table bets_changes (
  xid xid8 primary key,
  at  timestamptz not null default now()
);
create function bets_changed() returns trigger language plpgsql as $$
begin
  insert into bets_changes (xid) values (pg_current_xact_id()) on conflict do nothing;
  return null;
end $$;
create trigger bets_changed after insert or update or delete on bets
  for each statement execute function bets_changed();
