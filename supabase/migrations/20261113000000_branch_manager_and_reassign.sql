-- Branch managers, partner room-boy assignments and post-inspection reassignment.
--
-- 1. Branch managers are housekeeping staff who can inspect rooms for their own
--    branch. Their inspection counts as the supervisor sign-off.
-- 2. A room can carry several room boys (the primary plus partners).
-- 3. A supervisor may reassign an inspected room, but that clears the saved
--    inspection so the room must be inspected again.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.room_boy_entries
  add column if not exists assigned_partners text[] not null default '{}';

alter table public.room_boy_entries
  add column if not exists inspected_role text;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check check (
    role in (
      'admin',
      'supervisor',
      'sweeper',
      'room_boy',
      'superadmin',
      'fnb_manager',
      'tray_collector',
      'kitchen_incharge',
      'dispatcher',
      'branch_manager'
    )
  );

-- ---------------------------------------------------------------------------
-- Assignment lock
--
-- A plain update that changes the assigned room boys while an inspection is
-- still saved is rejected. Reassignment is allowed when the same statement
-- clears inspected_at (the UI does this through reset_room_boy_inspection).
-- ---------------------------------------------------------------------------

create or replace function public.prevent_locked_room_boy_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.inspected_at is not null
     and new.inspected_at is not null
     and (
       new.assigned_to is distinct from old.assigned_to
       or new.assigned_partners is distinct from old.assigned_partners
     ) then
    raise exception
      'Room % on % is locked after supervisor inspection. Reassign the room to clear the inspection first.',
      old.room_no,
      old.report_date
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists room_boy_lock_assignment on public.room_boy_entries;

create trigger room_boy_lock_assignment
before update on public.room_boy_entries
for each row
execute function public.prevent_locked_room_boy_assignment();

-- ---------------------------------------------------------------------------
-- Clear a saved inspection so the room can be reassigned and inspected again.
-- ---------------------------------------------------------------------------

create or replace function public.reset_room_boy_inspection(
  p_branch_code text,
  p_date date,
  p_room_no text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid()
    and is_active;

  if v_role is null
     or v_role not in (
       'superadmin', 'admin', 'supervisor', 'branch_manager'
     ) then
    raise exception 'Only housekeeping supervisors or managers can reassign a room.'
      using errcode = '42501';
  end if;

  update public.room_boy_entries
  set inspected_by = null,
      inspected_at = null,
      inspected_role = null,
      boy_status = 'pending',
      supervisor_rating = null,
      supervisor_notes = null,
      manager_inspected_by = null,
      manager_inspected_at = null,
      manager_status = null,
      manager_rating = null,
      manager_notes = null,
      updated_at = now()
  where branch_code = p_branch_code
    and report_date = p_date
    and room_no = p_room_no;
end;
$$;

grant execute on function public.reset_room_boy_inspection(text, date, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Login management: allow branch_manager in the admin RPCs.
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
set search_path to 'public', 'auth', 'extensions'
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
    'fnb_manager', 'tray_collector', 'kitchen_incharge', 'dispatcher',
    'branch_manager'
  ) then
    raise exception 'Invalid role.';
  end if;

  if v_caller_role = 'admin' then
    if v_role not in ('supervisor', 'sweeper', 'room_boy', 'branch_manager') then
      raise exception 'Housekeeping managers can only create supervisor, sweeper, room boy or branch manager logins.';
    end if;
    v_department := 'housekeeping';
  elsif v_caller_role = 'fnb_manager' then
    if v_role not in ('tray_collector', 'kitchen_incharge', 'dispatcher') then
      raise exception 'F&B managers can only create tray collector, kitchen in-charge or dispatcher logins.';
    end if;
    v_department := 'food_beverages';
  else
    -- Superadmin: derive the department from the role.
    if v_role in ('admin', 'supervisor', 'sweeper', 'room_boy', 'branch_manager') then
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
    'kitchen_incharge', 'dispatcher', 'branch_manager'
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
set search_path to 'public', 'auth', 'extensions'
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
         or v_current.role not in ('supervisor', 'sweeper', 'room_boy', 'branch_manager') then
        raise exception 'You can only manage housekeeping team logins.'
          using errcode = '42501';
      end if;
      if v_role is not null
         and v_role not in ('supervisor', 'sweeper', 'room_boy', 'branch_manager') then
        raise exception 'Housekeeping managers can only assign supervisor, sweeper, room boy or branch manager roles.';
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
      if v_role in ('admin', 'supervisor', 'sweeper', 'room_boy', 'branch_manager') then
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
    'fnb_manager', 'tray_collector', 'kitchen_incharge', 'dispatcher',
    'branch_manager'
  ) then
    raise exception 'Invalid role.';
  end if;

  v_next_role := coalesce(v_role, v_current.role);

  if v_next_role in (
    'supervisor', 'sweeper', 'room_boy', 'tray_collector',
    'kitchen_incharge', 'dispatcher', 'branch_manager'
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

grant execute on function public.admin_create_staff(text, text, text, text, text, text)
  to authenticated;
grant execute on function public.admin_update_staff(uuid, text, text, text, text, text, boolean, text)
  to authenticated;
