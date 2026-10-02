-- Account security and responsible gaming before real money (docs/14 "Accounts and security"):
-- date of birth (age gate), email verification, password reset, play sessions with a time limit,
-- territories, and TOTP two-factor authentication for staff.

-- Date of birth as declared at registration (or by a licensed partner). A plain date, no zone.
-- email_verified_at: set when the owner of the address opens the verification (or reset) link.
alter table users
  add column date_of_birth     date,
  add column email_verified_at timestamptz;

-- A play session starts when the session is created (sign-in); session_minutes counts from here.
alter table sessions add column play_started_at timestamptz not null default now();

-- Single-use links sent by email. Only the SHA-256 of the token is stored (as for owner claims).
create table email_tokens (
  token_hash  text primary key,
  user_id     text not null references users(id),
  purpose     text not null check (purpose in ('verify','reset')),
  email       text not null,                -- the address the link was sent to; it must still match
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index email_tokens_user on email_tokens (user_id, purpose);

-- Outgoing email. The worker hands pending rows to the configured transport; the body (which can
-- hold a live link) is erased once the message is sent.
create table email_outbox (
  id          bigserial primary key,
  to_email    text not null,
  template    text not null,                -- verify_email | reset_password
  subject     text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    integer not null default 0,
  last_error  text
);
create index email_outbox_pending on email_outbox (id) where sent_at is null;

-- TOTP (RFC 6238) second factor. secret is base32; enabled_at is null while enrolment is pending.
-- last_step is the last accepted 30 s time step: a code is never accepted twice (replay).
-- The secret is stored as is: no encryption key is configured yet (see docs/14).
create table user_mfa (
  user_id     text primary key references users(id),
  secret      text not null,
  created_at  timestamptz not null default now(),
  enabled_at  timestamptz,
  last_step   bigint
);

-- When true, PreFlop team accounts (platform_role set) without 2FA can only enrol.
insert into settings (key, value) values ('require_staff_mfa', 'false') on conflict (key) do nothing;

-- territories takes a fixed shape: {"blocked": [ISO codes], "real_money_allowed": [ISO codes]}.
update settings set value = '{"blocked": [], "real_money_allowed": []}'::jsonb where key = 'territories' and value = '{}'::jsonb;
