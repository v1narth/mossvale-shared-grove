create table if not exists public.mossvale_worlds (
  id text primary key,
  resources jsonb not null default '{}'::jsonb,
  buildings jsonb not null default '[]'::jsonb,
  planted_resources jsonb not null default '[]'::jsonb,
  bots jsonb not null default '[]'::jsonb,
  dropped_loot jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.mossvale_players (
  world_id text not null,
  player_id text not null,
  name text not null default 'Traveler',
  x double precision not null default 1800,
  y double precision not null default 1300,
  facing double precision not null default 0,
  updated_at timestamptz not null default now(),
  primary key (world_id, player_id)
);

alter table public.mossvale_worlds
  add column if not exists bots jsonb not null default '[]'::jsonb,
  add column if not exists dropped_loot jsonb not null default '[]'::jsonb;

alter table public.mossvale_players
  add column if not exists name text not null default 'Traveler',
  add column if not exists x double precision not null default 1800,
  add column if not exists y double precision not null default 1300,
  add column if not exists facing double precision not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table public.mossvale_worlds enable row level security;
alter table public.mossvale_players enable row level security;

grant select, insert, update on public.mossvale_worlds to anon;
grant select, insert, update on public.mossvale_players to anon;

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

drop policy if exists "Public travelers can read Mossvale players" on public.mossvale_players;
create policy "Public travelers can read Mossvale players"
on public.mossvale_players
for select
to anon
using (true);

drop policy if exists "Public travelers can create Mossvale players" on public.mossvale_players;
create policy "Public travelers can create Mossvale players"
on public.mossvale_players
for insert
to anon
with check (
  world_id ~ '^[a-zA-Z0-9_-]{1,48}$'
  and player_id ~ '^[a-zA-Z0-9_-]{1,80}$'
);

drop policy if exists "Public travelers can update Mossvale players" on public.mossvale_players;
create policy "Public travelers can update Mossvale players"
on public.mossvale_players
for update
to anon
using (
  world_id ~ '^[a-zA-Z0-9_-]{1,48}$'
  and player_id ~ '^[a-zA-Z0-9_-]{1,80}$'
)
with check (
  world_id ~ '^[a-zA-Z0-9_-]{1,48}$'
  and player_id ~ '^[a-zA-Z0-9_-]{1,80}$'
);
