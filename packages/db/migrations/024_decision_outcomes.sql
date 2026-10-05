-- Decision hints (docs/20 §Measuring the adviser): what the team actually did, recorded beside the
-- hint, so the console can show how often the adviser agreed with the people deciding. Advice is
-- advice: the outcome is written after the decision and nothing reads it to decide anything.
alter table decision_hints add column if not exists outcome text;
alter table decision_hints add column if not exists outcome_by text;
alter table decision_hints add column if not exists outcome_at timestamptz;
create index if not exists decision_hints_outcome_at on decision_hints (outcome_at desc) where outcome is not null;
