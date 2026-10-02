-- Outcome monitoring (docs/12 §2a): per-table CUSUM statistic for every selection.
alter table poker_tables add column monitor jsonb not null default '{}'::jsonb;
alter table poker_tables add column monitor_hands integer not null default 0;
