-- Agents: a two-level affiliate on net gaming revenue (docs/16 §4).

create table agents (
  user_id          text primary key references users(id),
  code             text not null unique,
  parent_agent_id  text references agents(user_id),
  status           text not null default 'applied' check (status in ('applied','active','suspended','rejected')),
  rate_l1_bps      integer not null default 2500 check (rate_l1_bps between 0 and 4000),
  rate_l2_bps      integer not null default 500 check (rate_l2_bps between 0 and 1000),
  note             text,
  approved_by      text,
  created_at       timestamptz not null default now(),
  check (parent_agent_id is null or parent_agent_id <> user_id)
);

-- Set once at registration from ?ref=CODE; never changed afterwards.
alter table users add column referred_by_agent text references agents(user_id);
create index users_referred_by on users (referred_by_agent) where referred_by_agent is not null;

create table agent_statements (
  id              text primary key,
  agent_id        text not null references agents(user_id),
  month           date not null,                       -- first day of the month
  currency        text not null,
  level           smallint not null check (level in (1, 2)),
  ngr_minor       bigint not null,                     -- this month's NGR at this level
  carry_in_minor  bigint not null default 0,           -- level 1 only: negative balance brought forward
  carry_out_minor bigint not null default 0,           -- level 1 only: negative balance carried to next month
  rate_bps        integer not null,
  amount_minor    bigint not null check (amount_minor >= 0),
  status          text not null default 'draft' check (status in ('draft','approved','paid')),
  decided_by      text,
  created_at      timestamptz not null default now(),
  unique (agent_id, month, currency, level)
);
