-- Prime Games — Phase 3: business schema consolidation
-- Target project: poaxanthiifatydqbnqq.supabase.co  (schema: public)
-- Run in Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Idempotent: safe to re-run (create table if not exists / create index if not exists).
--
-- Reconstructs the six business tables verified against the live Qoder-managed
-- database (same column names, types and nullability) and adds:
--   * surrogate defaults (gen_random_uuid() / now()) — the app always supplies
--     id/created_at explicitly, so these only affect direct SQL inserts;
--   * named foreign keys (bookings→auth.users/consoles, maintenance→consoles,
--     transactions→bookings, incidents→bookings/consoles);
--   * CHECK constraints matching the backend vocabularies in functions/handler.mjs;
--   * the original secondary indexes and unique keys.
--
-- This migration does NOT touch the original Qoder database. It only creates
-- objects in the target Supabase project. profiles.sql is assumed already applied.
--
-- Creation order respects FK dependencies: consoles, games, bookings,
-- maintenance, transactions, incidents. auth.users already exists (Supabase Auth).

-- 1) consoles — PS5 fleet ----------------------------------------------------
create table if not exists public.consoles (
  id              uuid primary key default gen_random_uuid(),
  unit_code       text not null,
  model           text not null,
  serial_number   text,
  status          text not null default 'available',
  condition_grade text not null default 'good',
  current_renter  text,
  rentals_count   integer not null default 0,
  last_audit_at   timestamptz,
  purchased_at    timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  constraint consoles_unit_code_key unique (unit_code),
  constraint consoles_status_check
    check (status in ('available', 'rented', 'maintenance', 'retired')),
  constraint consoles_condition_grade_check
    check (condition_grade in ('excellent', 'good', 'fair', 'poor')),
  constraint consoles_rentals_count_check check (rentals_count >= 0)
);

-- 2) games — catalog ---------------------------------------------------------
create table if not exists public.games (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  platform      text not null,
  genre         text,
  media_format  text,
  cover_url     text,
  status        text not null default 'available',
  created_at    timestamptz not null default now(),
  constraint games_platform_check check (platform in ('ps5', 'ps4')),
  constraint games_media_format_check check (media_format in ('disc', 'digital')),
  constraint games_status_check
    check (status in ('available', 'rented', 'retired'))
);

-- 3) bookings — rentals (guest + member) -------------------------------------
-- user_id links a booking to an authenticated member; NULL = guest booking.
-- on delete set null preserves the historical booking if the auth user is removed.
create table if not exists public.bookings (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null,
  customer_name   text not null,
  customer_phone  text not null,
  zone_key        text not null,
  address         text not null,
  package_key     text not null,
  days            integer not null,
  start_date      text not null,
  start_time      text not null,
  id_type         text not null,
  id_number       text not null,
  ec_name         text not null,
  ec_phone        text not null,
  payment_method  text not null,
  rental_amount   integer not null,
  discount        integer not null default 0,
  delivery_fee    integer,
  total           integer not null,
  status          text not null default 'pending',
  payment_status  text not null default 'unpaid',
  notes           text,
  created_at      timestamptz not null default now(),
  user_id         uuid,
  console_id      uuid,
  constraint bookings_ref_key unique (ref),
  constraint bookings_package_key_check
    check (package_key in ('starter', 'weekend', 'night')),
  constraint bookings_zone_key_check
    check (zone_key in ('goba', 'sinza', 'mbezi', 'kigamboni', 'magomeni', 'oyster', 'other')),
  constraint bookings_id_type_check
    check (id_type in ('nida', 'licence', 'passport')),
  constraint bookings_payment_method_check
    check (payment_method in ('mpesa', 'cod')),
  constraint bookings_status_check
    check (status in ('pending', 'confirmed', 'delivered', 'completed', 'cancelled')),
  constraint bookings_payment_status_check
    check (payment_status in ('unpaid', 'paid')),
  constraint bookings_days_check check (days > 0),
  constraint bookings_rental_amount_check check (rental_amount >= 0),
  constraint bookings_discount_check check (discount >= 0),
  constraint bookings_delivery_fee_check check (delivery_fee >= 0),
  constraint bookings_total_check check (total >= 0),
  constraint bookings_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null,
  constraint bookings_console_id_fkey
    foreign key (console_id) references public.consoles (id) on delete set null
);

-- 4) maintenance — repair registry ------------------------------------------
-- console_id is required; on delete restrict prevents losing repair history.
create table if not exists public.maintenance (
  id           uuid primary key default gen_random_uuid(),
  console_id   uuid not null,
  unit_code    text not null,
  issue        text not null,
  status       text not null default 'open',
  priority     text not null default 'medium',
  engineer     text,
  cost         integer,
  notes        text,
  opened_at    timestamptz not null default now(),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint maintenance_status_check
    check (status in ('open', 'in_progress', 'resolved')),
  constraint maintenance_priority_check
    check (priority in ('low', 'medium', 'high', 'critical')),
  constraint maintenance_cost_check check (cost >= 0),
  constraint maintenance_console_id_fkey
    foreign key (console_id) references public.consoles (id) on delete restrict
);

-- 5) transactions — payment ledger ------------------------------------------
-- booking_id is optional; on delete set null keeps the ledger entry intact.
create table if not exists public.transactions (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null,
  booking_id      uuid,
  booking_ref     text,
  customer_name   text not null,
  customer_phone  text,
  amount          integer not null,
  method          text not null,
  kind            text not null,
  status          text not null,
  notes           text,
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint transactions_ref_key unique (ref),
  constraint transactions_method_check
    check (method in ('mpesa', 'cod', 'cash', 'bank')),
  constraint transactions_kind_check
    check (kind in ('rental', 'deposit', 'refund', 'damage_fee', 'late_fee', 'other')),
  constraint transactions_status_check
    check (status in ('settled', 'pending', 'failed', 'refunded')),
  constraint transactions_booking_id_fkey
    foreign key (booking_id) references public.bookings (id) on delete set null
);

-- 6) incidents — damage / loss claims ---------------------------------------
create table if not exists public.incidents (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null,
  booking_id       uuid,
  booking_ref      text,
  console_id       uuid,
  unit_code        text,
  customer_name    text not null,
  customer_phone   text,
  kind             text not null,
  severity         text not null,
  status           text not null,
  description      text,
  claim_amount     integer,
  resolved_amount  integer,
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  constraint incidents_ref_key unique (ref),
  constraint incidents_kind_check
    check (kind in ('damage', 'loss', 'theft', 'late_return', 'malfunction', 'other')),
  constraint incidents_severity_check
    check (severity in ('low', 'medium', 'high', 'critical')),
  constraint incidents_status_check
    check (status in ('open', 'investigating', 'resolved', 'waived')),
  constraint incidents_booking_id_fkey
    foreign key (booking_id) references public.bookings (id) on delete set null,
  constraint incidents_console_id_fkey
    foreign key (console_id) references public.consoles (id) on delete set null
);

-- Secondary indexes (names match the live source database) -------------------
create index if not exists bookings_created_idx      on public.bookings (created_at);
create index if not exists bookings_phone_idx        on public.bookings (customer_phone);
create index if not exists bookings_status_idx       on public.bookings (status);
create index if not exists bookings_user_idx         on public.bookings (user_id);
create index if not exists bookings_console_idx      on public.bookings (console_id);
create index if not exists consoles_status_idx       on public.consoles (status);
create index if not exists games_platform_idx        on public.games (platform);
create index if not exists games_status_idx          on public.games (status);
create index if not exists maintenance_console_idx   on public.maintenance (console_id);
create index if not exists maintenance_status_idx    on public.maintenance (status);
create index if not exists transactions_occurred_idx on public.transactions (occurred_at);
create index if not exists transactions_status_idx   on public.transactions (status);
create index if not exists incidents_status_idx      on public.incidents (status);