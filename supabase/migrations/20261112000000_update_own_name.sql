-- Let any signed-in staff member set their own display name (used for
-- signatures) without granting them write access to role/branch/department.
create or replace function public.update_own_name(p_full_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if p_full_name is null or length(trim(p_full_name)) < 2 then
    raise exception 'Please enter your full name.';
  end if;

  update public.profiles
     set full_name = trim(p_full_name),
         updated_at = now()
   where id = auth.uid()
   returning * into v_profile;

  if v_profile.id is null then
    raise exception 'Profile not found.';
  end if;

  return v_profile;
end;
$$;

grant execute on function public.update_own_name(text) to authenticated;
