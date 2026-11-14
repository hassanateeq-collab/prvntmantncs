-- Room boy notifications: device notifications when supervisor assigns rooms or rates cleaning.
-- Works for all branches.

create table if not exists public.room_boy_notifications (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null check (branch_code in ('FSL', 'CLF', 'EXT', 'DHA', 'NST')),
  room_number text not null,
  room_boy_name text not null,
  notification_type text not null check (
    notification_type in ('room_assigned', 'rating_received')
  ),
  supervisor_name text,
  rating integer check (rating >= 1 and rating <= 5),
  rating_notes text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.room_boy_notifications enable row level security;

-- Room boys can read their own notifications.
drop policy if exists room_boy_notifications_select on public.room_boy_notifications;
create policy room_boy_notifications_select on public.room_boy_notifications
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'room_boy'
        and p.is_active
        and p.full_name = public.room_boy_notifications.room_boy_name
    )
  );

-- Supervisors, admins and superadmins can create notifications.
drop policy if exists room_boy_notifications_insert on public.room_boy_notifications;
create policy room_boy_notifications_insert on public.room_boy_notifications
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('supervisor', 'admin', 'superadmin')
        and p.is_active
    )
  );

-- Room boys can mark their own notifications as read.
drop policy if exists room_boy_notifications_update on public.room_boy_notifications;
create policy room_boy_notifications_update on public.room_boy_notifications
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'room_boy'
        and p.is_active
        and p.full_name = public.room_boy_notifications.room_boy_name
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'room_boy'
        and p.is_active
        and p.full_name = public.room_boy_notifications.room_boy_name
    )
  );

create index if not exists idx_room_boy_notifications_branch_room_boy
  on public.room_boy_notifications (branch_code, room_boy_name, read_at);
create index if not exists idx_room_boy_notifications_unread
  on public.room_boy_notifications (room_boy_name, read_at) where read_at is null;
