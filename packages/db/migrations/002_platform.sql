-- Platform tables: identities, organizations, settings, applications, table kinds and bet houses.

-- Global settings and per-territory feature flags. Physical-table play is OFF (owner decision, docs/06 #7).
create table settings (
  key    text primary key,
  value  jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into settings (key, value) values
  ('physical_play_enabled', 'false'),
  ('modes_enabled', '{"play": true, "virtual-chips": true, "diamonds": true, "real-fiat": false, "real-crypto": false}'),
  ('territories', '{}');

create table users (
  id             text primary key,
  email          text not null unique,
  password_hash  text not null,
  display_name   text not null,
  country        text,
  status         text not null default 'active' check (status in ('active','suspended','self_excluded','closed')),
  kyc_status     text not null default 'none' check (kyc_status in ('none','pending','verified','rejected')),
  platform_role  text check (platform_role in ('admin','ops','risk','support')),
  partner_id     text,                         -- set for players that belong to a partner (Partner API)
  external_ref   text,                         -- partner's player id
  created_at     timestamptz not null default now(),
  unique (partner_id, external_ref)
);

create table sessions (
  token_sha256  text primary key,
  user_id       text not null references users(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index sessions_user on sessions (user_id);

-- Clubs, partners (betting companies) and organizers share one organization table.
-- A club's organization id equals its clubs.id.
create table organizations (
  id          text primary key,
  kind        text not null check (kind in ('club','partner','organizer')),
  name        text not null,
  status      text not null default 'active' check (status in ('applied','active','suspended')),
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table memberships (
  user_id  text not null references users(id),
  org_id   text not null references organizations(id),
  role     text not null check (role in ('owner','admin','viewer')),
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

-- Applications from the public website (become a club / partner / organizer).
create table applications (
  id          text primary key,
  kind        text not null check (kind in ('club','partner','organizer')),
  user_id     text references users(id),
  name        text not null,
  email       text not null,
  details     jsonb not null default '{}'::jsonb,
  status      text not null default 'new' check (status in ('new','approved','rejected')),
  decided_by  text,
  created_at  timestamptz not null default now()
);

alter table poker_tables
  add column kind text not null default 'physical' check (kind in ('physical','simulated')),
  add column status text not null default 'active' check (status in ('active','paused','retired')),
  add column pause_reason text;

-- The Trusted Shuffler's attestation key, paired with the Table Box (docs/12 §2a).
alter table devices add column shuffler_public_key_pem text;

alter table bets
  add column house_kind text not null default 'preflop' check (house_kind in ('preflop','organizer')),
  add column house_owner text not null default 'PreFlop',
  add column room_id text,
  add column channel text not null default 'direct',
  add column partner_id text,
  add column fee_minor bigint not null default 0;
create index bets_user on bets (user_id, placed_at desc);

-- Integrity alerts (outcome monitoring, evidence, security).
create table alerts (
  id          bigserial primary key,
  table_id    text,
  round_id    text,
  kind        text not null,
  severity    text not null default 'warning' check (severity in ('info','warning','critical')),
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);
create index alerts_open on alerts (created_at desc) where resolved_at is null;

-- Exactly one OPEN round per table (docs/13 §4), enforced by the database.
create unique index rounds_one_open_per_table on rounds (table_id) where state = 'OPEN';

-- Chain ingestion stores every authentic capture; admission is recorded alongside it.
alter table captures
  add column admitted boolean not null default true,
  add column admission_problems jsonb;
