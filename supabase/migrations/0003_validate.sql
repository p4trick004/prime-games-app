-- Prime Games — Phase 3: post-migration validation (READ-ONLY)
-- Target project: poaxanthiifatydqbnqq.supabase.co
-- Run AFTER 0001 + 0002 + the data import. Returns one row per check.
-- Every row should show pass = true. No data is modified by this script.
--
-- Expected source counts (verified read-only from the live Qoder database):
--   bookings 14, consoles 1, games 1, maintenance 1, transactions 0, incidents 0.

select check_name, actual, expected, (actual is not distinct from expected) as pass
from (
  -- Row counts -------------------------------------------------------------
  select 'consoles row count' as check_name, count(*)::text as actual, '1' as expected from public.consoles
  union all select 'games row count', count(*)::text, '1' from public.games
  union all select 'bookings row count', count(*)::text, '14' from public.bookings
  union all select 'maintenance row count', count(*)::text, '1' from public.maintenance
  union all select 'transactions row count', count(*)::text, '0' from public.transactions
  union all select 'incidents row count', count(*)::text, '0' from public.incidents

  -- Booking classification -------------------------------------------------
  union all select 'guest bookings (user_id null)', count(*)::text, '12' from public.bookings where user_id is null
  union all select 'member-linked bookings', count(*)::text, '2' from public.bookings where user_id is not null
  union all select 'cancelled bookings', count(*)::text, '12' from public.bookings where status = 'cancelled'
  union all select 'delivered bookings', count(*)::text, '1' from public.bookings where status = 'delivered'
  union all select 'pending bookings', count(*)::text, '1' from public.bookings where status = 'pending'
  union all select 'paid bookings', count(*)::text, '1' from public.bookings where payment_status = 'paid'

  -- Foreign-key integrity (orphan counts must be 0) ------------------------
  union all select 'orphan bookings.user_id', count(*)::text, '0'
    from public.bookings b where b.user_id is not null
      and not exists (select 1 from auth.users u where u.id = b.user_id)
  union all select 'orphan bookings.console_id', count(*)::text, '0'
    from public.bookings b where b.console_id is not null
      and not exists (select 1 from public.consoles c where c.id = b.console_id)
  union all select 'orphan maintenance.console_id', count(*)::text, '0'
    from public.maintenance m where not exists (select 1 from public.consoles c where c.id = m.console_id)
  union all select 'orphan transactions.booking_id', count(*)::text, '0'
    from public.transactions t where t.booking_id is not null
      and not exists (select 1 from public.bookings b where b.id = t.booking_id)
  union all select 'orphan incidents.booking_id', count(*)::text, '0'
    from public.incidents i where i.booking_id is not null
      and not exists (select 1 from public.bookings b where b.id = i.booking_id)
  union all select 'orphan incidents.console_id', count(*)::text, '0'
    from public.incidents i where i.console_id is not null
      and not exists (select 1 from public.consoles c where c.id = i.console_id)

  -- Uniqueness -------------------------------------------------------------
  union all select 'duplicate booking refs', count(*)::text, '0'
    from (select ref from public.bookings group by ref having count(*) > 1) d
  union all select 'duplicate console unit_codes', count(*)::text, '0'
    from (select unit_code from public.consoles group by unit_code having count(*) > 1) d

  -- Member links preserved: 2 bookings linked to 2 distinct, existing auth users.
  -- (Orphan-free FK + count above prove the links are intact without embedding ids.)
  union all select 'distinct linked member users', count(distinct user_id)::text, '2'
    from public.bookings where user_id is not null

  -- Test booking PG-PN4HWR preserved and classified ------------------------
  union all select 'PG-PN4HWR present', count(*)::text, '1' from public.bookings where ref = 'PG-PN4HWR'
  union all select 'PG-PN4HWR status',
    (select status from public.bookings where ref = 'PG-PN4HWR'), 'cancelled'

  -- Referential spot check: maintenance row links to the PM-PS5 console ----
  union all select 'maintenance links to PM-PS5', count(*)::text, '1'
    from public.maintenance m join public.consoles c on c.id = m.console_id
    where c.unit_code = 'PM-PS5'

  -- RLS posture ------------------------------------------------------------
  union all select 'business tables with RLS enabled', count(*)::text, '6'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relrowsecurity
      and c.relname in ('consoles','games','bookings','maintenance','transactions','incidents')
  union all select 'business-table policies (must be 0)', count(*)::text, '0'
    from pg_policies where schemaname = 'public'
      and tablename in ('consoles','games','bookings','maintenance','transactions','incidents')
  union all select 'profiles RLS enabled', count(*)::text, '1'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'profiles' and c.relrowsecurity
  union all select 'profiles own-row policies', count(*)::text, '2'
    from pg_policies where schemaname = 'public' and tablename = 'profiles'
) checks
order by check_name;