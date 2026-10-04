-- Manual tables (owner request, 4 Oct 2026): the PreFlop team types each flop into the console
-- instead of a Table Box capturing it from the stream. A test path for camera-free play and,
-- next, for webcam card recognition. Guardrails:
-- - play money and free chips only, enforced here as well as in the API;
-- - its own switch, manual_tables_enabled, separate from physical_play_enabled;
-- - the flop is typed only after betting has closed, and every entry is audited with who typed it.

alter table poker_tables drop constraint if exists poker_tables_kind_check;
alter table poker_tables add constraint poker_tables_kind_check check (kind in ('physical', 'simulated', 'manual'));
alter table poker_tables add constraint poker_tables_manual_free_play
  check (kind <> 'manual' or mode in ('play', 'virtual-chips'));

-- Where a settled flop came from: the signed capture (vision) or typed in the console (manual).
alter table rounds add column flop_source text check (flop_source in ('vision', 'manual'));

insert into settings (key, value) values ('manual_tables_enabled', 'true') on conflict (key) do nothing;
