-- Four eyes on agent commissions: the approver (decided_by) and the payer are two different team
-- members, so the payer is recorded in its own column instead of overwriting the approver.
alter table agent_statements add column if not exists paid_by text;
