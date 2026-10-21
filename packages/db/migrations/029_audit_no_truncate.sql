-- API hardening (2026-10): the row-level append-only triggers of migration 001 never fire on
-- TRUNCATE, so a truncate could empty the audit chain (and its head) without any trigger
-- objecting. Statement-level triggers close that path. audit_head stays updatable: every append
-- moves the head (lib/audit.ts), so only its truncation is refused.
create trigger audit_log_no_truncate before truncate on audit_log for each statement execute function forbid_change();
create trigger audit_head_no_truncate before truncate on audit_head for each statement execute function forbid_change();
