-- Idle timeout (docs/14 "Accounts and security"): a session records when it was last used, at most
-- once a minute. One left unused for longer than its account's idle limit is refused, whatever its
-- expiry date. Sessions that exist when this runs count from their creation.
alter table sessions add column last_seen_at timestamptz;
