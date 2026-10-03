-- External source audit (2026-10): self-exclusion invariant, cancellable webhook deliveries and
-- an email outbox with per-message backoff.

-- Self-exclusion is enforced on self_excluded_until, independently of the mutable status: while it
-- has not ended the account can never be 'active', whichever path (admin status change, suspend
-- then reactivate, a direct update) tries to set it. Lifting happens only once the period is over
-- (sign-in after self_excluded_until, routes/player.ts).
create function users_self_exclusion_guard() returns trigger language plpgsql as $$
begin
  if new.status = 'active' and new.self_excluded_until is not null and new.self_excluded_until > now() then
    raise exception 'self-exclusion of % is in force until %', new.id, new.self_excluded_until
      using errcode = 'P0001', hint = 'self_excluded';
  end if;
  return new;
end $$;
create trigger users_self_exclusion_guard before insert or update of status, self_excluded_until on users
  for each row execute function users_self_exclusion_guard();

-- Accounts already re-activated through a bypass before this migration go back to self-excluded.
update users set status = 'self_excluded' where status = 'active' and self_excluded_until > now();

-- Disabling a webhook cancels its queued (pending or retrying) deliveries; a delivery already
-- claimed by a sender ('sending') may finish. Re-enabling never revives cancelled rows.
alter table webhook_deliveries drop constraint webhook_deliveries_status_check;
alter table webhook_deliveries add constraint webhook_deliveries_status_check check (status in ('pending','sending','delivered','failed','cancelled'));

-- Email outbox: one state per message, retried with exponential backoff (next_attempt_at) up to a
-- maximum number of attempts, then 'failed'.
alter table email_outbox add column status text not null default 'pending' check (status in ('pending','sent','failed'));
alter table email_outbox add column next_attempt_at timestamptz not null default now();
alter table email_outbox add column failed_at timestamptz;
update email_outbox set status = 'sent' where sent_at is not null;
update email_outbox set status = 'failed', failed_at = now() where sent_at is null and attempts >= 10;
drop index email_outbox_pending;
create index email_outbox_due on email_outbox (next_attempt_at, id) where status = 'pending';
