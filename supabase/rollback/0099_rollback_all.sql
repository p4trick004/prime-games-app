-- Prime Games — Phase 3: ROLLBACK (reverse of 0001..0010)
-- Target: poaxanthiifatydqbnqq.supabase.co
--
-- *** DESTRUCTIVE: drops the Phase 3 business schema. ***
-- Run ONLY to undo Phase 3. It does NOT touch auth.users, public.profiles,
-- public.handle_new_user(), or the original Qoder database. Because Phase 3
-- starts EMPTY, rolling back loses no business data. If you have since added
-- real data, export it first.
--
-- Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Idempotent (IF EXISTS). Reverse dependency order.

-- 1) Storage: policies, objects, bucket -------------------------------------
drop policy if exists kyc_private_select_own on storage.objects;
drop policy if exists kyc_private_insert_own on storage.objects;
delete from storage.objects where bucket_id = 'kyc-private';
delete from storage.buckets where id = 'kyc-private';

-- 2) Business tables (reverse FK order). CASCADE removes their triggers/policies.
drop table if exists public.kyc_audit                cascade;
drop table if exists public.kyc_documents            cascade;
drop table if exists public.incidents                cascade;
drop table if exists public.maintenance              cascade;
drop table if exists public.payments                 cascade;
drop table if exists public.rentals                  cascade;
drop table if exists public.booking_games            cascade;
drop table if exists public.bookings                 cascade;
drop table if exists public.games                    cascade;
drop table if exists public.consoles                 cascade;
drop table if exists public.customer_credit_events   cascade;
drop table if exists public.customer_contact_history cascade;
drop table if exists public.customer_links           cascade;
drop table if exists public.customers                cascade;

-- 3) Helper functions (CASCADE removes any remaining dependent objects) ------
drop function if exists public.link_customer_auth(uuid, uuid, text, text) cascade;
drop function if exists public.rentals_enforce_credit() cascade;
drop function if exists public.log_customer_credit_change() cascade;
drop function if exists public.log_customer_contact_change() cascade;
drop function if exists public.assert_credit_available(uuid, integer) cascade;
drop function if exists public.customer_outstanding(uuid) cascade;
drop function if exists public.current_customer_id() cascade;
drop function if exists public.deny_mutation() cascade;
drop function if exists public.set_updated_at() cascade;

-- NOTE: public.profiles, its policies, and public.handle_new_user() are
-- intentionally NOT dropped. auth.users is never modified.