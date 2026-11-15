-- Prime Games — Phase 3 (customer-centred): 0005 rentals + handover credit gate
-- Target: poaxanthiifatydqbnqq.supabase.co (public). Idempotent + reversible.
-- Depends on: 0001_helpers.sql, 0002_customers.sql, 0003_inventory.sql, 0004_bookings.sql.
--
-- A rental is the physical console lifecycle, SEPARATE from the booking
-- (reservation). Every rental stems from a booking (booking_id NOT NULL); the
-- agreed charge is booking.total, so rentals does NOT duplicate an agreed_total
-- or daily_rate ("avoid duplicated/derived fields"). late_fee is an additional
-- charge counted by customer_outstanding().
--
-- HANDOVER RULE: a rental may only become 'active' (console handed over) when
-- assert_credit_available() passes. Basic/Standard (credit_limit = 0) must be
-- fully settled first; Premium may carry outstanding within their approved limit.
-- The gate locks the customer row FOR UPDATE, so concurrent handovers cannot
-- bypass the limit. 'overdue'/'returned' are post-handover states and are NOT
-- re-gated (a late fee must not block marking a rental overdue).

create table if not exists public.rentals (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null,
  booking_id         uuid not null,
  console_id         uuid,
  status             text not null default 'scheduled',
  start_at           timestamptz,
  expected_return_at timestamptz,
  actual_return_at   timestamptz,
  condition_out      text,
  condition_in       text,
  late_fee           integer not null default 0,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint rentals_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete restrict,
  constraint rentals_booking_id_fkey
    foreign key (booking_id) references public.bookings (id) on delete restrict,
  constraint rentals_console_id_fkey
    foreign key (console_id) references public.consoles (id) on delete set null,
  constraint rentals_status_check
    check (status in ('scheduled', 'active', 'returned', 'overdue', 'cancelled')),
  constraint rentals_condition_out_check
    check (condition_out is null or condition_out in ('excellent', 'good', 'fair', 'poor')),
  constraint rentals_condition_in_check
    check (condition_in is null or condition_in in ('excellent', 'good', 'fair', 'poor')),
  constraint rentals_late_fee_check check (late_fee >= 0),
  constraint rentals_active_console_check
    check (status not in ('active', 'overdue', 'returned') or console_id is not null),
  constraint rentals_active_start_check
    check (status not in ('active', 'overdue') or (start_at is not null and expected_return_at is not null)),
  constraint rentals_returned_check
    check (status <> 'returned' or actual_return_at is not null),
  constraint rentals_return_after_start_check
    check (actual_return_at is null or start_at is null or actual_return_at >= start_at),
  constraint rentals_expected_after_start_check
    check (expected_return_at is null or start_at is null or expected_return_at >= start_at)
);

-- A console can be in at most one active/overdue rental at a time.
create unique index if not exists rentals_one_active_console
  on public.rentals (console_id)
  where status in ('active', 'overdue') and console_id is not null;

create index if not exists rentals_customer_idx on public.rentals (customer_id);
create index if not exists rentals_booking_idx  on public.rentals (booking_id);
create index if not exists rentals_console_idx  on public.rentals (console_id);
create index if not exists rentals_status_idx   on public.rentals (status);
create index if not exists rentals_expected_idx on public.rentals (expected_return_at);

drop trigger if exists rentals_set_updated_at on public.rentals;
create trigger rentals_set_updated_at
  before update on public.rentals
  for each row execute function public.set_updated_at();

-- Handover credit gate (fires on activation only).
create or replace function public.rentals_enforce_credit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'active' then
    perform public.assert_credit_available(new.customer_id, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists rentals_enforce_credit on public.rentals;
create trigger rentals_enforce_credit
  before insert or update of status on public.rentals
  for each row execute function public.rentals_enforce_credit();