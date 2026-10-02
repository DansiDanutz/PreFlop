-- Login lockout (production hardening): failed password logins per email, shared by every API
-- instance. After 5 failures for one email within 15 minutes the login is refused with
-- 429 login_locked until the oldest of those 5 is 15 minutes old. A successful login clears them.

create table login_failures (
  id     bigserial primary key,
  email  text not null,
  ip     text,
  at     timestamptz not null default now()
);
create index login_failures_email_at on login_failures (email, at desc);
