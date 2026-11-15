-- Prime Games — Phase 3 (customer-centred): 0001 helper functions
-- Target project: poaxanthiifatydqbnqq.supabase.co  (schema: public)
-- Run in Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- Idempotent (create or replace / drop-if-exists). Reversible: see
-- supabase/rollback/0099_rollback_all.sql. Purely additive; does NOT touch
-- auth.users, public.profiles, or the original Qoder database.
--
-- These functions implement the financial + identity core:
--   * current_customer_id()      maps the signed-in auth user to a customer (RLS).
--   * customer_outstanding()     derives the owed balance from charges + ledger.
--   * assert_credit_available()  transactional handover gate (row lock, no bypass).
--   * set_updated_at()           updated_at maintenance trigger.
--   * deny_mutation()            append-only enforcement for ledger / audit tables.
--
-- gen_random_uuid() is built into PostgreSQL 13+ (Supabase); no extension needed.
--
-- The SQL-language functions below reference tables created in later migrations
-- (0002+). Defer body validation so they can be created first; they resolve at
-- runtime once the tables exist. (plpgsql bodies are never validated at creation.)
set check_function_bodies = off;

-- 1) updated_at maintenance -------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 2) Append-only guard: blocks UPDATE/DELETE for EVERY role (incl. service_role).
--    Corrections are made by appending new reversing entries, never by editing.
create or replace function public.deny_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'append_only_violation: % on % is not permitted', tg_op, tg_table_name
    using errcode = 'P0001';
end;
$$;

-- 3) Map the current auth user to their permanent customer id (NULL for guests).
--    SECURITY DEFINER so it can read customers without tripping customers' own
--    RLS (avoids recursive policy evaluation). STABLE within a statement.
create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.customers where auth_user_id = auth.uid()
$$;

-- 4) Authoritative outstanding balance for a customer (integer TZS).
--    Charges  = non-cancelled booking totals
--             + non-cancelled rental late fees
--             + customer-liability incident claims (damage/loss/theft/late_return,
--               not waived; resolved_amount preferred, else claim_amount).
--    Credits  = net SETTLED ledger payments (refunds are negative entries).
--    Outstanding = charges - credits. May be negative (overpaid / in credit).
--    No balance is stored as a column; it is always derived here.
create or replace function public.customer_outstanding(p_customer_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
      coalesce((select sum(b.total)   from public.bookings b
                 where b.customer_id = p_customer_id and b.status <> 'cancelled'), 0)
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

-- 5) Transactional credit gate, called at console HANDOVER (rental activation).
--    Locks the customer row FOR UPDATE so concurrent handovers serialize and
--    cannot bypass the limit. Basic/Standard have credit_limit = 0, so they must
--    be fully settled (outstanding <= 0) before receiving a console; Premium may
--    carry outstanding up to their approved credit_limit.
--    p_additional_charge covers any charge not yet reflected in bookings/rentals.
create or replace function public.assert_credit_available(
  p_customer_id uuid,
  p_additional_charge integer default 0
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer;
  v_status text;
  v_outstanding integer;
begin
  select credit_limit, customer_status
    into v_limit, v_status
  from public.customers
  where id = p_customer_id
  for update;

  if not found then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;

  if v_status <> 'active' then
    raise exception 'customer_not_active' using errcode = 'P0001';
  end if;

  v_outstanding := public.customer_outstanding(p_customer_id) + coalesce(p_additional_charge, 0);

  if v_outstanding > v_limit then
    raise exception 'credit_limit_exceeded'
      using errcode = 'P0001',
            detail = format('outstanding=%s credit_limit=%s', v_outstanding, v_limit);
  end if;
end;
$$;