-- Hamsun Housekeeping Log — application auth and access control
-- Project: didipecfmoqfapkcbxsq
--
-- The PMS data (properties, rooms, bookings) lives in the separate Hamsun PMS
-- project. This project only stores portal logins, roles and branch access.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null default 'supervisor'
    check (role in ('admin', 'supervisor')),
  branch_code text
    check (branch_code in ('FSL', 'CLF', 'EXT', 'DHA', 'NST')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Security-definer helper so profile policies never recurse into themselves.
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
      and role = 'admin'
      and is_active
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.is_admin());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Admin-only account management
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_staff(
  p_email text,
  p_password text,
  p_full_name text default null,
  p_role text default 'supervisor',
  p_branch_code text default null
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
  if v_role not in ('admin', 'supervisor') then
    raise exception 'Invalid role.';
  end if;
  if v_role = 'supervisor' and v_branch is null then
    raise exception 'A supervisor needs a branch.';
  end if;
  if v_branch is not null and v_branch not in ('FSL', 'CLF', 'EXT', 'DHA', 'NST') then
    raise exception 'Invalid branch code.';
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
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
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
    id, email, full_name, role, branch_code, is_active
  ) values (
    v_user_id,
    v_email,
    nullif(trim(p_full_name), ''),
    v_role,
    case when v_role = 'admin' then null else v_branch end,
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
     and (p_is_active = false or v_role = 'supervisor') then
    raise exception 'You cannot remove your own administrator access.';
  end if;

  if v_role is not null and v_role not in ('admin', 'supervisor') then
    raise exception 'Invalid role.';
  end if;

  if v_branch is not null and v_branch not in ('FSL', 'CLF', 'EXT', 'DHA', 'NST') then
    raise exception 'Invalid branch code.';
  end if;

  if coalesce(v_role, v_current.role) = 'supervisor'
     and coalesce(v_branch, v_current.branch_code) is null then
    raise exception 'A supervisor needs a branch.';
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
        when coalesce(v_role, role) = 'admin' then null
        else coalesce(v_branch, branch_code)
      end,
      is_active = coalesce(p_is_active, is_active)
  where id = p_id
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke all on function public.admin_create_staff(text, text, text, text, text) from public, anon;
revoke all on function public.admin_update_staff(uuid, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.admin_create_staff(text, text, text, text, text) to authenticated;
grant execute on function public.admin_update_staff(uuid, text, text, text, text, boolean, text) to authenticated;
