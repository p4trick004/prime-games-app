-- Prime Games — Phase 3 (customer-centred): 0004 bookings + booking_games
-- Target: poaxanthiifatydqbnqq.supabase.co (public). Idempotent + reversible.
-- Depends on: 0002_customers.sql, 0003_inventory.sql.
--
-- Bookings are reservations (guest or member). They are SEPARATE from rentals
-- (the physical console lifecycle, 0005). Basic/Standard may create UNPAID
-- reservations; payment is enforced before console HANDOVER via the rental
-- credit gate, not at booking time.
--
-- "Avoid duplicated/derived fields": customer_name/customer_phone/user_id/
-- console_id from the legacy schema are REMOVED. Identity comes from customer_id;
-- the assigned console lives on rentals. id_type/id_number/ec_name/ec_phone are
-- kept because they are the per-agreement contract identity + emergency contact
-- (not derivable from customers). total is the agreed price snapshot; the CHECK
-- pins it to rental_amount + delivery_fee. payment_status is retained as a
-- workflow flag for API compatibility; the payments ledger is authoritative for
-- balances. The Phase 4 backend joins customers to reproduce customer_name/phone.

-- 1) bookings ---------------------------------------------------------------
create table if not exists public.bookings (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null,
  customer_id    uuid not null,
  zone_key       text not null,
  address        text not null,
  package_key    text not null,
  days           integer not null,
  start_date     text not null,
  start_time     text not null,
  id_type        text not null,
  id_number      text not null,
  ec_name        text not null,
  ec_phone       text not null,
  payment_method text not null,
  rental_amount  integer not null,
  discount       integer not null default 0,
  delivery_fee   integer,
  total          integer not null,
  status         text not null default 'pending',
  payment_status text not null default 'unpaid',
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint bookings_ref_key unique (ref),
  constraint bookings_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete restrict,
  constraint bookings_package_key_check check (package_key in ('starter', 'weekend', 'night')),
  constraint bookings_zone_key_check
    check (zone_key in ('goba', 'sinza', 'mbezi', 'kigamboni', 'magomeni', 'oyster', 'other')),
  constraint bookings_id_type_check check (id_type in ('nida', 'licence', 'passport')),
  constraint bookings_payment_method_check check (payment_method in ('mpesa', 'cod')),
  constraint bookings_status_check
    check (status in ('pending', 'confirmed', 'delivered', 'completed', 'cancelled')),
  constraint bookings_payment_status_check check (payment_status in ('unpaid', 'paid')),
  constraint bookings_days_check check (days between 1 and 30),
  constraint bookings_weekend_days_check check (package_key <> 'weekend' or days = 1),
  constraint bookings_rental_amount_check check (rental_amount >= 0),
  constraint bookings_discount_check check (discount >= 0),
  constraint bookings_delivery_fee_check check (delivery_fee is null or delivery_fee >= 0),
  constraint bookings_total_check check (total >= 0),
  constraint bookings_total_consistency_check check (total = rental_amount + coalesce(delivery_fee, 0)),
  constraint bookings_address_check check (char_length(address) between 3 and 200),
  constraint bookings_start_date_check check (start_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  constraint bookings_start_time_check check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint bookings_id_number_check check (id_number ~ '^[\w\-/. ]{4,64}$'),
  constraint bookings_ec_name_check check (char_length(ec_name) between 2 and 120),
  constraint bookings_ec_phone_check check (ec_phone ~ '^255[67][0-9]{8}$'),
  constraint bookings_notes_check check (notes is null or char_length(notes) <= 1000)
);

create index if not exists bookings_customer_idx       on public.bookings (customer_id);
create index if not exists bookings_status_idx         on public.bookings (status);
create index if not exists bookings_payment_status_idx on public.bookings (payment_status);
create index if not exists bookings_created_idx        on public.bookings (created_at);

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- 2) booking_games — requested games per booking (junction) -----------------
create table if not exists public.booking_games (
  booking_id uuid not null,
  game_id    uuid not null,
  created_at timestamptz not null default now(),
  constraint booking_games_pkey primary key (booking_id, game_id),
  constraint booking_games_booking_id_fkey
    foreign key (booking_id) references public.bookings (id) on delete cascade,
  constraint booking_games_game_id_fkey
    foreign key (game_id) references public.games (id) on delete restrict
);

create index if not exists booking_games_game_idx on public.booking_games (game_id);