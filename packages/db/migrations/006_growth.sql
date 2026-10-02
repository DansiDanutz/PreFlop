-- Leaderboards, prize pools and promotions (docs/16).

create table leaderboards (
  id               text primary key,
  owner_org        text references organizations(id),         -- null = PreFlop
  name             text not null,
  mode             text not null check (mode in ('play','virtual-chips','diamonds','real-fiat','real-crypto')),
  currency         text not null,
  scope            text not null default 'global' check (scope in ('global','org','table','room')),
  scope_ref        text,                                       -- org id, table id or room id
  metric           text not null check (metric in ('net','volume','roi','points')),
  min_rounds       integer not null default 1 check (min_rounds >= 1),
  prize_split_bps  integer[] not null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           text not null default 'scheduled' check (status in ('scheduled','active','settled','cancelled')),
  -- Funding (docs/16 §2): share of PreFlop's margin in scope, player contribution (real money only),
  -- fixed amounts from the owner's treasury and from PreFlop.
  margin_bps       integer not null default 0 check (margin_bps between 0 and 5000),
  contribution_bps integer not null default 0 check (contribution_bps between 0 and 500),
  accrued_until    timestamptz,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  settled_at       timestamptz,
  check (ends_at > starts_at),
  check ((scope = 'global') = (scope_ref is null))
);
create index leaderboards_live on leaderboards (status, ends_at);

-- Every source that put value into a pool, so unallocated prizes return pro rata.
create table leaderboard_funding (
  id             text primary key,
  leaderboard_id text not null references leaderboards(id),
  source         text not null check (source in ('margin','contribution','org','sponsor')),
  from_account   text not null,
  amount_minor   bigint not null check (amount_minor > 0),
  created_at     timestamptz not null default now()
);
create index leaderboard_funding_lb on leaderboard_funding (leaderboard_id);

create table leaderboard_results (
  leaderboard_id text not null references leaderboards(id),
  rank           integer not null,
  user_id        text not null references users(id),
  score          numeric not null,
  rounds         integer not null,
  prize_minor    bigint not null default 0,
  badge          text,
  primary key (leaderboard_id, rank)
);

create table badges (
  id             text primary key,
  user_id        text not null references users(id),
  kind           text not null check (kind in ('champion','podium','top10')),
  leaderboard_id text references leaderboards(id),
  label          text not null,
  awarded_at     timestamptz not null default now(),
  unique (user_id, leaderboard_id)
);

create table promotions (
  id             text primary key,
  owner_org      text references organizations(id),           -- null = PreFlop
  kind           text not null check (kind in ('announcement','leaderboard','free-chips','org-drop')),
  title          text not null,
  body           text not null default '',
  link           text,
  leaderboard_id text references leaderboards(id),
  mode           text,
  currency       text,
  amount_minor   bigint,                                       -- per claim (free-chips, org-drop)
  budget_minor   bigint,                                       -- total for org-drop
  claimed_minor  bigint not null default 0,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  status         text not null default 'draft' check (status in ('draft','pending_review','approved','rejected','ended')),
  review_note    text,
  reviewed_by    text,
  created_by     text not null,
  created_at     timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((kind in ('free-chips','org-drop')) = (amount_minor is not null)),
  check (kind <> 'org-drop' or budget_minor is not null)
);
create index promotions_live on promotions (status, starts_at, ends_at);

create table promotion_claims (
  promotion_id text not null references promotions(id),
  user_id      text not null references users(id),
  amount_minor bigint not null,
  claimed_at   timestamptz not null default now(),
  primary key (promotion_id, user_id)
);
