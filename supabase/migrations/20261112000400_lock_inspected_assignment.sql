-- Lock the assigned room boy permanently once the supervisor has inspected.
--
-- The UI already disables the Assign controls for inspected rooms, but the
-- rule must hold for every role (supervisor, manager, admin, superadmin) and
-- every client, so enforce it in the database as well.

create or replace function public.prevent_locked_room_boy_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.inspected_at is not null
     and new.assigned_to is distinct from old.assigned_to then
    raise exception
      'Room % on % is locked after supervisor inspection. The assigned room boy cannot be changed.',
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
