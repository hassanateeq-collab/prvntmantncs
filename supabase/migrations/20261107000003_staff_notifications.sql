-- Staff notifications: device notifications for all staff roles (room boys, supervisors, sweepers, F&B managers, admins, superadmin).
-- Super admin can send test notifications to everyone.

create table if not exists public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  staff_email text not null,
  staff_role text not null,
  notification_type text not null check (
    notification_type in ('room_assigned', 'rating_received', 'test_notification')
  ),
  title text not null,
  message text not null,
  branch_code text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.staff_notifications enable row level security;

-- Each staff member can read their own notifications by email.
drop policy if exists staff_notifications_select on public.staff_notifications;
create policy staff_notifications_select on public.staff_notifications
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_active
        and p.email = public.staff_notifications.staff_email
    )
  );

-- Superadmin and admins can create notifications.
drop policy if exists staff_notifications_insert on public.staff_notifications;
create policy staff_notifications_insert on public.staff_notifications
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('superadmin', 'admin')
        and p.is_active
    )
  );

-- Each staff member can mark their own notifications as read.
drop policy if exists staff_notifications_update on public.staff_notifications;
create policy staff_notifications_update on public.staff_notifications
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_active
        and p.email = public.staff_notifications.staff_email
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_active
        and p.email = public.staff_notifications.staff_email
    )
  );

create index if not exists idx_staff_notifications_email_read
  on public.staff_notifications (staff_email, read_at);
create index if not exists idx_staff_notifications_unread
  on public.staff_notifications (staff_email, read_at) where read_at is null;
