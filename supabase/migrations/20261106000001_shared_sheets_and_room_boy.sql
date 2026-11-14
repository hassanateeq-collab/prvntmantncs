-- Shared, cloud-stored sheets so every device sees the same data in real time.
-- 1) Public area sheet header (shift, supervisor name, remarks, signatures)
-- 2) Room Boy Daily Report header (room boy name, supervisor sign, BM sign)
-- 3) Room Boy Daily Report rows (room, status, time in, time out, signature)

-- ---------------------------------------------------------------------------
-- Public area sheet header
-- ---------------------------------------------------------------------------
create table if not exists public.public_area_sheets (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null check (branch_code in ('FSL', 'CLF', 'EXT', 'DHA', 'NST')),
  sheet_date date not null,
  shift text,
  supervisor_name text,
  supervisor_remarks text,
  supervisor_signature text,
  attendant_signature text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_code, sheet_date)
);

alter table public.public_area_sheets enable row level security;

drop policy if exists public_area_sheets_select_all on public.public_area_sheets;
create policy public_area_sheets_select_all on public.public_area_sheets
  for select to authenticated using (true);

drop policy if exists public_area_sheets_insert_all on public.public_area_sheets;
create policy public_area_sheets_insert_all on public.public_area_sheets
  for insert to authenticated with check (true);

drop policy if exists public_area_sheets_update_all on public.public_area_sheets;
create policy public_area_sheets_update_all on public.public_area_sheets
  for update to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Room Boy Daily Report header
-- ---------------------------------------------------------------------------
create table if not exists public.room_boy_sheets (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null check (branch_code in ('FSL', 'CLF', 'EXT', 'DHA', 'NST')),
  report_date date not null,
  room_boy_name text,
  supervisor_sign text,
  bm_sign text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_code, report_date)
);

alter table public.room_boy_sheets enable row level security;

drop policy if exists room_boy_sheets_select_all on public.room_boy_sheets;
create policy room_boy_sheets_select_all on public.room_boy_sheets
  for select to authenticated using (true);

drop policy if exists room_boy_sheets_insert_all on public.room_boy_sheets;
create policy room_boy_sheets_insert_all on public.room_boy_sheets
  for insert to authenticated with check (true);

drop policy if exists room_boy_sheets_update_all on public.room_boy_sheets;
create policy room_boy_sheets_update_all on public.room_boy_sheets
  for update to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Room Boy Daily Report rows
-- ---------------------------------------------------------------------------
create table if not exists public.room_boy_entries (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null check (branch_code in ('FSL', 'CLF', 'EXT', 'DHA', 'NST')),
  report_date date not null,
  room_no text not null,
  status text,
  time_in text,
  time_out text,
  signature text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_code, report_date, room_no)
);

alter table public.room_boy_entries enable row level security;

drop policy if exists room_boy_entries_select_all on public.room_boy_entries;
create policy room_boy_entries_select_all on public.room_boy_entries
  for select to authenticated using (true);

drop policy if exists room_boy_entries_insert_all on public.room_boy_entries;
create policy room_boy_entries_insert_all on public.room_boy_entries
  for insert to authenticated with check (true);

drop policy if exists room_boy_entries_update_all on public.room_boy_entries;
create policy room_boy_entries_update_all on public.room_boy_entries
  for update to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Keep role rules intact on the shared public area records:
--   sweepers can only set staff_checked
--   supervisors can only set supervisor_checked / supervisor_name
--   admins may set both
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
    else
      new.supervisor_checked := false;
      new.supervisor_name := null;
    end if;
  elsif caller_role = 'supervisor' then
    if tg_op = 'UPDATE' then
      new.staff_checked := old.staff_checked;
    else
      new.staff_checked := false;
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

-- ---------------------------------------------------------------------------
-- Real-time publication
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'public_area_sheets'
  ) then
    alter publication supabase_realtime add table public.public_area_sheets;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_boy_sheets'
  ) then
    alter publication supabase_realtime add table public.room_boy_sheets;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_boy_entries'
  ) then
    alter publication supabase_realtime add table public.room_boy_entries;
  end if;
end;
$$;

-- Fast lookups
create index if not exists idx_public_area_sheets_branch_date
  on public.public_area_sheets (branch_code, sheet_date);

create index if not exists idx_room_boy_sheets_branch_date
  on public.room_boy_sheets (branch_code, report_date);

create index if not exists idx_room_boy_entries_branch_date
  on public.room_boy_entries (branch_code, report_date);
