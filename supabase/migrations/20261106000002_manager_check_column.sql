-- Add the Manager Check column to the Daily Public Area Cleaning Routing &
-- Quality Checklist.
--
-- Role rules (clarified):
--   sweeper    -> may only set staff_checked (never supervisor/manager)
--   supervisor -> may only set supervisor_checked / supervisor_name
--   admin/Kamran -> may ONLY set manager_checked / manager_name.
--                 Kamran can SEE supervisor checks but cannot TICK them;
--                 only supervisors tick their own column.

alter table public.public_inspection_records
  add column if not exists manager_checked boolean not null default false;

alter table public.public_inspection_records
  add column if not exists manager_name text;

-- ---------------------------------------------------------------------------
-- Role guard: each role can write only its own check column.
-- ---------------------------------------------------------------------------
create or replace function public.guard_public_inspection_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  select role into caller_role from public.profiles where id = auth.uid();

  if caller_role = 'sweeper' then
    if tg_op = 'UPDATE' then
      new.supervisor_checked := old.supervisor_checked;
      new.supervisor_name := old.supervisor_name;
      new.manager_checked := old.manager_checked;
      new.manager_name := old.manager_name;
    else
      new.supervisor_checked := false;
      new.supervisor_name := null;
      new.manager_checked := false;
      new.manager_name := null;
    end if;
  elsif caller_role = 'supervisor' then
    if tg_op = 'UPDATE' then
      new.staff_checked := old.staff_checked;
      new.manager_checked := old.manager_checked;
      new.manager_name := old.manager_name;
    else
      new.staff_checked := false;
      new.manager_checked := false;
      new.manager_name := null;
    end if;
  elsif caller_role = 'admin' then
    -- Admin may only set manager fields; supervisor fields are protected.
    if tg_op = 'UPDATE' then
      new.supervisor_checked := old.supervisor_checked;
      new.supervisor_name := old.supervisor_name;
    else
      new.supervisor_checked := false;
      new.supervisor_name := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_public_inspection_fields_trigger
  on public.public_inspection_records;
create trigger guard_public_inspection_fields_trigger
  before insert or update on public.public_inspection_records
  for each row execute function public.guard_public_inspection_fields();
