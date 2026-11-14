-- Food & Beverages logs.
-- Each branch keeps its own copy of every FnB log:
--   Breakfast Log (daily)
--   Guest Kitchen Monthly Utensils and Crockery Register (monthly)
--   Wastage of Food Items (daily)
--   Deep Cleaning Log (daily)
--   Fumigation Log (monthly)
--
-- Rows are stored as a JSON array so the five logs can share one table while
-- keeping their own column sets in the app.

create table if not exists public.fnb_log_entries (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null check (branch_code in ('FSL', 'CLF', 'EXT', 'DHA', 'NST')),
  log_type text not null check (
    log_type in ('breakfast', 'utensils', 'wastage', 'deep_cleaning', 'fumigation')
  ),
  period_key text not null,
  rows jsonb not null default '[]'::jsonb,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_code, log_type, period_key)
);

alter table public.fnb_log_entries enable row level security;

-- Only F&B managers and the super admin can read or write F&B logs.
drop policy if exists fnb_log_entries_select on public.fnb_log_entries;
create policy fnb_log_entries_select on public.fnb_log_entries
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('fnb_manager', 'superadmin')
        and p.is_active
    )
  );

drop policy if exists fnb_log_entries_insert on public.fnb_log_entries;
create policy fnb_log_entries_insert on public.fnb_log_entries
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('fnb_manager', 'superadmin')
        and p.is_active
    )
  );

drop policy if exists fnb_log_entries_update on public.fnb_log_entries;
create policy fnb_log_entries_update on public.fnb_log_entries
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('fnb_manager', 'superadmin')
        and p.is_active
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('fnb_manager', 'superadmin')
        and p.is_active
    )
  );

create index if not exists idx_fnb_log_entries_branch_period
  on public.fnb_log_entries (branch_code, log_type, period_key);
