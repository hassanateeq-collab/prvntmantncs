-- Breakfast orders per room per branch per date.
-- FnB team sees rooms sorted by earliest order time, checks items, marks sent,
-- and tray collector marks trays collected.

create table if not exists public.breakfast_orders (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null check (branch_code in ('FSL', 'CLF', 'EXT', 'DHA', 'NST')),
  room_number text not null,
  order_date date not null,
  order_time text,
  items_checklist jsonb not null default '[]'::jsonb,
  items_verified boolean not null default false,
  sent_at text,
  tray_collected boolean not null default false,
  tray_collected_at text,
  created_by_name text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_code, room_number, order_date)
);

alter table public.breakfast_orders enable row level security;

-- FnB managers, superadmins and tray collectors can read breakfast orders.
drop policy if exists breakfast_orders_select on public.breakfast_orders;
create policy breakfast_orders_select on public.breakfast_orders
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('fnb_manager', 'superadmin', 'tray_collector')
        and p.is_active
        and (p.role = 'superadmin' or p.branch_code = public.breakfast_orders.branch_code or p.branch_code is null)
    )
  );

-- FnB managers and superadmins can insert/update breakfast orders.
drop policy if exists breakfast_orders_insert on public.breakfast_orders;
create policy breakfast_orders_insert on public.breakfast_orders
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('fnb_manager', 'superadmin')
        and p.is_active
        and (p.role = 'superadmin' or p.branch_code = public.breakfast_orders.branch_code or p.branch_code is null)
    )
  );

drop policy if exists breakfast_orders_update on public.breakfast_orders;
create policy breakfast_orders_update on public.breakfast_orders
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('fnb_manager', 'superadmin', 'tray_collector')
        and p.is_active
        and (p.role = 'superadmin' or p.branch_code = public.breakfast_orders.branch_code or p.branch_code is null)
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('fnb_manager', 'superadmin', 'tray_collector')
        and p.is_active
        and (p.role = 'superadmin' or p.branch_code = public.breakfast_orders.branch_code or p.branch_code is null)
    )
  );

create index if not exists idx_breakfast_orders_branch_date
  on public.breakfast_orders (branch_code, order_date);
create index if not exists idx_breakfast_orders_branch_room_date
  on public.breakfast_orders (branch_code, room_number, order_date);
