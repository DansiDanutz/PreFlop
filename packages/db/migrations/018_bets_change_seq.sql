-- A change counter for bets, read by the statements cache (lib/statements.ts): any insert, update
-- or delete on bets advances it, so cached sharing results are recomputed after a settlement or a
-- backdated correction. nextval is cheap and never contended (one call per statement).
create sequence bets_change_seq;
create function bets_changed() returns trigger language plpgsql as $$
begin
  perform nextval('bets_change_seq');
  return null;
end $$;
create trigger bets_changed after insert or update or delete on bets
  for each statement execute function bets_changed();
