-- A month's agent statements are built once (docs/16 §4). Re-closing a month never re-attributes
-- revenue, even if an agent changed parent or status since.
create table agent_month_closes (
  month      date primary key,                         -- first day of the month
  statements integer not null,
  closed_by  text not null,
  closed_at  timestamptz not null default now()
);

-- Months already closed before this table existed.
insert into agent_month_closes (month, statements, closed_by)
select month, count(*), 'migration' from agent_statements group by month;
