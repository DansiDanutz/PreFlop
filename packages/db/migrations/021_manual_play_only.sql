-- Manual tables take play money only (review of PR #7): every player has a play wallet, while nothing
-- funds a direct chip wallet, so a free-chip manual table could open with bets nobody could place.
alter table poker_tables drop constraint if exists poker_tables_manual_free_play;
alter table poker_tables add constraint poker_tables_manual_play_only check (kind <> 'manual' or mode = 'play');
