-- Prime Games — Phase 3 (customer-centred): 0007 maintenance + incidents
-- Target: poaxanthiifatydqbnqq.supabase.co (public). Idempotent + reversible.
-- Depends on: 0002_customers.sql, 0003_inventory.sql, 0004_bookings.sql, 0005_rentals.sql.
--
-- "Avoid duplicated/derived fields": maintenance.unit_code and incidents'
-- customer_name/customer_phone/booking_ref/unit_code snapshots are REMOVED;
-- they are derived via console_id / customer_id / booking_id joins. Column
-- names/enums otherwise match functions/handler.mjs (issue, kind, severity, ...).
-- Incident claim amounts feed customer_outstanding() for customer-liability
-- kinds (damage/loss/theft/late_return) that are not waived.

-- 1) maintenance — repair registry -----------------------------------------
create table if not exists public.maintenance (
  id          uuid primary key default gen_random_uuid(),
  console_id  uuid not null,
  issue       text not null,
  status      text not null default 'open',
  priority    text not null default 'medium',
  engineer    text,
  cost        integer,
  notes       text,
  opened_at   timestamptz not null default now(),
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint maintenance_console_id_fkey
    foreign key (console_id) references public.consoles (id) on delete restrict,
  constraint maintenance_status_check check (status in ('open', 'in_progress', 'resolved')),
  constraint maintenance_priority_check check (priority in ('low', 'medium', 'high', 'critical')),
  constraint maintenance_cost_check check (cost is null or cost >= 0),
  constraint maintenance_issue_check check (char_length(issue) between 2 and 300),
  constraint maintenance_notes_check check (notes is null or char_length(notes) <= 1000)
);

create index if not exists maintenance_console_idx on public.maintenance (console_id);
create index if not exists maintenance_status_idx  on public.maintenance (status);
create index if not exists maintenance_opened_idx  on public.maintenance (opened_at);

drop trigger if exists maintenance_set_updated_at on public.maintenance;
create trigger maintenance_set_updated_at
  before update on public.maintenance
  for each row execute function public.set_updated_at();

-- 2) incidents — damage / loss claims --------------------------------------
create table if not exists public.incidents (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null,
  customer_id     uuid,
  booking_id      uuid,
  rental_id       uuid,
  console_id      uuid,
  kind            text not null,
  severity        text not null,
  status          text not null,
  description     text,
  claim_amount    integer,
  resolved_amount integer,
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint incidents_ref_key unique (ref),
  constraint incidents_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete set null,
  constraint incidents_booking_id_fkey
    foreign key (booking_id) references public.bookings (id) on delete set null,
  constraint incidents_rental_id_fkey
    foreign key (rental_id) references public.rentals (id) on delete set null,
  constraint incidents_console_id_fkey
    foreign key (console_id) references public.consoles (id) on delete set null,
  constraint incidents_kind_check
    check (kind in ('damage', 'loss', 'theft', 'late_return', 'malfunction', 'other')),
  constraint incidents_severity_check check (severity in ('low', 'medium', 'high', 'critical')),
  constraint incidents_status_check check (status in ('open', 'investigating', 'resolved', 'waived')),
  constraint incidents_claim_amount_check check (claim_amount is null or claim_amount >= 0),
  constraint incidents_resolved_amount_check check (resolved_amount is null or resolved_amount >= 0),
  constraint incidents_description_check check (description is null or char_length(description) <= 1000)
);

create index if not exists incidents_customer_idx on public.incidents (customer_id);
create index if not exists incidents_booking_idx  on public.incidents (booking_id);
create index if not exists incidents_rental_idx   on public.incidents (rental_id);
create index if not exists incidents_console_idx  on public.incidents (console_id);
create index if not exists incidents_status_idx   on public.incidents (status);
create index if not exists incidents_severity_idx on public.incidents (severity);
create index if not exists incidents_occurred_idx on public.incidents (occurred_at);

drop trigger if exists incidents_set_updated_at on public.incidents;
create trigger incidents_set_updated_at
  before update on public.incidents
  for each row execute function public.set_updated_at();