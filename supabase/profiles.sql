-- Prime Games customer portal — Supabase auth project schema
-- Project: poaxanthiifatydqbnqq.supabase.co
-- Run this once in the Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run (idempotent: uses if not exists / create or replace / drop-if-exists).

-- 1) profiles table (one row per auth user; matches the portal Profile type)
create table if not exists public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  full_name        text not null default '',
  email            text,
  phone            text,
  address          text,
  tier             text not null default 'standard' check (tier in ('standard', 'premium')),
  kyc_status       text not null default 'none'     check (kyc_status in ('none', 'pending', 'verified')),
  kyc_id_type      text,
  kyc_id_masked    text,
  sms_confirmations boolean not null default true,
  loyalty_points   integer not null default 0,
  created_at       timestamptz not null default now()
);

-- 2) Row Level Security: a member can only read/update their own row.
--    Insert is done by the trigger below (security definer); account deletion
--    cascades from auth.users, so no insert/delete policies are exposed.
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- 3) Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
