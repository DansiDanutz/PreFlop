-- External audit, round 4: idempotent money routes and a machine-readable table pause kind.

-- Payment ids (and so provider refs) are derived from the caller's Idempotency-Key; a provider
-- reference is accepted once, so the same charge or payout can never be recorded twice.
create unique index payments_provider_ref on payments (provider_ref) where provider_ref is not null;

-- Why a table is paused, for code (pause_reason stays the human text): 'monitor' (outcome monitor
-- alarm: open rounds are voided), 'evidence' (Table Box inspection after failed captures),
-- 'floor' (paused from the club tablet), 'platform' (paused by the PreFlop team).
-- Null while the table is active.
alter table poker_tables add column pause_kind text check (pause_kind in ('monitor','evidence','floor','platform'));
update poker_tables set pause_kind = case
    when pause_reason like 'outcome monitor%' then 'monitor'
    when pause_reason like 'Table Box inspection%' then 'evidence'
    when pause_reason like '%by PreFlop%' then 'platform'
    else 'floor' end
  where status = 'paused';
