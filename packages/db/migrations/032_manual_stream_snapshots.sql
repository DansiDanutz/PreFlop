-- Webcam tables (owner request, 11 Nov 2026): a manual table can show players its live stream (a
-- webcam over the felt broadcast on YouTube or Twitch), and the console keeps the frame it read the
-- flop from. Only a video id or channel name is stored, never a URL, so nothing else can be framed.
alter table poker_tables add column stream_provider text, add column stream_id text;
alter table poker_tables add constraint poker_tables_stream_check check (
  (stream_provider is null and stream_id is null)
  or (stream_provider = 'youtube' and stream_id ~ '^[A-Za-z0-9_-]{11}$')
  or (stream_provider = 'twitch' and stream_id ~ '^[a-z0-9_]{4,25}$'));

-- The frame the console captured when it read the flop, kept as evidence of what the staff member
-- confirmed: the cards settled on (cards) and the cards the camera read (read_cards), which differ
-- when the operator corrected a misread card. One per round; never changed or removed once written.
create table manual_flop_snapshots (
  round_id    text primary key references rounds(id),
  cards       text[] not null,
  read_cards  text[] not null check (cardinality(read_cards) = 3),
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  image       bytea not null,
  taken_by    text not null,
  taken_at    timestamptz not null default clock_timestamp()
);
create trigger manual_flop_snapshots_append_only before update or delete on manual_flop_snapshots
  for each row execute function forbid_change();
