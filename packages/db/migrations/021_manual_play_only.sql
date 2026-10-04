-- Manual tables take play money only (review of PR #7): every player has a play wallet, while nothing
-- funds a direct chip wallet, so a free-chip manual table could open with bets nobody could place.

-- A free-chip manual table from migration 020 (nothing could fund a bet on it, so none was placed) is
-- turned into a retired play-money table, and its open hand voided, so the check below holds on every
-- row and the API keeps starting. The team opens a new manual table instead.
update rounds set state = 'VOID', voided_at = clock_timestamp(), void_reason = 'manual tables are play money only (migration 021)', voided_by = 'system:migration'
  where state = 'OPEN' and table_id in (select id from poker_tables where kind = 'manual' and mode <> 'play');
update poker_tables set mode = 'play', currency = 'PLAY', status = 'retired', pause_reason = 'manual tables are play money only (migration 021); open a new table'
  where kind = 'manual' and mode <> 'play';

alter table poker_tables drop constraint if exists poker_tables_manual_free_play;
alter table poker_tables add constraint poker_tables_manual_play_only check (kind <> 'manual' or mode = 'play');
