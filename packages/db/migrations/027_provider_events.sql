-- Provider webhook events that arrived before the payment (or KYC session) carried its reference
-- (docs/21): a fast provider can report the outcome before the apply phase stores provider_ref. The
-- authenticated event is kept here and applied the moment the reference is attached, so an early
-- verdict is never lost. Rows are marked applied, never deleted: they are part of the reconciliation trail.
create table provider_events (
  id          bigserial primary key,
  provider    text not null,
  type        text not null check (type in ('payment', 'kyc')),
  ref         text not null,
  status      text not null,
  details     jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  applied_at  timestamptz
);
create index provider_events_open on provider_events (provider, type, ref) where applied_at is null;
