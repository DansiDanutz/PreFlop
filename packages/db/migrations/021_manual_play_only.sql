-- Manual tables take play money only (review of PR #7): every player has a play wallet, while nothing
-- funds a direct chip wallet, so a free-chip manual table could open with bets nobody could place.

-- A free-chip manual table from migration 020 (nothing could fund a direct chip bet on it, though a
-- chip tournament could still bet from its stack) becomes a retired play-money table, so the check
-- below holds on every row and the API keeps starting. Its open or locked hand is voided by the worker
-- (outbox job void_round_migrated → voidRound: bets and tournament bets refunded, audit, events), never
-- by a raw update here. The team opens a new manual table instead.
insert into outbox (kind, ref)
  select 'void_round_migrated', id from rounds where state in ('OPEN', 'LOCKED')
    and table_id in (select id from poker_tables where kind = 'manual' and mode <> 'play')
  on conflict do nothing;
update poker_tables set mode = 'play', currency = 'PLAY', status = 'retired', pause_reason = 'manual tables are play money only (migration 021); open a new table'
  where kind = 'manual' and mode <> 'play';

alter table poker_tables drop constraint if exists poker_tables_manual_free_play;
alter table poker_tables add constraint poker_tables_manual_play_only check (kind <> 'manual' or mode = 'play');
