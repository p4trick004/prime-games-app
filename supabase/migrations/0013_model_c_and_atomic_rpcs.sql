-- Prime Games — Phase 4 remediation: 0013 Model C finance + atomic RPC layer
-- Target: poaxanthiifatydqbnqq.supabase.co (public). Idempotent + reversible.
-- Depends on: 0001–0010 (applied). NEVER edits applied migrations; replaces
-- functions in place via create or replace.
--
-- CONTENTS
--   1. Model C: customer_outstanding() counts only INCURRED debt
--      (delivered/completed bookings), not future commitments.
--      customer_commitments() exposes future booking totals for display.
--   2. rentals_enforce_credit: gate includes the booking's own total while the
--      booking is not yet delivered, so Basic/Standard still must settle the
--      current booking before handover regardless of statement order.
--   3. Atomic RPCs (single transaction each, app.actor set for audit triggers):
--      resolve_guest_customer, handover_rental, return_rental,
--      settle_booking, unsettle_booking, admin_update_booking,
--      admin_update_customer.
--   4. SQL-side aggregation (no row caps): outstanding_by_customer,
--      customer_summaries, revenue_stats.
--
-- SECURITY: every new RPC is SECURITY INVOKER with pinned search_path, revoked
-- from PUBLIC/anon/authenticated, granted to service_role only. The edge
-- function is the sole caller and enforces admin/customer authorization before
-- invoking. p_actor is supplied SERVER-SIDE by the backend, never by browsers.
-- Append-only payments is untouched: RPCs only INSERT ledger rows.

-- ===========================================================================
-- 1) MODEL C — commitment vs debt
-- ===========================================================================
-- Debt = delivered/completed booking totals (obligations already incurred)
--      + non-cancelled rental late fees
--      + liability incident claims (not waived)
--      - net settled payments.
-- Future pending/confirmed bookings are COMMITMENTS, not debt: an unpaid
-- reservation must not block handover of a fully-paid current booking.
create or replace function public.customer_outstanding(p_customer_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
      coalesce((select sum(b.total)   from public.bookings b
                 where b.customer_id = p_customer_id
                   and b.status in ('delivered', 'completed')), 0)
    + coalesce((select sum(r.late_fee) from public.rentals r
                 where r.customer_id = p_customer_id and r.status <> 'cancelled'), 0)
    + coalesce((select sum(coalesce(i.resolved_amount, i.claim_amount, 0))
                  from public.incidents i
                 where i.customer_id = p_customer_id
                   and i.status in ('open', 'investigating', 'resolved')
                   and i.kind in ('damage', 'loss', 'theft', 'late_return')), 0)
    - coalesce((select sum(p.amount)  from public.payments p
                 where p.customer_id = p_customer_id and p.status = 'settled'), 0)
$$;

-- Future reservation totals (display only; never gates credit).
create or replace function public.customer_commitments(p_customer_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select sum(b.total) from public.bookings b
                    where b.customer_id = p_customer_id
                      and b.status in ('pending', 'confirmed')), 0)
$$;

-- ===========================================================================
-- 2) Handover gate: include the current booking's total until it is delivered
-- ===========================================================================
create or replace function public.rentals_enforce_credit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_additional integer := 0;
begin
  if new.status = 'active' then
    -- Under Model C a confirmed booking is not yet debt; its agreed total must
    -- still be covered at handover. Once delivered, customer_outstanding()
    -- already includes it, so no additional charge is added (no double count).
    select case when b.status in ('pending', 'confirmed') then b.total else 0 end
      into v_additional
    from public.bookings b
    where b.id = new.booking_id;
    perform public.assert_credit_available(new.customer_id, coalesce(v_additional, 0));
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 3) Atomic RPCs
-- ===========================================================================

-- 3a) Guest dedup without races: advisory transaction lock on the phone, then
--     select-or-insert. Only VERIFIED phones are unique by schema design, so a
--     plain unique index / ON CONFLICT is not available for guest phones.
create or replace function public.resolve_guest_customer(
  p_phone text,
  p_name  text,
  p_actor text default 'system'
)
returns public.customers
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_customer public.customers;
begin
  perform set_config('app.actor', coalesce(p_actor, 'system'), true);
  if p_phone is null or p_phone !~ '^255[67][0-9]{8}$' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 2 and 120 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_phone, 0));

  select * into v_customer
  from public.customers
  where phone = p_phone and auth_user_id is null
  order by created_at, id
  limit 1;

  if found then
    if btrim(p_name) is distinct from v_customer.full_name then
      update public.customers
        set full_name = btrim(p_name)
      where id = v_customer.id
      returning * into v_customer;
    end if;
    return v_customer;
  end if;

  insert into public.customers (auth_user_id, full_name, phone, customer_tier, credit_limit, customer_status)
  values (null, btrim(p_name), p_phone, 'basic', 0, 'active')
  returning * into v_customer;
  return v_customer;
end;
$$;

-- 3b) Atomic handover: booking + console row locks, rental activation through
--     the credit gate, console->rented, booking->delivered — one transaction.
--     A credit failure rolls back everything. 23505 from the one-active-console
--     index surfaces as a clean conflict to the caller.
create or replace function public.handover_rental(
  p_booking_id         uuid,
  p_console_id         uuid,
  p_start_at           timestamptz default null,
  p_expected_return_at timestamptz default null,
  p_condition_out      text default null,
  p_notes              text default null,
  p_actor              text default 'system'
)
returns public.rentals
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_booking  public.bookings;
  v_console  public.consoles;
  v_rental   public.rentals;
  v_start    timestamptz;
  v_expected timestamptz;
  v_condition text;
begin
  perform set_config('app.actor', coalesce(p_actor, 'system'), true);

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if v_booking.status in ('cancelled', 'completed') then
    raise exception 'booking_not_handoverable' using errcode = 'P0001';
  end if;

  select * into v_console from public.consoles where id = p_console_id for update;
  if not found then
    raise exception 'console_not_found' using errcode = 'P0002';
  end if;
  if v_console.status <> 'available' then
    raise exception 'console_not_available' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.rentals
              where booking_id = p_booking_id
                and status in ('active', 'overdue', 'returned')) then
    raise exception 'rental_already_exists' using errcode = 'P0001';
  end if;

  v_start := coalesce(p_start_at, now());
  v_expected := coalesce(p_expected_return_at, v_start + make_interval(days => v_booking.days));
  if v_expected < v_start then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  v_condition := case when p_condition_out in ('excellent', 'good', 'fair', 'poor')
                      then p_condition_out else v_console.condition_grade end;

  select * into v_rental from public.rentals
  where booking_id = p_booking_id and status = 'scheduled'
  order by created_at, id
  limit 1
  for update;

  if found then
    update public.rentals
      set console_id = p_console_id, status = 'active',
          start_at = v_start, expected_return_at = v_expected,
          condition_out = v_condition, notes = coalesce(p_notes, notes)
    where id = v_rental.id
    returning * into v_rental;
  else
    insert into public.rentals (customer_id, booking_id, console_id, status,
                                start_at, expected_return_at, condition_out, notes)
    values (v_booking.customer_id, p_booking_id, p_console_id, 'active',
            v_start, v_expected, v_condition, p_notes)
    returning * into v_rental;
  end if;

  update public.consoles set status = 'rented' where id = p_console_id;
  update public.bookings set status = 'delivered' where id = p_booking_id;
  return v_rental;
end;
$$;

-- 3c) Atomic return: rental->returned (+late fee), console->available
--     (+condition), booking->completed — one transaction, idempotency-guarded.
create or replace function public.return_rental(
  p_rental_id        uuid,
  p_actual_return_at timestamptz default null,
  p_late_fee         integer default null,
  p_condition_in     text default null,
  p_notes            text default null,
  p_actor            text default 'system'
)
returns public.rentals
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rental  public.rentals;
  v_actual  timestamptz;
  v_fee     integer;
  v_condition text;
begin
  perform set_config('app.actor', coalesce(p_actor, 'system'), true);

  select * into v_rental from public.rentals where id = p_rental_id for update;
  if not found then
    raise exception 'rental_not_found' using errcode = 'P0002';
  end if;
  if v_rental.status not in ('active', 'overdue') then
    raise exception 'rental_not_active' using errcode = 'P0001';
  end if;

  v_actual := coalesce(p_actual_return_at, now());
  if v_rental.start_at is not null and v_actual < v_rental.start_at then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  v_fee := coalesce(p_late_fee, v_rental.late_fee, 0);
  if v_fee < 0 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  v_condition := case when p_condition_in in ('excellent', 'good', 'fair', 'poor')
                      then p_condition_in else null end;

  update public.rentals
    set status = 'returned', actual_return_at = v_actual, late_fee = v_fee,
        condition_in = coalesce(v_condition, condition_in),
        notes = coalesce(p_notes, notes)
  where id = v_rental.id
  returning * into v_rental;

  if v_rental.console_id is not null then
    update public.consoles
      set status = 'available',
          condition_grade = coalesce(v_condition, condition_grade)
    where id = v_rental.console_id;
  end if;
  update public.bookings set status = 'completed' where id = v_rental.booking_id;
  return v_rental;
end;
$$;

-- Ledger ref generator: TXN- + 6 unambiguous chars (same alphabet as the
-- backend), derived from md5 so no extension beyond built-ins is required.
create or replace function public.make_ledger_ref()
returns text
language sql
volatile
set search_path = public, pg_temp
as $$
  select 'TXN-' || (
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                             strpos('0123456789ABCDEF', upper(c)), 1), '')
    from unnest(string_to_array(substr(md5(random()::text || clock_timestamp()::text), 1, 6), null)) as c
  )
$$;

-- 3d) Settle a booking atomically: lock, idempotency check, append the receipt
--     for the remaining total, flip payment_status. Returns NULL when already
--     fully settled (no duplicate entry under concurrent calls).
create or replace function public.settle_booking(
  p_booking_id uuid,
  p_actor      text default 'system'
)
returns public.payments
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings;
  v_settled integer;
  v_payment public.payments;
  v_attempt integer;
begin
  perform set_config('app.actor', coalesce(p_actor, 'system'), true);

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  select coalesce(sum(amount), 0) into v_settled
  from public.payments
  where booking_id = p_booking_id and status = 'settled';

  if v_booking.total - v_settled <= 0 then
    if v_booking.payment_status <> 'paid' then
      update public.bookings set payment_status = 'paid' where id = p_booking_id;
    end if;
    return null;
  end if;

  for v_attempt in 1..3 loop
    begin
      insert into public.payments (ref, customer_id, booking_id, amount, kind, method,
                                   status, notes, recorded_by)
      values (public.make_ledger_ref(), v_booking.customer_id, p_booking_id,
              v_booking.total - v_settled, 'rental',
              case when v_booking.payment_method = 'cod' then 'cod' else 'mpesa' end,
              'settled', 'Booking marked paid', p_actor)
      returning * into v_payment;
      exit;
    exception when unique_violation then
      if v_attempt = 3 then raise; end if;
    end;
  end loop;

  update public.bookings set payment_status = 'paid' where id = p_booking_id;
  return v_payment;
end;
$$;

-- 3e) Unsettle: append a reversing adjustment zeroing the booking's settled
--     ledger, flip payment_status. Never edits existing rows.
create or replace function public.unsettle_booking(
  p_booking_id uuid,
  p_actor      text default 'system'
)
returns public.payments
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings;
  v_settled integer;
  v_payment public.payments;
  v_attempt integer;
begin
  perform set_config('app.actor', coalesce(p_actor, 'system'), true);

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  select coalesce(sum(amount), 0) into v_settled
  from public.payments
  where booking_id = p_booking_id and status = 'settled';

  if v_settled <= 0 then
    if v_booking.payment_status <> 'unpaid' then
      update public.bookings set payment_status = 'unpaid' where id = p_booking_id;
    end if;
    return null;
  end if;

  for v_attempt in 1..3 loop
    begin
      insert into public.payments (ref, customer_id, booking_id, amount, kind, method,
                                   status, notes, recorded_by)
      values (public.make_ledger_ref(), v_booking.customer_id, p_booking_id,
              -v_settled, 'adjustment',
              case when v_booking.payment_method = 'cod' then 'cod' else 'mpesa' end,
              'settled', 'Reversal: booking marked unpaid', p_actor)
      returning * into v_payment;
      exit;
    exception when unique_violation then
      if v_attempt = 3 then raise; end if;
    end;
  end loop;

  update public.bookings set payment_status = 'unpaid' where id = p_booking_id;
  return v_payment;
end;
$$;

-- 3f) Admin booking update: status / notes / payment flag in ONE transaction;
--     payment flag changes mirror into the ledger via settle/unsettle so the
--     flag and the ledger can never diverge.
create or replace function public.admin_update_booking(
  p_booking_id     uuid,
  p_status         text default null,
  p_payment_status text default null,
  p_notes          text default null,
  p_clear_notes    boolean default false,
  p_actor          text default 'system'
)
returns public.bookings
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings;
begin
  perform set_config('app.actor', coalesce(p_actor, 'system'), true);

  if p_status is not null and p_status not in ('pending', 'confirmed', 'delivered', 'completed', 'cancelled') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_payment_status is not null and p_payment_status not in ('unpaid', 'paid') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_notes is not null and char_length(p_notes) > 1000 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_status is null and p_payment_status is null and p_notes is null and not p_clear_notes then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  if p_payment_status is not null and p_payment_status is distinct from v_booking.payment_status then
    if p_payment_status = 'paid' then
      perform public.settle_booking(p_booking_id, p_actor);
    else
      perform public.unsettle_booking(p_booking_id, p_actor);
    end if;
  end if;

  update public.bookings
    set status = coalesce(p_status, status),
        notes = case when p_clear_notes then null else coalesce(p_notes, notes) end
  where id = p_booking_id
  returning * into v_booking;
  return v_booking;
end;
$$;

-- 3g) Admin customer update with audit attribution: tier/credit/status/notes
--     under the non-premium-no-credit rule, profiles tier sync, app.actor set
--     so contact-history and credit-event triggers record the real actor.
create or replace function public.admin_update_customer(
  p_customer_id     uuid,
  p_customer_tier   text default null,
  p_credit_limit    integer default null,
  p_customer_status text default null,
  p_notes           text default null,
  p_clear_notes     boolean default false,
  p_actor           text default 'system'
)
returns public.customers
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_customer public.customers;
  v_tier     text;
  v_limit    integer;
begin
  perform set_config('app.actor', coalesce(p_actor, 'system'), true);

  if p_customer_tier is not null and p_customer_tier not in ('basic', 'standard', 'premium') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_customer_status is not null and p_customer_status not in ('active', 'suspended', 'blacklisted') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_credit_limit is not null and (p_credit_limit < 0 or p_credit_limit > 100000000) then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_notes is not null and char_length(p_notes) > 1000 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_customer_tier is null and p_credit_limit is null and p_customer_status is null
     and p_notes is null and not p_clear_notes then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  select * into v_customer from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;

  v_tier := coalesce(p_customer_tier, v_customer.customer_tier);
  v_limit := coalesce(p_credit_limit, v_customer.credit_limit);
  -- DB CHECK: non-premium must have zero credit. Premium promotion without an
  -- explicit limit keeps 0 until a limit is approved.
  if v_tier <> 'premium' then
    v_limit := 0;
  end if;

  update public.customers
    set customer_tier = v_tier,
        credit_limit = v_limit,
        customer_status = coalesce(p_customer_status, customer_status),
        notes = case when p_clear_notes then null else coalesce(p_notes, notes) end
  where id = p_customer_id
  returning * into v_customer;

  if v_customer.auth_user_id is not null then
    update public.profiles
      set tier = case when v_customer.customer_tier = 'premium' then 'premium' else 'standard' end
    where id = v_customer.auth_user_id;
  end if;
  return v_customer;
end;
$$;

-- ===========================================================================
-- 4) SQL-side aggregation (replaces capped .limit(5000) JS scans)
-- ===========================================================================
create or replace function public.outstanding_by_customer()
returns table (customer_id uuid, outstanding integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select c.id, public.customer_outstanding(c.id)
  from public.customers c
$$;

-- Per-customer dashboard summary. spend = positive settled receipts only
-- (matches the legacy admin_customers semantics). zone_key = most recent
-- booking's zone; last_at = latest of customer creation / booking creation.
create or replace function public.customer_summaries()
returns table (
  customer_id uuid,
  bookings    bigint,
  spend       bigint,
  open        bigint,
  zone_key    text,
  last_at     timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select c.id,
         coalesce(b.cnt, 0),
         coalesce(p.spend, 0),
         coalesce(b.open_cnt, 0),
         b.zone_key,
         greatest(c.created_at, b.last_at)
  from public.customers c
  left join lateral (
    select count(*) as cnt,
           count(*) filter (where status in ('pending', 'confirmed', 'delivered')) as open_cnt,
           (array_agg(zone_key order by created_at desc, id desc))[1] as zone_key,
           max(created_at) as last_at
    from public.bookings
    where customer_id = c.id
  ) b on true
  left join lateral (
    select coalesce(sum(amount) filter (where status = 'settled' and amount > 0), 0) as spend
    from public.payments
    where customer_id = c.id
  ) p on true
$$;

-- Net settled revenue + today's portion in East Africa Time (UTC+3).
create or replace function public.revenue_stats()
returns table (revenue bigint, revenue_today bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(sum(amount), 0),
         coalesce(sum(amount) filter (
           where (occurred_at at time zone 'UTC' + interval '3 hours')::date
               = (now() at time zone 'UTC' + interval '3 hours')::date
         ), 0)
  from public.payments
  where status = 'settled'
$$;

-- ===========================================================================
-- Grants: new RPCs are service_role-only. customer_outstanding keeps its
-- existing grants (RLS policies and the customer my_payments path use it).
-- ===========================================================================
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.resolve_guest_customer(text, text, text)',
    'public.handover_rental(uuid, uuid, timestamptz, timestamptz, text, text, text)',
    'public.return_rental(uuid, timestamptz, integer, text, text, text)',
    'public.settle_booking(uuid, text)',
    'public.unsettle_booking(uuid, text)',
    'public.admin_update_booking(uuid, text, text, text, boolean, text)',
    'public.admin_update_customer(uuid, text, integer, text, text, boolean, text)',
    'public.outstanding_by_customer()',
    'public.customer_summaries()',
    'public.revenue_stats()',
    'public.customer_commitments(uuid)',
    'public.make_ledger_ref()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;