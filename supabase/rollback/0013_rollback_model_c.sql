-- Rollback for 0013_model_c_and_atomic_rpcs.sql
-- Restores Model A customer_outstanding() and the original handover gate,
-- drops the 0013 RPC/aggregation layer. Run ONLY if 0013 must be reverted
-- AND the backend is rolled back to the pre-0013 revision (the rewired
-- backend calls these RPCs; without them it returns 503).

-- 1) Restore Model A outstanding (all non-cancelled booking totals).
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

-- 2) Restore the original gate (no booking-total additional charge).
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

-- 3) Drop the 0013 layer.
drop function if exists public.resolve_guest_customer(text, text, text);
drop function if exists public.handover_rental(uuid, uuid, timestamptz, timestamptz, text, text, text);
drop function if exists public.return_rental(uuid, timestamptz, integer, text, text, text);
drop function if exists public.settle_booking(uuid, text);
drop function if exists public.unsettle_booking(uuid, text);
drop function if exists public.admin_update_booking(uuid, text, text, text, boolean, text);
drop function if exists public.admin_update_customer(uuid, text, integer, text, text, boolean, text);
drop function if exists public.outstanding_by_customer();
drop function if exists public.customer_summaries();
drop function if exists public.revenue_stats();
drop function if exists public.customer_commitments(uuid);
drop function if exists public.make_ledger_ref();