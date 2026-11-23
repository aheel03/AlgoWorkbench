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
