-- Public areas configuration per branch
-- Admin can add/edit/delete areas; sweepers and supervisors use them

create table if not exists public.public_areas (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null check (branch_code in ('FSL', 'CLF', 'EXT', 'DHA', 'NST')),
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.public_areas enable row level security;

-- Everyone can read active areas
drop policy if exists public_areas_select_all on public.public_areas;
create policy public_areas_select_all on public.public_areas
  for select to authenticated
  using (is_active);

-- Only admin can manage areas
drop policy if exists public_areas_insert_admin on public.public_areas;
create policy public_areas_insert_admin on public.public_areas
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists public_areas_update_admin on public.public_areas;
create policy public_areas_update_admin on public.public_areas
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists public_areas_delete_admin on public.public_areas;
create policy public_areas_delete_admin on public.public_areas
  for delete to authenticated
  using (public.is_admin());

create index if not exists idx_public_areas_branch on public.public_areas (branch_code, sort_order);

-- Seed default areas for all branches (matching the Excel file)
insert into public.public_areas (branch_code, name, sort_order) values
  ('FSL', 'Lobby & front office cleaned', 1),
  ('FSL', 'Entrance area cleaned', 2),
  ('FSL', '1st Floor corridor cleaned', 3),
  ('FSL', 'G floor corridor cleaned', 4),
  ('FSL', 'Corti cafe & back area cleaned', 5),
  ('FSL', 'Mane office cleaned', 6),
  ('FSL', 'Entrance mane door cleaned', 7),
  ('FSL', 'Property outside area cleaned', 8),
  ('FSL', 'Back alley cleaned', 9),
  ('FSL', 'Lobby & staircase glass frame cleaned', 10),
  ('CLF', 'Lobby & front office cleaned', 1),
  ('CLF', 'Entrance area cleaned', 2),
  ('CLF', '1st Floor corridor cleaned', 3),
  ('CLF', 'G floor corridor cleaned', 4),
  ('CLF', 'Corti cafe & back area cleaned', 5),
  ('CLF', 'Mane office cleaned', 6),
  ('CLF', 'Entrance mane door cleaned', 7),
  ('CLF', 'Property outside area cleaned', 8),
  ('CLF', 'Back alley cleaned', 9),
  ('CLF', 'Lobby & staircase glass frame cleaned', 10),
  ('EXT', 'Lobby & front office cleaned', 1),
  ('EXT', 'Entrance area cleaned', 2),
  ('EXT', '1st Floor corridor cleaned', 3),
  ('EXT', 'G floor corridor cleaned', 4),
  ('EXT', 'Corti cafe & back area cleaned', 5),
  ('EXT', 'Mane office cleaned', 6),
  ('EXT', 'Entrance mane door cleaned', 7),
  ('EXT', 'Property outside area cleaned', 8),
  ('EXT', 'Back alley cleaned', 9),
  ('EXT', 'Lobby & staircase glass frame cleaned', 10),
  ('DHA', 'Lobby & front office cleaned', 1),
  ('DHA', 'Entrance area cleaned', 2),
  ('DHA', '1st Floor corridor cleaned', 3),
  ('DHA', 'G floor corridor cleaned', 4),
  ('DHA', 'Corti cafe & back area cleaned', 5),
  ('DHA', 'Mane office cleaned', 6),
  ('DHA', 'Entrance mane door cleaned', 7),
  ('DHA', 'Property outside area cleaned', 8),
  ('DHA', 'Back alley cleaned', 9),
  ('DHA', 'Lobby & staircase glass frame cleaned', 10),
  ('NST', 'Lobby & front office cleaned', 1),
  ('NST', 'Entrance area cleaned', 2),
  ('NST', '1st Floor corridor cleaned', 3),
  ('NST', 'G floor corridor cleaned', 4),
  ('NST', 'Corti cafe & back area cleaned', 5),
  ('NST', 'Mane office cleaned', 6),
  ('NST', 'Entrance mane door cleaned', 7),
  ('NST', 'Property outside area cleaned', 8),
  ('NST', 'Back alley cleaned', 9),
  ('NST', 'Lobby & staircase glass frame cleaned', 10)
on conflict do nothing;
