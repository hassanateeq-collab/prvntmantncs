-- Add sweeper role to profiles check constraint
-- Need to drop and recreate the check constraint

alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'supervisor', 'sweeper'));

-- Update RLS policies: sweepers can only select their own profile
-- Admin can still see all
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.is_admin());

-- Sweepers cannot update profiles (only admin can)
-- policies already restrict update to admin, but make explicit:
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
