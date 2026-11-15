-- Prime Games — Phase 3: 0011 STRUCTURAL VALIDATION (READ-ONLY)
-- Target: poaxanthiifatydqbnqq.supabase.co
-- Run AFTER applying 0001..0010. Supabase Dashboard -> SQL Editor -> Run.
-- Changes nothing. Every row in Section A must read PASS; every count in
-- Section B must be 0 (the business schema starts EMPTY).

-- ===== Section A: catalog assertions ======================================
select check_name, case when ok then 'PASS' else 'FAIL' end as status
from (
  -- 1) all 14 business tables exist
  select 'table:' || t as check_name,
         exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = t) as ok
  from unnest(array[
    'customers','customer_links','customer_contact_history','customer_credit_events',
    'bookings','booking_games','rentals','payments','consoles','games',
    'maintenance','incidents','kyc_documents','kyc_audit']) as t

  union all
  -- 2) RLS enabled on all 14
  select 'rls:' || c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in (
    'customers','customer_links','customer_contact_history','customer_credit_events',
    'bookings','booking_games','rentals','payments','consoles','games',
    'maintenance','incidents','kyc_documents','kyc_audit')

  union all
  -- 3) customer own-row SELECT policies
  select 'policy:' || p,
         exists (select 1 from pg_policies where schemaname = 'public' and policyname = p)
  from unnest(array[
    'customers_select_own','bookings_select_own','booking_games_select_own',
    'rentals_select_own','payments_select_own','incidents_select_own',
    'kyc_documents_select_own']) as p

  union all
  -- 4) helper / trigger functions
  select 'function:' || f,
         exists (select 1 from pg_proc pr join pg_namespace nn on nn.oid = pr.pronamespace
                  where nn.nspname = 'public' and pr.proname = f)
  from unnest(array[
    'set_updated_at','deny_mutation','current_customer_id','customer_outstanding',
    'assert_credit_available','log_customer_contact_change','log_customer_credit_change',
    'link_customer_auth','rentals_enforce_credit']) as f

  union all
  -- 5) triggers
  select 'trigger:' || tg,
         exists (select 1 from information_schema.triggers
                  where trigger_schema = 'public' and trigger_name = tg)
  from unnest(array[
    'customers_set_updated_at','customers_log_contact_change','customers_log_credit_change',
    'consoles_set_updated_at','games_set_updated_at','bookings_set_updated_at',
    'rentals_set_updated_at','rentals_enforce_credit','payments_append_only',
    'maintenance_set_updated_at','incidents_set_updated_at','kyc_documents_set_updated_at']) as tg

  union all
  -- 6) critical partial / unique indexes
  select 'index:' || ix,
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = ix)
  from unnest(array[
    'rentals_one_active_console','customers_phone_verified_key','customers_email_verified_key']) as ix

  union all
  -- 7) critical CHECK constraints
  select 'constraint:' || cn,
         exists (select 1 from pg_constraint
                  where connamespace = 'public'::regnamespace and conname = cn)
  from unnest(array[
    'customers_nonpremium_no_credit','payments_refund_sign_check','payments_receipt_sign_check',
    'bookings_total_consistency_check','rentals_active_console_check',
    'kyc_documents_storage_path_check']) as cn

  union all
  -- 8) private Storage bucket + limits + policies
  select 'storage:kyc_private_exists', exists (select 1 from storage.buckets where id = 'kyc-private')
  union all
  select 'storage:kyc_private_is_private', (select not public from storage.buckets where id = 'kyc-private')
  union all
  select 'storage:kyc_private_size_limit', (select file_size_limit = 5242880 from storage.buckets where id = 'kyc-private')
  union all
  select 'storage:kyc_private_mime_types',
         (select allowed_mime_types @> array['image/jpeg','image/png','application/pdf']
            from storage.buckets where id = 'kyc-private')
  union all
  select 'storage:policy_select_own',
         exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'kyc_private_select_own')
  union all
  select 'storage:policy_insert_own',
         exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'kyc_private_insert_own')

  union all
  -- 9) profiles + auth preserved UNCHANGED
  select 'profiles:column_count_12',
         (select count(*) = 12 from information_schema.columns
           where table_schema = 'public' and table_name = 'profiles')
  union all
  select 'profiles:rls_enabled',
         (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass)
  union all
  select 'profiles:select_own_policy',
         exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
                   and policyname = 'profiles_select_own')
  union all
  select 'auth:handle_new_user_trigger',
         exists (select 1 from information_schema.triggers where trigger_name = 'on_auth_user_created')
) checks
order by check_name;

-- ===== Section B: empty-start row counts (ALL must be 0) ===================
select
  (select count(*) from public.customers)                as customers,
  (select count(*) from public.customer_links)           as customer_links,
  (select count(*) from public.customer_contact_history) as contact_history,
  (select count(*) from public.customer_credit_events)   as credit_events,
  (select count(*) from public.bookings)                 as bookings,
  (select count(*) from public.booking_games)            as booking_games,
  (select count(*) from public.rentals)                  as rentals,
  (select count(*) from public.payments)                 as payments,
  (select count(*) from public.consoles)                 as consoles,
  (select count(*) from public.games)                    as games,
  (select count(*) from public.maintenance)              as maintenance,
  (select count(*) from public.incidents)                as incidents,
  (select count(*) from public.kyc_documents)            as kyc_documents,
  (select count(*) from public.kyc_audit)                as kyc_audit;

-- ===== Section C: anon must be denied (run separately, optional) ===========
-- With the anon key, a direct GET /rest/v1/bookings returns [] (RLS) — verified
-- out-of-band by the agent. No anon SELECT/INSERT/UPDATE/DELETE is permitted on
-- any business table. service_role (backend only) bypasses RLS.