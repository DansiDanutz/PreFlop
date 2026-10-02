-- Rooms (organizer- or club-run books in chips/diamonds), favorites, responsible gaming,
-- sandbox payments, transfers, partner API clients and webhooks.

create table user_favorites (
  user_id        text primary key references users(id),
  selection_ids  text[] not null,
  updated_at     timestamptz not null default now()
);

alter table users add column self_excluded_until timestamptz;

-- Responsible-gaming limits. Decreases apply at once; increases wait 24 h (pending_*).
create table rg_limits (
  user_id            text primary key references users(id),
  deposit_day_minor  bigint,
  loss_day_minor     bigint,
  session_minutes    integer,
  pending            jsonb,
  pending_effective_at timestamptz,
  updated_at         timestamptz not null default now()
);

create table rooms (
  id           text primary key,
  org_id       text not null references organizations(id),
  name         text not null,
  table_id     text not null references poker_tables(id),
  mode         text not null check (mode in ('virtual-chips','diamonds')),
  currency     text not null,
  house        text not null check (house in ('organizer','pool')),
  rules        jsonb not null,
  status       text not null default 'active' check (status in ('active','paused','closed')),
  visibility   text not null default 'public' check (visibility in ('public','invite')),
  invite_code  text unique,
  created_at   timestamptz not null default now()
);
create index rooms_org on rooms (org_id);

create table room_members (
  room_id   text not null references rooms(id),
  user_id   text not null references users(id),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table bets drop constraint bets_house_kind_check;
alter table bets add constraint bets_house_kind_check check (house_kind in ('preflop','organizer','pool'));
-- Stake that actually plays (diamond bets: stake − PreFlop fee − rake). Null = the whole stake.
alter table bets add column at_risk_minor bigint;
create index bets_room on bets (room_id, round_id) where room_id is not null;

-- Sandbox payment rail (cards, bank, USDT/USDC). Real providers plug in behind the same table.
create table payments (
  id            text primary key,
  user_id       text references users(id),
  org_id        text references organizations(id),
  kind          text not null check (kind in ('deposit','withdrawal','purchase')),
  method        text not null,
  mode          text not null,
  currency      text not null,
  amount_minor  bigint not null check (amount_minor > 0),
  status        text not null check (status in ('pending','completed','failed','cancelled')),
  provider      text not null default 'sandbox',
  provider_ref  text,
  address       text,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index payments_user on payments (user_id, created_at desc);
create index payments_org on payments (org_id, created_at desc);

create table transfers (
  id            text primary key,
  org_id        text not null references organizations(id),
  user_id       text not null references users(id),
  mode          text not null,
  currency      text not null,
  amount_minor  bigint not null check (amount_minor > 0),
  by_user       text,
  created_at    timestamptz not null default now()
);
create index transfers_org on transfers (org_id, created_at desc);

create table api_clients (
  id             text primary key,
  org_id         text not null references organizations(id),
  name           text not null,
  secret_sha256  text not null,
  revoked        boolean not null default false,
  created_at     timestamptz not null default now()
);

create table partner_tokens (
  token_sha256  text primary key,
  client_id     text not null references api_clients(id),
  org_id        text not null references organizations(id),
  expires_at    timestamptz not null
);

create table webhooks (
  id          text primary key,
  org_id      text not null references organizations(id),
  url         text not null,
  secret      text not null,
  events      text[] not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table webhook_deliveries (
  id               text primary key,
  webhook_id       text not null references webhooks(id),
  event_id         text not null,
  event_type       text not null,
  payload          jsonb not null,
  status           text not null default 'pending' check (status in ('pending','delivered','failed')),
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  created_at       timestamptz not null default now(),
  delivered_at     timestamptz,
  unique (webhook_id, event_id)
);
create index webhook_deliveries_due on webhook_deliveries (next_attempt_at) where status = 'pending';
