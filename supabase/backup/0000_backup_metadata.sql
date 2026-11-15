-- Prime Games — Phase 3: PRE-MIGRATION METADATA BACKUP (READ-ONLY)
-- Target project: poaxanthiifatydqbnqq.supabase.co
--
-- RUN THIS FIRST, before applying any 0001..0010 migration.
-- Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It only SELECTs catalog metadata; it changes nothing.
-- Save each result grid (CSV / copy) into supabase/backup/ as the pre-migration
-- snapshot. This is the "back up relevant target metadata" step.
--
-- Expected at capture time: public schema contains ONLY 'profiles'
-- (plus system schemas auth/storage/realtime/extensions). All 14 Phase 3
-- business tables should be ABSENT. If any business table already exists,
-- STOP and request approval (unexpected schema conflict).

-- 1) Existing public tables -------------------------------------------------
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

-- 2) Existing public columns (full structure snapshot) ----------------------
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- 3) Existing constraints (PK / FK / CHECK / UNIQUE) ------------------------
select
  conrelid::regclass as table_name,
  conname as constraint_name,
  contype as constraint_type,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
order by conrelid::regclass::text, conname;

-- 4) Existing indexes -------------------------------------------------------
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

-- 5) Existing RLS policies --------------------------------------------------
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 6) RLS enabled flags ------------------------------------------------------
select relname as table_name, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relname;

-- 7) Existing triggers ------------------------------------------------------
select
  event_object_table as table_name,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name;

-- 8) Existing public functions ---------------------------------------------
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as returns,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;

-- 9) Existing Storage buckets (confirm kyc-private absent) ------------------
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;

-- 10) profiles row count (metadata only; no PII selected) -------------------
-- Confirms profiles is populated and untouched. Does NOT read personal data.
select count(*) as profiles_row_count from public.profiles;