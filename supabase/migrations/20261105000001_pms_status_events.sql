-- PMS status events — records check-in / check-out / pending changes
-- so supervisors can see a room's stay history below the date.

create table if not exists public.pms_status_events (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null check (branch_code in ('FSL', 'CLF', 'EXT', 'DHA', 'NST')),
  room_number text not null,
  booking_id text,
  check_in date,
  check_out date,
  status text not null,
  checkin_status text,
  guest_name text,
  event_type text not null check (event_type in ('checked_in', 'checked_out', 'pending', 'blocked', 'vacant')),
  event_date timestamptz not null default now(),
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.pms_status_events enable row level security;

drop policy if exists pms_status_events_select_all on public.pms_status_events;
create policy pms_status_events_select_all on public.pms_status_events
  for select to authenticated
  using (true);

drop policy if exists pms_status_events_insert_admin on public.pms_status_events;
create policy pms_status_events_insert_admin on public.pms_status_events
  for insert to authenticated
  with check (exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  ));

create index if not exists idx_pms_status_events_branch_room
  on public.pms_status_events (branch_code, room_number, event_date desc);
