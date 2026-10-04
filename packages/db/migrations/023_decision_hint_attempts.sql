-- Decision hints (docs/20): how many times a question was asked. A failed hint is retried a few
-- times, ten minutes apart (worker.ts HINT_RETRY_MAX / HINT_RETRY_AFTER), then left alone.
alter table decision_hints add column if not exists attempts int not null default 1;
