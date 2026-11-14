-- Department-scoped manager access + room cleaning lifecycle alerts
--
-- Kamran (housekeeping admin) and Umama (F&B manager) can create and manage
-- logins for their own departments only. Superadmins keep full control.
--
-- Room boys now move through:
--   pending -> progress -> awaiting_inspection -> completed
-- where "completed" can only be set by a supervisor inspection.

-- ---------------------------------------------------------------------------
-- 1) Every profile belongs to a department so managers can be scoped safely.
-- ---------------------------------------------------------------------------
update public.profiles
set department = case
  when role in ('admin', 'supervisor', 'sweeper', 'room_boy') then 'housekeeping'
  when role in ('fnb_manager', 'tray_collector', 'kitchen_incharge', 'dispatcher')
    then 'food_beverages'
  else department
end
where department is null
  and role in (
    'admin', 'supervisor', 'sweeper', 'room_boy',
    'fnb_manager', 'tray_collector', 'kitchen_incharge', 'dispatcher'
  );

-- ---------------------------------------------------------------------------
-- 2) Security-definer helpers (avoid recursive profile RLS).
-- ---------------------------------------------------------------------------
create or replace function public.is_superadmin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'superadmin'
      and is_active
  )
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('superadmin', 'admin')
      and is_active
  )
$$;

create or replace function public.can_manage_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('superadmin', 'admin', 'fnb_manager')
      and is_active
  )
$$;

create or replace function public.current_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and is_active
$$;

create or replace function public.current_branch()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select branch_code
  from public.profiles
  where id = auth.uid()
    and is_active
$$;

revoke all on function public.is_superadmin() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.can_manage_staff() from public, anon;
revoke all on function public.current_role() from public, anon;
revoke all on function public.current_branch() from public, anon;
grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_manage_staff() to authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.current_branch() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Profile RLS: managers only see and update their own department.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_select_department on public.profiles;
drop policy if exists profiles_select_managers on public.profiles;
create policy profiles_select_managers on public.profiles
  for select to authenticated
  using (
    public.is_superadmin()
    or (public.current_role() = 'admin' and department = 'housekeeping')
    or (public.current_role() = 'fnb_manager' and department = 'food_beverages')
  );

-- Room boys are visible to housekeeping management and to the supervisor of
-- their own branch. F&B managers must not see housekeeping room boys.
drop policy if exists profiles_select_room_boys on public.profiles;
create policy profiles_select_room_boys on public.profiles
  for select to authenticated
  using (
    role = 'room_boy'
    and (
      public.current_role() in ('superadmin', 'admin')
      or (
        public.current_role() = 'supervisor'
        and branch_code = public.current_branch()
      )
    )
  );

drop policy if exists profiles_update_admin on public.profiles;
drop policy if exists profiles_update_department on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- ---------------------------------------------------------------------------
-- 4) Staff creation / update RPCs with department scoping.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_staff(
  p_email text,
  p_password text,
  p_full_name text default null,
  p_role text default 'supervisor',
  p_branch_code text default null,
  p_department text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid := gen_random_uuid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_role text := lower(trim(coalesce(nullif(p_role, ''), 'supervisor')));
  v_branch text := nullif(upper(trim(coalesce(p_branch_code, ''))), '');
  v_department text := nullif(trim(coalesce(p_department, '')), '');
  v_caller_role text;
  v_profile public.profiles;
begin
  select role into v_caller_role
  from public.profiles
  where id = auth.uid()
    and is_active;

  if v_caller_role is null
     or v_caller_role not in ('superadmin', 'admin', 'fnb_manager') then
    raise exception 'Only an administrator or department manager can create logins.'
      using errcode = '42501';
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Enter a valid email address.';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;
  if v_role not in (
    'admin', 'supervisor', 'sweeper', 'room_boy', 'superadmin',
    'fnb_manager', 'tray_collector', 'kitchen_incharge', 'dispatcher'
  ) then
    raise exception 'Invalid role.';
  end if;

  if v_caller_role = 'admin' then
    if v_role not in ('supervisor', 'sweeper', 'room_boy') then
      raise exception 'Housekeeping managers can only create supervisor, sweeper or room boy logins.';
    end if;
    v_department := 'housekeeping';
  elsif v_caller_role = 'fnb_manager' then
    if v_role not in ('tray_collector', 'kitchen_incharge', 'dispatcher') then
      raise exception 'F&B managers can only create tray collector, kitchen in-charge or dispatcher logins.';
    end if;
    v_department := 'food_beverages';
  else
    -- Superadmin: derive the department from the role.
    if v_role in ('admin', 'supervisor', 'sweeper', 'room_boy') then
      v_department := coalesce(v_department, 'housekeeping');
      if v_department <> 'housekeeping' then
        raise exception 'Housekeeping roles belong to the housekeeping department.';
      end if;
    elsif v_role in ('fnb_manager', 'tray_collector', 'kitchen_incharge', 'dispatcher') then
      v_department := coalesce(v_department, 'food_beverages');
      if v_department <> 'food_beverages' then
        raise exception 'F&B roles belong to the food_beverages department.';
      end if;
    else
      v_department := null;
    end if;
  end if;

  -- Branch-scoped roles need a branch.
  if v_role in (
    'supervisor', 'sweeper', 'room_boy', 'tray_collector',
    'kitchen_incharge', 'dispatcher'
  ) and v_branch is null then
    raise exception 'A % needs a branch.', v_role;
  end if;

  -- Company-wide roles have no branch.
  if v_role in ('admin', 'superadmin', 'fnb_manager') then
    v_branch := null;
  end if;

  if v_branch is not null and v_branch not in ('FSL', 'CLF', 'EXT', 'DHA', 'NST') then
    raise exception 'Invalid branch code.';
  end if;
  if v_department is not null and v_department not in ('housekeeping', 'food_beverages') then
    raise exception 'Invalid department code.';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'A login with this email already exists.';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token,
    is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    now(),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', v_role),
    jsonb_build_object('full_name', coalesce(trim(p_full_name), '')),
    '', '',
    '', '', '',
    '', '', '',
    false,
    false
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    v_user_id::text,
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
    'email',
    now(), now(), now()
  );

  insert into public.profiles (
    id, email, full_name, role, branch_code, department, is_active
  ) values (
    v_user_id,
    v_email,
    nullif(trim(p_full_name), ''),
    v_role,
    v_branch,
    v_department,
    true
  )
  returning * into v_profile;

  return v_profile;
end;
$$;

create or replace function public.admin_update_staff(
  p_id uuid,
  p_email text default null,
  p_full_name text default null,
  p_role text default null,
  p_branch_code text default null,
  p_department text default null,
  p_is_active boolean default null,
  p_password text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_role text := nullif(lower(trim(coalesce(p_role, ''))), '');
  v_branch text := nullif(upper(trim(coalesce(p_branch_code, ''))), '');
  v_department text := nullif(trim(coalesce(p_department, '')), '');
  v_caller_role text;
  v_profile public.profiles;
  v_current public.profiles;
  v_next_role text;
begin
  select role into v_caller_role
  from public.profiles
  where id = auth.uid()
    and is_active;

  if v_caller_role is null
     or v_caller_role not in ('superadmin', 'admin', 'fnb_manager') then
    raise exception 'Only an administrator or department manager can change logins.'
      using errcode = '42501';
  end if;

  select * into v_current from public.profiles where id = p_id;
  if v_current.id is null then
    raise exception 'Login not found.';
  end if;

  if p_id = auth.uid() and p_is_active = false then
    raise exception 'You cannot disable your own login.';
  end if;

  if v_caller_role = 'admin' then
    if p_id <> auth.uid() then
      if v_current.department <> 'housekeeping'
         or v_current.role not in ('supervisor', 'sweeper', 'room_boy') then
        raise exception 'You can only manage housekeeping team logins.'
          using errcode = '42501';
      end if;
      if v_role is not null
         and v_role not in ('supervisor', 'sweeper', 'room_boy') then
        raise exception 'Housekeeping managers can only assign supervisor, sweeper or room boy roles.';
      end if;
    elsif v_role is not null and v_role <> v_current.role then
      raise exception 'You cannot change your own role or access.';
    end if;
    v_department := 'housekeeping';
  elsif v_caller_role = 'fnb_manager' then
    if p_id <> auth.uid() then
      if v_current.department <> 'food_beverages'
         or v_current.role not in ('tray_collector', 'kitchen_incharge', 'dispatcher') then
        raise exception 'You can only manage F&B team logins.'
          using errcode = '42501';
      end if;
      if v_role is not null
         and v_role not in ('tray_collector', 'kitchen_incharge', 'dispatcher') then
        raise exception 'F&B managers can only assign tray collector, kitchen in-charge or dispatcher roles.';
      end if;
    elsif v_role is not null and v_role <> v_current.role then
      raise exception 'You cannot change your own role or access.';
    end if;
    v_department := 'food_beverages';
  else
    -- Superadmin: keep role and department consistent.
    if v_role is not null then
      if v_role in ('admin', 'supervisor', 'sweeper', 'room_boy') then
        v_department := 'housekeeping';
      elsif v_role in ('fnb_manager', 'tray_collector', 'kitchen_incharge', 'dispatcher') then
        v_department := 'food_beverages';
      else
        v_department := null;
      end if;
    end if;

    if p_id = auth.uid()
       and v_role is not null
       and v_role <> v_current.role
       and v_current.role = 'superadmin' then
      raise exception 'You cannot remove your own superadmin access.';
    end if;
  end if;

  if v_role is not null and v_role not in (
    'admin', 'supervisor', 'sweeper', 'room_boy', 'superadmin',
    'fnb_manager', 'tray_collector', 'kitchen_incharge', 'dispatcher'
  ) then
    raise exception 'Invalid role.';
  end if;

  v_next_role := coalesce(v_role, v_current.role);

  if v_next_role in (
    'supervisor', 'sweeper', 'room_boy', 'tray_collector',
    'kitchen_incharge', 'dispatcher'
  ) and coalesce(v_branch, v_current.branch_code) is null then
    raise exception 'A % needs a branch.', v_next_role;
  end if;

  if v_next_role in ('admin', 'superadmin', 'fnb_manager') then
    v_branch := null;
  end if;

  if v_branch is not null and v_branch not in ('FSL', 'CLF', 'EXT', 'DHA', 'NST') then
    raise exception 'Invalid branch code.';
  end if;
  if v_department is not null and v_department not in ('housekeeping', 'food_beverages') then
    raise exception 'Invalid department code.';
  end if;

  if v_email is not null and v_email <> v_current.email then
    if position('@' in v_email) = 0 then
      raise exception 'Enter a valid email address.';
    end if;
    if exists (
      select 1 from auth.users
      where lower(email) = v_email and id <> p_id
    ) then
      raise exception 'A login with this email already exists.';
    end if;

    update auth.users
    set email = v_email,
        email_confirmed_at = now(),
        updated_at = now()
    where id = p_id;

    update auth.identities
    set identity_data = jsonb_build_object(
          'sub', p_id::text,
          'email', v_email,
          'email_verified', true
        ),
        email = v_email,
        updated_at = now()
    where user_id = p_id and provider = 'email';
  end if;

  if p_password is not null and length(p_password) > 0 then
    if length(p_password) < 6 then
      raise exception 'Password must be at least 6 characters.';
    end if;
    update auth.users
    set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
        updated_at = now()
    where id = p_id;
  end if;

  update public.profiles
  set email = coalesce(v_email, email),
      full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
      role = coalesce(v_role, role),
      branch_code = case
        when v_next_role in ('admin', 'superadmin', 'fnb_manager') then null
        else coalesce(v_branch, branch_code)
      end,
      department = coalesce(v_department, department),
      is_active = coalesce(p_is_active, is_active)
  where id = p_id
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke all on function public.admin_create_staff(text, text, text, text, text, text) from public, anon;
revoke all on function public.admin_update_staff(uuid, text, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.admin_create_staff(text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_update_staff(uuid, text, text, text, text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Room cleaning notifications for housekeeping managers and supervisors.
-- ---------------------------------------------------------------------------
alter table public.staff_notifications
  drop constraint if exists staff_notifications_notification_type_check;

alter table public.staff_notifications
  add constraint staff_notifications_notification_type_check check (
    notification_type in (
      'room_assigned',
      'rating_received',
      'test_notification',
      'room_checkout',
      'room_cleaning'
    )
  );

create or replace function public.notify_room_cleaning(
  p_branch_code text,
  p_room_number text,
  p_room_boy_name text default null,
  p_phase text default 'start',
  p_time_in text default null,
  p_time_out text default null,
  p_reference text default null
)
returns integer
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
  select p.role, p.branch_code
    into v_role, v_branch
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active;

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
      case
        when coalesce(p_time_in, '') <> '' then ' at ' || p_time_in
        else ''
      end ||
      ' - ' || coalesce(p_branch_code, '') || ' branch';
  else
    v_title := 'Room ' || coalesce(p_room_number, '?') || ' cleaning finished';
    v_message := coalesce(p_room_boy_name, 'Room boy') ||
      ' finished room ' || coalesce(p_room_number, '?') ||
      case
        when coalesce(p_time_in, '') <> '' or coalesce(p_time_out, '') <> ''
          then ' (in ' || coalesce(p_time_in, '-') ||
               ', out ' || coalesce(p_time_out, '-') || ')'
        else ''
      end ||
      '. Supervisor inspection required - ' ||
      coalesce(p_branch_code, '') || ' branch';
  end if;

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
    'room_cleaning',
    v_title,
    v_message,
    p_branch_code,
    v_reference
  from public.profiles p
  where p.is_active
    and (
      p.role in ('superadmin', 'admin')
      or (p.role = 'supervisor' and p.branch_code = p_branch_code)
    )
  on conflict (staff_email, reference) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.notify_room_cleaning(text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.notify_room_cleaning(text, text, text, text, text, text, text)
  to authenticated;
