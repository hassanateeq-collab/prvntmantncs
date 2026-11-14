-- Add multi-department support to Hamsun Housekeeping Log
-- Departments: housekeeping, food_beverages, etc.
-- New roles: superadmin, fnb_manager

-- ---------------------------------------------------------------------------
-- 1) Departments table
-- ---------------------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique check (code in ('housekeeping', 'food_beverages')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.departments enable row level security;

drop policy if exists departments_select_all on public.departments;
create policy departments_select_all on public.departments
  for select to authenticated using (true);

drop policy if exists departments_insert_admin on public.departments;
create policy departments_insert_admin on public.departments
  for insert to authenticated using (public.is_admin());

drop policy if exists departments_update_admin on public.departments;
create policy departments_update_admin on public.departments
  for update to authenticated using (public.is_admin());

drop policy if exists departments_delete_admin on public.departments;
create policy departments_delete_admin on public.departments
  for delete to authenticated using (public.is_admin());

-- Seed departments
insert into public.departments (name, code)
values
  ('Housekeeping', 'housekeeping'),
  ('Food & Beverages', 'food_beverages')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Add department column to profiles and update role check
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'supervisor', 'sweeper', 'room_boy', 'superadmin', 'fnb_manager'));

alter table public.profiles
  add column if not exists department text
    check (department in ('housekeeping', 'food_beverages'));

-- Update existing Kamran profile to housekeeping department
update public.profiles
set department = 'housekeeping'
where email = 'kamran@hamsun.com';

-- Create superadmin (Altamash) - if not exists
insert into public.profiles (id, email, full_name, role, department, branch_code, is_active)
select
  'a1111111-1111-1111-1111-a11111111111',
  'altamash@hamsun.com',
  'Altamash',
  'superadmin',
  null,
  null,
  true
where not exists (select 1 from public.profiles where email = 'altamash@hamsun.com')
on conflict (email) do update
set role = 'superadmin',
    department = null,
    branch_code = null,
    full_name = 'Altamash',
    is_active = true;

-- Create FnB Manager (Umama) - if not exists
insert into public.profiles (id, email, full_name, role, department, branch_code, is_active)
select
  'u1111111-1111-1111-1111-u11111111111',
  'umama@hamsun.com',
  'Umama',
  'fnb_manager',
  'food_beverages',
  null,
  true
where not exists (select 1 from public.profiles where email = 'umama@hamsun.com')
on conflict (email) do update
set role = 'fnb_manager',
    department = 'food_beverages',
    branch_code = null,
    full_name = 'Umama',
    is_active = true;

-- ---------------------------------------------------------------------------
-- 3) Update RLS policies for profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.is_admin());

-- Superadmin and fnb_manager can also read profiles in their department
drop policy if exists profiles_select_department on public.profiles;
create policy profiles_select_department on public.profiles
  for select to authenticated
  using (
    (public.is_admin())
    or (auth.uid() = id)
    or (
      exists (
        select 1 from public.profiles p2
        where p2.id = auth.uid()
          and p2.role in ('superadmin', 'fnb_manager')
          and p2.is_active
          and (
            p2.role = 'superadmin'
            or (p2.department is not null and p2.department = public.profiles.department)
          )
      )
    )
  );

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Superadmin can update any profile; fnb_manager can update fnb staff in their dept
drop policy if exists profiles_update_department on public.profiles;
create policy profiles_update_department on public.profiles
  for update to authenticated
  using (
    public.is_admin()
    or (
      exists (
        select 1 from public.profiles p2
        where p2.id = auth.uid()
          and p2.role in ('superadmin', 'fnb_manager')
          and p2.is_active
          and (
            p2.role = 'superadmin'
            or (p2.department is not null and p2.department = public.profiles.department)
          )
      )
    )
  )
  with check (
    public.is_admin()
    or (
      exists (
        select 1 from public.profiles p2
        where p2.id = auth.uid()
          and p2.role in ('superadmin', 'fnb_manager')
          and p2.is_active
          and (
            p2.role = 'superadmin'
            or (p2.department is not null and p2.department = public.profiles.department)
          )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4) Update admin RPCs to support new roles and departments
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
  if v_role not in ('admin', 'supervisor', 'sweeper', 'room_boy', 'superadmin', 'fnb_manager') then
    raise exception 'Invalid role.';
  end if;

  -- Non-admin roles need a branch
  if v_role in ('supervisor', 'sweeper', 'room_boy') and v_branch is null then
    raise exception 'A ' || v_role || ' needs a branch.';
  end if;

  -- Department-based roles need a department
  if v_role in ('fnb_manager') and v_department is null then
    raise exception 'A ' || v_role || ' needs a department.';
  end if;

  -- Admin/superadmin have no branch
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

  if v_role is not null and v_role not in ('admin', 'supervisor', 'sweeper', 'room_boy', 'superadmin', 'fnb_manager') then
    raise exception 'Invalid role.';
  end if;

  if v_branch is not null and v_branch not in ('FSL', 'CLF', 'EXT', 'DHA', 'NST') then
    raise exception 'Invalid branch code.';
  end if;

  if v_department is not null and v_department not in ('housekeeping', 'food_beverages') then
    raise exception 'Invalid department code.';
  end if;

  -- Department-based roles need a department
  if coalesce(v_role, v_current.role) in ('fnb_manager')
     and coalesce(v_department, v_current.department) is null then
    raise exception 'A ' || coalesce(v_role, v_current.role) || ' needs a department.';
  end if;

  -- Non-department roles need a branch
  if coalesce(v_role, v_current.role) in ('supervisor', 'sweeper', 'room_boy')
     and coalesce(v_branch, v_current.branch_code) is null then
    raise exception 'A ' || coalesce(v_role, v_current.role) || ' needs a branch.';
  end if;

  -- Admin/superadmin have no branch
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
