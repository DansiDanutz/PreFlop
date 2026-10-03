-- Email links expire (a reset link after 1 hour) and are replaced by newer ones. A queued message
-- must never be delivered once its link is dead: it is cancelled instead (expired, or superseded by
-- a newer message of the same kind to the same address). Every message that will not be sent any
-- more (sent, failed, cancelled) loses its body, which holds the link.
alter table email_outbox drop constraint email_outbox_status_check;
alter table email_outbox add constraint email_outbox_status_check check (status in ('pending','sent','failed','cancelled'));
alter table email_outbox add column expires_at timestamptz;
update email_outbox set body = '' where status = 'failed';
