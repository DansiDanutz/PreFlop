-- Decision hints (docs/20): answers of the decision model (TypeSafe AI Jev) stored beside the thing
-- they advise on, so the console shows the same hint to everyone and nothing is asked twice.
-- kind: 'alert' (ref = alerts.id) | 'review' (ref = rounds.id). Hints are advice only: no money moves on them.
create table decision_hints (
  kind       text not null,
  ref        text not null,
  model      text,
  answers    jsonb not null default '{}'::jsonb,
  error      text,
  created_at timestamptz not null default now(),
  primary key (kind, ref)
);
