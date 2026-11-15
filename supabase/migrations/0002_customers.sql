-- Prime Games — Phase 3 (customer-centred): 0002 customers + identity/credit audits
-- Target: poaxanthiifatydqbnqq.supabase.co (public). Idempotent + reversible.
-- Depends on: 0001_helpers.sql. Does NOT touch auth.users or public.profiles.
--
-- Permanent customer records independent of Supabase Auth:
--   * guest      -> auth_user_id NULL, customer_tier 'basic'
--   * registered -> auth_user_id set (UNIQUE), customer_tier 'standard'
--   * premium    -> admin-granted, credit_limit > 0
-- customers.customer_tier is authoritative for business rules. The legacy
-- profiles table is preserved unchanged for the portal; the backend (Phase 4)
-- syncs profiles <-> customers. No trigger is added on auth.users.
--
-- "Avoid duplicated/derived fields": customer name/phone live ONLY here.
-- Bookings/rentals/payments/incidents reference customer_id; contact changes are
-- audited in customer_contact_history (so historical snapshots are unnecessary).

-- 1) customers --------------------------------------------------------------
create table if not exists public.customers (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid,
  full_name         text not null,
  phone             text,
  email             text,
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  customer_tier     text not null default 'basic',
  credit_limit      integer not null default 0,
  customer_status   text not null default 'active',
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint customers_auth_user_id_key unique (auth_user_id),
  constraint customers_auth_user_id_fkey
    foreign key (auth_user_id) references auth.users (id) on delete set null,
  constraint customers_full_name_check check (char_length(full_name) between 2 and 120),
  constraint customers_phone_check check (phone is null or phone ~ '^255[67][0-9]{8}$'),
  constraint customers_email_check check (email is null or char_length(email) <= 254),
  constraint customers_tier_check check (customer_tier in ('basic', 'standard', 'premium')),
  constraint customers_credit_limit_check check (credit_limit >= 0),
  constraint customers_status_check check (customer_status in ('active', 'suspended', 'blacklisted')),
  -- Only Premium may carry credit; Basic/Standard must settle before handover.
  constraint customers_nonpremium_no_credit check (customer_tier = 'premium' or credit_limit = 0)
);

create index if not exists customers_phone_idx        on public.customers (phone);
create index if not exists customers_tier_idx         on public.customers (customer_tier);
create index if not exists customers_status_idx       on public.customers (customer_status);
create index if not exists customers_created_idx      on public.customers (created_at);
-- A verified contact is unique; unverified contacts may repeat (never auto-merged).
create unique index if not exists customers_phone_verified_key
  on public.customers (phone) where phone is not null and phone_verified_at is not null;
create unique index if not exists customers_email_verified_key
  on public.customers (lower(email)) where email is not null and email_verified_at is not null;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- 2) customer_links — guest->account linking audit --------------------------
-- A link is applied ONLY after verified OTP or secure admin-assisted verification.
-- evidence holds a reference (OTP transaction id / admin note); NEVER raw OTP,
-- secrets, or full ID numbers.
create table if not exists public.customer_links (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null,
  auth_user_id uuid not null,
  link_method  text not null,
  verified     boolean not null default false,
  evidence     text,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  constraint customer_links_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete cascade,
  constraint customer_links_auth_user_id_fkey
    foreign key (auth_user_id) references auth.users (id) on delete cascade,
  constraint customer_links_method_check
    check (link_method in ('otp', 'admin_assisted', 'registration', 'document')),
  constraint customer_links_status_check
    check (status in ('pending', 'linked', 'rejected', 'conflict'))
);

create index if not exists customer_links_customer_idx on public.customer_links (customer_id);
create index if not exists customer_links_auth_idx     on public.customer_links (auth_user_id);
create index if not exists customer_links_status_idx   on public.customer_links (status);

-- 3) customer_contact_history — name/phone/email change audit ---------------
create table if not exists public.customer_contact_history (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  field       text not null,
  old_value   text,
  new_value   text,
  changed_by  text,
  reason      text,
  created_at  timestamptz not null default now(),
  constraint customer_contact_history_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete cascade,
  constraint customer_contact_history_field_check
    check (field in ('full_name', 'phone', 'email'))
);

create index if not exists customer_contact_history_customer_idx on public.customer_contact_history (customer_id);
create index if not exists customer_contact_history_created_idx  on public.customer_contact_history (created_at);

-- 4) customer_credit_events — auditable tier / credit-limit / status changes -
create table if not exists public.customer_credit_events (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null,
  event_type       text not null,
  old_tier         text,
  new_tier         text,
  old_credit_limit integer,
  new_credit_limit integer,
  old_status       text,
  new_status       text,
  reason           text,
  changed_by       text not null default 'system',
  created_at       timestamptz not null default now(),
  constraint customer_credit_events_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete cascade,
  constraint customer_credit_events_type_check
    check (event_type in ('tier_change', 'credit_limit_change', 'tier_and_credit_change', 'status_change'))
);

create index if not exists customer_credit_events_customer_idx on public.customer_credit_events (customer_id);
create index if not exists customer_credit_events_created_idx  on public.customer_credit_events (created_at);

-- 5) Audit triggers ---------------------------------------------------------
-- changed_by is taken from the backend-set GUC app.actor (SET LOCAL app.actor =
-- 'admin:<id>'); falls back to 'system'. SECURITY DEFINER so audit inserts are
-- not blocked by the audit tables' service-only RLS.
create or replace function public.log_customer_contact_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.full_name is distinct from old.full_name then
    insert into public.customer_contact_history (customer_id, field, old_value, new_value, changed_by)
    values (new.id, 'full_name', old.full_name, new.full_name, coalesce(current_setting('app.actor', true), 'system'));
  end if;
  if new.phone is distinct from old.phone then
    insert into public.customer_contact_history (customer_id, field, old_value, new_value, changed_by)
    values (new.id, 'phone', old.phone, new.phone, coalesce(current_setting('app.actor', true), 'system'));
  end if;
  if new.email is distinct from old.email then
    insert into public.customer_contact_history (customer_id, field, old_value, new_value, changed_by)
    values (new.id, 'email', old.email, new.email, coalesce(current_setting('app.actor', true), 'system'));
  end if;
  return new;
end;
$$;

drop trigger if exists customers_log_contact_change on public.customers;
create trigger customers_log_contact_change
  after update of full_name, phone, email on public.customers
  for each row execute function public.log_customer_contact_change();

create or replace function public.log_customer_credit_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
begin
  if new.customer_tier is distinct from old.customer_tier
     or new.credit_limit is distinct from old.credit_limit
     or new.customer_status is distinct from old.customer_status then
    v_type := case
      when new.customer_tier is distinct from old.customer_tier
           and new.credit_limit is distinct from old.credit_limit then 'tier_and_credit_change'
      when new.customer_tier is distinct from old.customer_tier then 'tier_change'
      when new.credit_limit is distinct from old.credit_limit then 'credit_limit_change'
      else 'status_change'
    end;
    insert into public.customer_credit_events (
      customer_id, event_type, old_tier, new_tier, old_credit_limit, new_credit_limit,
      old_status, new_status, changed_by)
    values (
      new.id, v_type, old.customer_tier, new.customer_tier, old.credit_limit, new.credit_limit,
      old.customer_status, new.customer_status, coalesce(current_setting('app.actor', true), 'system'));
  end if;
  return new;
end;
$$;

drop trigger if exists customers_log_credit_change on public.customers;
create trigger customers_log_credit_change
  after update of customer_tier, credit_limit, customer_status on public.customers
  for each row execute function public.log_customer_credit_change();

-- 6) Verified guest->account linking (transactional, no unverified merges) ---
-- The backend MUST call this only after a successful OTP verification or a
-- secure admin-assisted verification. The function refuses unverified methods,
-- requires evidence, serializes per auth user, and NEVER merges two customers:
-- if the auth user is already linked elsewhere it records a 'conflict' and aborts.
-- Attaching auth_user_id promotes a basic guest to standard (registered); the
-- tier change is captured by customers_log_credit_change.
create or replace function public.link_customer_auth(
  p_customer_id uuid,
  p_auth_user_id uuid,
  p_method text,
  p_evidence text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing uuid;
begin
  if p_method not in ('otp', 'admin_assisted') then
    raise exception 'unverified_link_method' using errcode = 'P0001';
  end if;
  if p_evidence is null or char_length(btrim(p_evidence)) < 3 then
    raise exception 'link_evidence_required' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_auth_user_id::text));

  select id into v_existing from public.customers where auth_user_id = p_auth_user_id;
  if v_existing is not null and v_existing <> p_customer_id then
    insert into public.customer_links (customer_id, auth_user_id, link_method, verified, evidence, status, resolved_at)
    values (p_customer_id, p_auth_user_id, p_method, true, p_evidence, 'conflict', now());
    raise exception 'auth_user_already_linked' using errcode = 'P0001';
  end if;

  perform 1 from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;

  update public.customers
     set auth_user_id = p_auth_user_id,
         customer_tier = case when customer_tier = 'basic' then 'standard' else customer_tier end
   where id = p_customer_id;

  insert into public.customer_links (customer_id, auth_user_id, link_method, verified, evidence, status, resolved_at)
  values (p_customer_id, p_auth_user_id, p_method, true, p_evidence, 'linked', now());

  return p_customer_id;
end;
$$;