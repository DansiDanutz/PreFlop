-- Tournaments (docs/17): a buy-in buys a stack of tournament points and a fixed number of bets on
-- live flops; the biggest stack at the end wins, ties going to fewer bets used.

create table tournaments (
  id               text primary key,
  owner_org        text references organizations(id),         -- null = PreFlop
  name             text not null,
  description      text not null default '',
  mode             text not null,
  currency         text not null,
  buy_in_minor     bigint not null check (buy_in_minor >= 0),
  fee_bps          integer not null default 0 check (fee_bps between 0 and 2000),
  added_minor      bigint not null default 0 check (added_minor >= 0),
  added_from       text,                                       -- ledger account the added amount came from
  starting_stack   bigint not null check (starting_stack > 0),
  bets_allowed     integer not null check (bets_allowed between 1 and 500),
  min_stake        bigint not null check (min_stake > 0),
  max_stake        bigint check (max_stake is null or max_stake >= min_stake),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  late_reg_minutes integer not null default 0 check (late_reg_minutes >= 0),
  min_entries      integer not null default 2 check (min_entries >= 1),
  max_entries      integer check (max_entries is null or max_entries >= min_entries),
  payout_bps       integer[] not null,
  -- Stored lifecycle: the clock-derived phase (scheduled/running/settling) is computed on read.
  status           text not null default 'open' check (status in ('open','completed','cancelled')),
  cancel_reason    text,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  check (ends_at > starts_at),
  check (min_stake <= starting_stack)
);
create index tournaments_open on tournaments (ends_at) where status = 'open';

create table tournament_entries (
  tournament_id text not null references tournaments(id),
  user_id       text not null references users(id),
  stack         bigint not null check (stack >= 0),
  bets_used     integer not null default 0 check (bets_used >= 0),
  -- playing → busted (stack below the minimum, nothing pending) or finished (every bet used, nothing pending)
  status        text not null default 'playing' check (status in ('playing','busted','finished')),
  buy_in_minor  bigint not null,
  buy_in_ref    text not null,                               -- ledger ref of the buy-in (refunds reverse it)
  final_rank    integer,
  prize_minor   bigint,
  out_at        timestamptz,
  created_at    timestamptz not null default clock_timestamp(),
  primary key (tournament_id, user_id)
);

create table tournament_bets (
  id              text primary key,
  tournament_id   text not null references tournaments(id),
  user_id         text not null references users(id),
  round_id        text not null references rounds(id),
  idempotency_key text not null,
  selection_id    text not null,
  stake           bigint not null check (stake > 0),
  odds_centi      integer not null,
  status          text not null default 'accepted' check (status in ('accepted','won','lost','void')),
  payout          bigint,
  created_at      timestamptz not null default clock_timestamp(),
  settled_at      timestamptz,
  unique (tournament_id, user_id, idempotency_key),
  -- One bet per flop per entrant: covering every outcome of one flop is not possible.
  unique (tournament_id, user_id, round_id)
);
create index tournament_bets_round on tournament_bets (round_id) where status = 'accepted';

-- Tournament badges sit beside leaderboard badges.
alter table badges add column tournament_id text references tournaments(id);
create unique index badges_user_tournament on badges (user_id, tournament_id) where tournament_id is not null;
