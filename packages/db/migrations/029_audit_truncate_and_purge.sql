-- API hardening (2026-10): the row-level append-only triggers of migration 001 never fire on
-- TRUNCATE, so a truncate could empty the audit chain (and its head) without any trigger
-- objecting. Statement-level triggers close that path. audit_head stays updatable: every append
-- moves the head (lib/audit.ts), so only its truncation is refused.
create trigger audit_log_no_truncate before truncate on audit_log for each statement execute function forbid_change();
create trigger audit_head_no_truncate before truncate on audit_head for each statement execute function forbid_change();

-- The worker's once-a-minute purge of long-expired rows (worker.ts pruneExpired) filters each table
-- by expiry. Without these it scanned every retained row on every pass, even with nothing to delete.
create index sessions_expires on sessions (expires_at);
create index partner_tokens_expires on partner_tokens (expires_at);
create index email_tokens_spent on email_tokens ((coalesce(used_at, expires_at)));
create index login_failures_at on login_failures (at);
