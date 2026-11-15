-- Prime Games — Phase 3 (customer-centred): 0006 payments (append-only ledger)
-- Target: poaxanthiifatydqbnqq.supabase.co (public). Idempotent + reversible.
-- Depends on: 0002_customers.sql, 0004_bookings.sql, 0005_rentals.sql.
--
-- The financial source of truth. APPEND-ONLY: rows are never updated or deleted
-- (enforced by deny_mutation() for EVERY role, including service_role).
-- Corrections are new reversing entries (refund / adjustment), never edits.
--
-- Sign convention (amount is a non-zero integer TZS):
--   positive = money RECEIVED from the customer (rental/deposit/late_fee/damage_fee)
--   negative = money RETURNED to the customer (refund)
--   adjustment / other may be either sign.
-- Only status = 'settled' entries affect customer_outstanding(); pending/failed
-- are informational intents, refunded is a legacy label. Partial payments are
-- simply multiple settled entries that sum against the charge.
--
-- "Avoid duplicated/derived fields": no customer_name/phone (use customer_id),
-- no stored balance (derived by customer_outstanding()). FKs use RESTRICT so
-- cascade maintenance never issues an UPDATE that the append-only guard blocks.
-- There is intentionally NO updated_at column (rows are immutable).

create table if not exists public.payments (
  id                 uuid primary key default gen_random_uuid(),
  ref                text not null,
  customer_id        uuid not null,
  booking_id         uuid,
  rental_id          uuid,
  amount             integer not null,
  currency           text not null default 'TZS',
  kind               text not null,
  method             text not null,
  status             text not null default 'settled',
  external_reference text,
  notes              text,
  occurred_at        timestamptz not null default now(),
  recorded_by        text,
  created_at         timestamptz not null default now(),
  constraint payments_ref_key unique (ref),
  constraint payments_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete restrict,
  constraint payments_booking_id_fkey
    foreign key (booking_id) references public.bookings (id) on delete restrict,
  constraint payments_rental_id_fkey
    foreign key (rental_id) references public.rentals (id) on delete restrict,
  constraint payments_amount_check check (amount <> 0),
  constraint payments_currency_check check (currency = 'TZS'),
  constraint payments_kind_check
    check (kind in ('rental', 'deposit', 'refund', 'late_fee', 'damage_fee', 'adjustment', 'other')),
  constraint payments_method_check check (method in ('mpesa', 'cod', 'cash', 'bank')),
  constraint payments_status_check check (status in ('settled', 'pending', 'failed', 'refunded')),
  constraint payments_refund_sign_check check (kind <> 'refund' or amount < 0),
  constraint payments_receipt_sign_check
    check (kind not in ('rental', 'deposit', 'late_fee', 'damage_fee') or amount > 0),
  constraint payments_notes_check check (notes is null or char_length(notes) <= 1000)
);

create index if not exists payments_customer_idx on public.payments (customer_id);
create index if not exists payments_booking_idx  on public.payments (booking_id);
create index if not exists payments_rental_idx   on public.payments (rental_id);
create index if not exists payments_occurred_idx on public.payments (occurred_at);
create index if not exists payments_status_idx   on public.payments (status);
create index if not exists payments_kind_idx     on public.payments (kind);

-- Append-only enforcement (blocks UPDATE and DELETE for all roles).
drop trigger if exists payments_append_only on public.payments;
create trigger payments_append_only
  before update or delete on public.payments
  for each row execute function public.deny_mutation();