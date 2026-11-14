-- Manager cross-check inspection, assignment remarks, persistent notifications.

-- 1. Extra room entry fields.
alter table public.room_boy_entries
  add column if not exists assignment_remarks text,
  add column if not exists assignment_acknowledged_at timestamptz,
  add column if not exists manager_inspected_by text,
  add column if not exists manager_inspected_at timestamptz,
  add column if not exists manager_status text,
  add column if not exists manager_rating integer,
  add column if not exists manager_notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'room_boy_entries_manager_rating_check'
  ) then
    alter table public.room_boy_entries
      add constraint room_boy_entries_manager_rating_check
      check (manager_rating is null or (manager_rating >= 1 and manager_rating <= 5));
  end if;
end $$;

-- 2. Assignment remark stored on the room boy notification.
alter table public.room_boy_notifications
  add column if not exists remark text;

-- 3. Allow the manager inspection notification type.
alter table public.staff_notifications
  drop constraint if exists staff_notifications_notification_type_check;
alter table public.staff_notifications
  add constraint staff_notifications_notification_type_check
  check (notification_type in (
    'room_assigned',
    'rating_received',
    'test_notification',
    'room_checkout',
    'room_cleaning',
    'manager_inspection'
  ));

-- 4. Configurable assignment remark options (managed in Settings).
create table if not exists public.room_remark_options (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists room_remark_options_label_key
  on public.room_remark_options (lower(label));

alter table public.room_remark_options enable row level security;

drop policy if exists room_remark_options_select on public.room_remark_options;
create policy room_remark_options_select on public.room_remark_options
  for select to authenticated using (is_active);

drop policy if exists room_remark_options_admin on public.room_remark_options;
create policy room_remark_options_admin on public.room_remark_options
  for all to authenticated using (is_admin()) with check (is_admin());

insert into public.room_remark_options (label, sort_order)
values
  ('Urgent', 1),
  ('Guest waiting', 2),
  ('Priority', 3),
  ('Deep clean', 4)
on conflict do nothing;

-- 5. Notify the branch supervisor when a housekeeping manager cross-checks a
-- room and rates the supervisor.
create or replace function public.notify_manager_inspection(
  p_branch_code text,
  p_room_number text,
  p_manager_name text,
  p_manager_status text,
  p_rating integer,
  p_notes text,
  p_reference text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_ref text;
  v_inserted integer;
  v_status text := lower(coalesce(nullif(trim(p_manager_status), ''), 'verified'));
  v_title text;
  v_message text;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and is_active;

  if v_role is null then
    raise exception 'Not authorised.';
  end if;
  if v_role not in ('superadmin', 'admin') then
    raise exception 'Only housekeeping managers can record manager inspections.';
  end if;

  v_ref := coalesce(
    nullif(p_reference, ''),
    'manager:' || coalesce(p_branch_code, '') || ':' ||
      coalesce(p_room_number, '') || ':' || to_char(now(), 'YYYY-MM-DD')
  );

  v_title := 'Manager check: Room ' || coalesce(p_room_number, '?') ||
    ' ' || v_status;

  v_message := coalesce(p_manager_name, 'Housekeeping manager') ||
    ' cross-checked room ' || coalesce(p_room_number, '?') ||
    ' (' || coalesce(p_branch_code, '') || ') - ' || v_status ||
    case when p_rating is not null then '. Supervisor rating ' || p_rating || '/5' else '' end ||
    case when coalesce(p_notes, '') <> '' then '. ' || p_notes else '' end;

  insert into public.staff_notifications (
    staff_email,
    staff_role,
    notification_type,
    title,
    message,
    branch_code,
    reference
  )
  select
    p.email,
    p.role,
    'manager_inspection',
    v_title,
    v_message,
    p_branch_code,
    v_ref
  from public.profiles p
  where p.is_active
    and (
      p.role = 'superadmin'
      or (p.role = 'supervisor' and p.branch_code = p_branch_code)
    )
  on conflict (staff_email, reference) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
