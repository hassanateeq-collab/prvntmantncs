-- Allow superadmins (not just branch admins) to record PMS status events.
-- Without this the portal logs a 403 for every status change when a
-- superadmin is signed in, which looks like a PMS sync failure.

drop policy if exists pms_status_events_insert_admin on public.pms_status_events;

create policy pms_status_events_insert_admin on public.pms_status_events
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.is_active
    )
  );
