-- Branch managers run the same floor workflow as supervisors, so they need to
-- read the room boys in their own branch, raise assignment notifications and
-- receive checkout / cleaning alerts for their branch.

drop policy if exists profiles_select_room_boys on public.profiles;

create policy profiles_select_room_boys on public.profiles
for select using (
  role = 'room_boy'
  and (
    public.current_role() in ('superadmin', 'admin')
    or (
      public.current_role() in ('supervisor', 'branch_manager')
      and branch_code = public.current_branch()
    )
  )
);

drop policy if exists room_boy_notifications_insert on public.room_boy_notifications;

create policy room_boy_notifications_insert on public.room_boy_notifications
for insert with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('supervisor', 'branch_manager', 'admin', 'superadmin')
      and p.is_active
  )
);

create or replace function public.notify_room_checkout(
  p_branch_code text,
  p_room_number text,
  p_booking_id text default null,
  p_guest_name text default null,
  p_reference text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_branch text;
  v_reference text;
  v_inserted integer;
begin
  select p.role, p.branch_code into v_role, v_branch
  from public.profiles p
  where p.id = auth.uid() and p.is_active;

  if v_role is null then
    raise exception 'Not authorised to report checkouts.';
  end if;

  if v_role not in ('superadmin', 'admin')
     and coalesce(v_branch, '') <> coalesce(p_branch_code, '') then
    raise exception 'Not authorised for this branch.';
  end if;

  v_reference := coalesce(
    nullif(p_reference, ''),
    'checkout:' || coalesce(p_branch_code, '') || ':' ||
      coalesce(p_booking_id, p_room_number, '') || ':' ||
      to_char(now(), 'YYYY-MM-DD')
  );

  insert into public.staff_notifications (
    staff_email, staff_role, notification_type, title, message,
    branch_code, reference
  )
  select
    p.email,
    p.role,
    'room_checkout',
    'Room ' || coalesce(p_room_number, '?') || ' checked out',
    'Room ' || coalesce(p_room_number, '?') ||
      case when coalesce(p_guest_name, '') <> '' then ' (' || p_guest_name || ')' else '' end ||
      ' has checked out. Please start the room turnover.',
    p_branch_code,
    v_reference
  from public.profiles p
  where p.is_active
    and p.role in ('supervisor', 'branch_manager', 'room_boy', 'sweeper', 'admin', 'superadmin')
    and (p.role in ('admin', 'superadmin') or p.branch_code = p_branch_code)
  on conflict (staff_email, reference) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.notify_room_cleaning(
  p_branch_code text,
  p_room_number text,
  p_room_boy_name text default null,
  p_phase text default 'start',
  p_time_in text default null,
  p_time_out text default null,
  p_reference text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_branch text;
  v_reference text;
  v_inserted integer;
  v_phase text := lower(coalesce(nullif(trim(p_phase), ''), 'start'));
  v_title text;
  v_message text;
begin
  select p.role, p.branch_code into v_role, v_branch
  from public.profiles p
  where p.id = auth.uid() and p.is_active;

  if v_role is null then
    raise exception 'Not authorised to report cleaning updates.';
  end if;

  if v_phase not in ('start', 'finish') then
    raise exception 'Invalid cleaning phase.';
  end if;

  if v_role not in ('superadmin', 'admin')
     and coalesce(v_branch, '') <> coalesce(p_branch_code, '') then
    raise exception 'Not authorised for this branch.';
  end if;

  v_reference := coalesce(
    nullif(p_reference, ''),
    'cleaning:' || coalesce(p_branch_code, '') || ':' ||
      coalesce(p_room_number, '') || ':' || v_phase || ':' ||
      to_char(now(), 'YYYY-MM-DD')
  );

  if v_phase = 'start' then
    v_title := 'Room ' || coalesce(p_room_number, '?') || ' cleaning started';
    v_message := coalesce(p_room_boy_name, 'Room boy') ||
      ' started cleaning room ' || coalesce(p_room_number, '?') ||
      case when coalesce(p_time_in, '') <> '' then ' at ' || p_time_in else '' end ||
      ' - ' || coalesce(p_branch_code, '') || ' branch';
  else
    v_title := 'Room ' || coalesce(p_room_number, '?') || ' cleaning finished';
    v_message := coalesce(p_room_boy_name, 'Room boy') ||
      ' finished room ' || coalesce(p_room_number, '?') ||
      case
        when coalesce(p_time_in, '') <> '' or coalesce(p_time_out, '') <> ''
          then ' (in ' || coalesce(p_time_in, '-') || ', out ' || coalesce(p_time_out, '-') || ')'
        else ''
      end ||
      '. Supervisor inspection required - ' ||
      coalesce(p_branch_code, '') || ' branch';
  end if;

  insert into public.staff_notifications (
    staff_email, staff_role, notification_type, title, message,
    branch_code, reference
  )
  select
    p.email,
    p.role,
    'room_cleaning',
    v_title,
    v_message,
    p_branch_code,
    v_reference
  from public.profiles p
  where p.is_active
    and (
      p.role in ('superadmin', 'admin')
      or (p.role in ('supervisor', 'branch_manager') and p.branch_code = p_branch_code)
    )
  on conflict (staff_email, reference) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- Allow any signed-in, active staff member to record PMS status events so the PMS sync log works for supervisors and branch managers too.
drop policy if exists pms_status_events_insert_admin on public.pms_status_events;

create policy pms_status_events_insert_authenticated on public.pms_status_events
for insert with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
  )
);
