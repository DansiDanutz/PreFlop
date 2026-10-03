-- Real-money gate and money-integrity fixes (external audit): per-table PreFlop approval for real
-- money, a per-user-per-round payout cap, claimed webhook deliveries and nonce pruning.

-- A club can create a real-fiat / real-crypto table and self-attest its certification, but no
-- real-money bet is taken there until the PreFlop team approves the table. Null = not approved.
alter table poker_tables
  add column real_money_approved_at timestamptz,
  add column real_money_approved_by text,
  -- Cap on the sum of one player's potential payouts on one round (PreFlop-house bets).
  -- Null = the table's max_round_loss_minor (the per-bet payout cap).
  add column max_user_round_payout_minor bigint check (max_user_round_payout_minor is null or max_user_round_payout_minor > 0);

-- Changing what was approved (mode, currency, kind, owning club) clears the approval, whichever
-- code path makes the change, unless the same statement sets the approval itself. Certification
-- edits are handled by the club route (docs/14), which knows which items changed.
create function poker_tables_clear_approval() returns trigger language plpgsql as $$
begin
  if (new.mode, new.currency, new.kind, new.club_id) is distinct from (old.mode, old.currency, old.kind, old.club_id)
     and new.real_money_approved_at is not distinct from old.real_money_approved_at then
    new.real_money_approved_at := null;
    new.real_money_approved_by := null;
  end if;
  return new;
end $$;
create trigger poker_tables_clear_approval before update on poker_tables for each row execute function poker_tables_clear_approval();

-- Webhook deliveries are claimed before sending ('sending' + claimed_at), so two workers never
-- send the same row; a claim older than the stale timeout is taken over (the sender died).
alter table webhook_deliveries drop constraint webhook_deliveries_status_check;
alter table webhook_deliveries add constraint webhook_deliveries_status_check check (status in ('pending','sending','delivered','failed'));
alter table webhook_deliveries add column claimed_at timestamptz;
create index webhook_deliveries_claimed on webhook_deliveries (claimed_at) where status = 'sending';

-- The worker prunes consumed nonces by age.
create index request_nonces_seen on request_nonces (seen_at);
