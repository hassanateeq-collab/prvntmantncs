-- Public area inspection records - stored in Supabase (not localStorage)
-- Enables real-time sync between supervisors and sweepers

create table if not exists public.public_inspection_records (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null check (branch_code in ('FSL', 'CLF', 'EXT', 'DHA', 'NST')),
  inspection_date date not null,
  area_id text not null,
  shift_key text not null check (shift_key in ('shift1', 'shift2', 'shift3')),
  staff_checked boolean not null default false,
  supervisor_checked boolean not null default false,
  supervisor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  unique(branch_code, inspection_date, area_id, shift_key)
);

alter table public.public_inspection_records enable row level security;

-- Everyone can read all inspection records
drop policy if exists public_inspection_records_select_all on public.public_inspection_records;
create policy public_inspection_records_select_all on public.public_inspection_records
  for select to authenticated
  using (true);

-- Anyone can insert their own records
drop policy if exists public_inspection_records_insert_all on public.public_inspection_records;
create policy public_inspection_records_insert_all on public.public_inspection_records
  for insert to authenticated
  with check (true);

-- Anyone can update any record (supervisors verify sweeper's checks)
drop policy if exists public_inspection_records_update_all on public.public_inspection_records;
create policy public_inspection_records_update_all on public.public_inspection_records
  for update to authenticated
  using (true);

-- Index for fast queries
create index if not exists idx_public_inspection_records_branch_date
  on public.public_inspection_records (branch_code, inspection_date);

create index if not exists idx_public_inspection_records_branch_date_area
  on public.public_inspection_records (branch_code, inspection_date, area_id);

-- Enable real-time subscriptions
alter publication supabase_realtime add table public.public_inspection_records;
