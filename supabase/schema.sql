-- Run once in your project's Supabase SQL Editor. Safe to run again.
begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 3 and 24 and username ~ '^[a-zA-Z0-9_]+$'),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_unique on public.profiles (lower(username));

create table if not exists public.solutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  language text not null check (language in ('cpp','python','java','javascript','c')),
  code text not null check (octet_length(code) <= 360000),
  input text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists solutions_user_updated on public.solutions(user_id, updated_at desc);

create table if not exists public.stress_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  config jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists stress_runs_user_created on public.stress_runs(user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.solutions enable row level security;
alter table public.stress_runs enable row level security;

drop policy if exists "Users manage their profile" on public.profiles;
create policy "Users manage their profile" on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
drop policy if exists "Users manage their solutions" on public.solutions;
create policy "Users manage their solutions" on public.solutions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users manage their stress runs" on public.stress_runs;
create policy "Users manage their stress runs" on public.stress_runs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.solutions, public.stress_runs to authenticated;
revoke all on public.profiles, public.solutions, public.stress_runs from anon;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists solutions_updated_at on public.solutions;
create trigger solutions_updated_at before update on public.solutions for each row execute function public.set_updated_at();

-- Authentication itself needs no custom table: passwords and sessions live in Supabase Auth.
-- Profiles are created on first visit, so this migration also works for existing accounts.
commit;

-- Whiteboard support (also available as a standalone migration).
-- Existing installations: run this in the Supabase SQL Editor to enable account saves.
begin;
create table if not exists public.whiteboards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  document jsonb not null check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 512000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists whiteboards_user_updated on public.whiteboards(user_id, updated_at desc);
alter table public.whiteboards enable row level security;
drop policy if exists "Users manage their whiteboards" on public.whiteboards;
create policy "Users manage their whiteboards" on public.whiteboards for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.whiteboards to authenticated;
revoke all on public.whiteboards from anon;
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists whiteboards_updated_at on public.whiteboards;
create trigger whiteboards_updated_at before update on public.whiteboards for each row execute function public.set_updated_at();
commit;
