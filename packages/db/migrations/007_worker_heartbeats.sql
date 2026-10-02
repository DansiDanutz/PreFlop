-- Observability (production hardening): every worker loop (standalone or inside the API with
-- RUN_WORKER=true) upserts its row once per tick. GET /v1/health/ready reports not ready unless
-- some worker has beaten within WORKER_HEARTBEAT_MAX_AGE_MS.

create table worker_heartbeats (
  worker_id   text primary key,              -- <host>:<pid>:<random>
  started_at  timestamptz not null default now(),
  beat_at     timestamptz not null default now(),
  ticks       bigint not null default 0
);
create index worker_heartbeats_beat on worker_heartbeats (beat_at desc);
