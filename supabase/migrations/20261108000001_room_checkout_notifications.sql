-- Room checkout notifications.
--
-- PMS checkouts are detected in the browser while the portal is open. Any
-- authenticated staff member in the branch may report one, and the RPC fans the
-- alert out to the housekeeping team. The reference column makes the alert
-- idempotent so several open devices cannot ring the same checkout repeatedly.

alter table public.staff_notifications
  drop constraint if exists staff_notifications_notification_type_check;

alter table public.staff_notifications
  add constraint staff_notifications_notification_type_check check (
    notification_type in (
      'room_assigned',
      'rating_received',
      'test_notification',
      'room_checkout'
    )
  );

alter table public.staff_notifications
  add column if not exists reference text;

create unique index if not exists staff_notifications_staff_reference_key
  on public.staff_notifications (staff_email, reference);

create or replace function public.notify_room_checkout(
  p_branch_code text,
  p_room_number text,
  p_booking_id text default null,
  p_guest_name text default null,
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
begin
  select p.role, p.branch_code
    into v_role, v_branch
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active;

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
    'room_checkout',
    'Room ' || coalesce(p_room_number, '?') || ' checked out',
    'Room ' || coalesce(p_room_number, '?') ||
      case
        when coalesce(p_guest_name, '') <> '' then ' (' || p_guest_name || ')'
        else ''
      end ||
      ' has checked out. Please start the room turnover.',
    p_branch_code,
    v_reference
  from public.profiles p
  where p.is_active
    and p.role in (
      'supervisor',
      'room_boy',
      'sweeper',
      'admin',
      'superadmin'
    )
    and (
      p.role in ('admin', 'superadmin')
      or p.branch_code = p_branch_code
    )
  on conflict (staff_email, reference) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

grant execute on function public.notify_room_checkout(text, text, text, text, text)
  to authenticated;
