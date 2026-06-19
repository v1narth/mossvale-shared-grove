create table if not exists public.mossvale_worlds (
  id text primary key,
  resources jsonb not null default '{}'::jsonb,
  buildings jsonb not null default '[]'::jsonb,
  planted_resources jsonb not null default '[]'::jsonb,
  bots jsonb not null default '[]'::jsonb,
  dropped_loot jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.mossvale_worlds
  add column if not exists bots jsonb not null default '[]'::jsonb,
  add column if not exists dropped_loot jsonb not null default '[]'::jsonb;

alter table public.mossvale_worlds enable row level security;

grant select, insert, update on public.mossvale_worlds to anon;

drop policy if exists "Public travelers can read Mossvale worlds" on public.mossvale_worlds;
create policy "Public travelers can read Mossvale worlds"
on public.mossvale_worlds
for select
to anon
using (true);

drop policy if exists "Public travelers can create Mossvale worlds" on public.mossvale_worlds;
create policy "Public travelers can create Mossvale worlds"
on public.mossvale_worlds
for insert
to anon
with check (id ~ '^[a-zA-Z0-9_-]{1,48}$');

drop policy if exists "Public travelers can update Mossvale worlds" on public.mossvale_worlds;
create policy "Public travelers can update Mossvale worlds"
on public.mossvale_worlds
for update
to anon
using (id ~ '^[a-zA-Z0-9_-]{1,48}$')
with check (id ~ '^[a-zA-Z0-9_-]{1,48}$');
