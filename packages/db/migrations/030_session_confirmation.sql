-- Step-up for money leaving the platform (docs/14 "Accounts and security"): a session records when
-- its holder last proved the password or the authenticator code. Signing in sets it; POST
-- /v1/me/confirm renews it; a withdrawal needs it to be recent. Sessions a partner opens for its
-- players, and sessions that existed before this migration, start unconfirmed.
alter table sessions add column confirmed_at timestamptz;
