-- STARCUT closed beta schema.
-- The authority server talks to these tables with the SERVICE ROLE key (which
-- bypasses RLS). Row-level security is enabled on every table so the public
-- anon key (shipped to browsers for sign-in only) can read nothing it
-- shouldn't: a signed-in player may read their own profile; the faction war
-- standing is public; feedback, reports and telemetry are server-only.

create table if not exists public.profiles (
  id text primary key,
  device_token text not null unique,
  user_id uuid unique references auth.users (id) on delete set null,
  name text not null default 'PILOT',
  faction text,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "players read their own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.faction_war (
  faction text primary key,
  points numeric not null default 0
);
alter table public.faction_war enable row level security;
create policy "faction standing is public"
  on public.faction_war for select
  to anon, authenticated
  using (true);
insert into public.faction_war (faction, points) values ('f-rusher', 0), ('f-ghost', 0), ('f-reflex', 0)
  on conflict (faction) do nothing;

create or replace function public.add_war_points(p_faction text, p_points numeric)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.faction_war (faction, points) values (p_faction, p_points)
  on conflict (faction) do update set points = public.faction_war.points + excluded.points;
$$;
revoke all on function public.add_war_points(text, numeric) from public, anon, authenticated;

create table if not exists public.feedback (
  id text primary key,
  created_at timestamptz not null default now(),
  status text not null default 'new',
  data jsonb not null
);
alter table public.feedback enable row level security;
-- no policies: service role only

create table if not exists public.reports (
  id text primary key,
  created_at timestamptz not null default now(),
  replay_id text not null,
  status text not null default 'new',
  data jsonb not null
);
alter table public.reports enable row level security;
-- no policies: service role only

create table if not exists public.telemetry (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  replay_id text,
  mode text,
  map text,
  data jsonb not null
);
alter table public.telemetry enable row level security;
-- no policies: service role only
create index if not exists telemetry_created_idx on public.telemetry (created_at desc);
