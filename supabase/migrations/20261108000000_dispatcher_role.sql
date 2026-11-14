-- Breakfast dispatcher role
-- Dispatchers are branch-scoped F&B staff who receive a device alert and bell
-- sound when a new PMS breakfast order arrives for their branch.

-- 1) Allow the dispatcher role on profiles.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'admin',
    'supervisor',
    'sweeper',
    'room_boy',
    'superadmin',
    'fnb_manager',
    'tray_collector',
    'kitchen_incharge',
    'dispatcher'
  ));

-- 2) Keep the admin RPCs in sync with every supported role.
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
  v_profile public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can create logins.' using errcode = '42501';
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

  -- Branch-scoped roles need a branch.
  if v_role in (
    'supervisor', 'sweeper', 'room_boy', 'tray_collector',
    'kitchen_incharge', 'dispatcher'
  ) and v_branch is null then
    raise exception 'A % needs a branch.', v_role;
  end if;

  -- Department-based roles need a department.
  if v_role = 'fnb_manager' and v_department is null then
    raise exception 'A fnb_manager needs a department.';
  end if;

  if v_role in ('admin', 'superadmin') then
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
  v_profile public.profiles;
  v_current public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can change logins.' using errcode = '42501';
  end if;

  select * into v_current from public.profiles where id = p_id;
  if v_current.id is null then
    raise exception 'Login not found.';
  end if;

  if p_id = auth.uid()
     and (p_is_active = false or v_role = 'superadmin') then
    raise exception 'You cannot remove your own superadmin access.';
  end if;

  if v_role is not null and v_role not in (
    'admin', 'supervisor', 'sweeper', 'room_boy', 'superadmin',
    'fnb_manager', 'tray_collector', 'kitchen_incharge', 'dispatcher'
  ) then
    raise exception 'Invalid role.';
  end if;

  if v_branch is not null and v_branch not in ('FSL', 'CLF', 'EXT', 'DHA', 'NST') then
    raise exception 'Invalid branch code.';
  end if;

  if v_department is not null and v_department not in ('housekeeping', 'food_beverages') then
    raise exception 'Invalid department code.';
  end if;

  if coalesce(v_role, v_current.role) = 'fnb_manager'
     and coalesce(v_department, v_current.department) is null then
    raise exception 'A fnb_manager needs a department.';
  end if;

  if coalesce(v_role, v_current.role) in (
    'supervisor', 'sweeper', 'room_boy', 'tray_collector',
    'kitchen_incharge', 'dispatcher'
  ) and coalesce(v_branch, v_current.branch_code) is null then
    raise exception 'A % needs a branch.', coalesce(v_role, v_current.role);
  end if;

  if coalesce(v_role, v_current.role) in ('admin', 'superadmin') then
    v_branch := null;
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
      branch_code = coalesce(v_branch, branch_code),
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

-- 3) Breakfast orders: dispatchers can read and update their branch.
drop policy if exists breakfast_orders_select on public.breakfast_orders;
create policy breakfast_orders_select on public.breakfast_orders
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('fnb_manager', 'superadmin', 'tray_collector', 'dispatcher')
        and p.is_active
        and (p.role in ('superadmin', 'fnb_manager') or p.branch_code = public.breakfast_orders.branch_code)
    )
  );

drop policy if exists breakfast_orders_insert on public.breakfast_orders;
create policy breakfast_orders_insert on public.breakfast_orders
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('fnb_manager', 'superadmin', 'dispatcher')
        and p.is_active
        and (p.role in ('superadmin', 'fnb_manager') or p.branch_code = public.breakfast_orders.branch_code)
    )
  );

drop policy if exists breakfast_orders_update on public.breakfast_orders;
create policy breakfast_orders_update on public.breakfast_orders
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('fnb_manager', 'superadmin', 'tray_collector', 'dispatcher')
        and p.is_active
        and (p.role in ('superadmin', 'fnb_manager') or p.branch_code = public.breakfast_orders.branch_code)
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('fnb_manager', 'superadmin', 'tray_collector', 'dispatcher')
        and p.is_active
        and (p.role in ('superadmin', 'fnb_manager') or p.branch_code = public.breakfast_orders.branch_code)
    )
  );
