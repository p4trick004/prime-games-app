-- Prime Games — Phase 3 (customer-centred): 0010 Row Level Security
-- Target: poaxanthiifatydqbnqq.supabase.co (public). Idempotent + reversible.
-- Depends on: 0001..0008 (all tables + current_customer_id()).
--
-- Security model:
--   * anon            -> NO direct access to any business table (guests use the
--                        backend, which runs as service_role).
--   * authenticated   -> read-only SELECT of their OWN rows on customer-facing
--                        tables (customers, bookings, booking_games, rentals,
--                        payments, incidents, kyc_documents). No writes.
--   * service_role    -> full access, BYPASSES RLS. Used ONLY by the backend.
--                        Admin actions are authorized in the backend via the
--                        ADMIN_PASSWORD HMAC token (requireAdmin), NOT by DB
--                        role. The service_role key is NEVER sent to the browser.
--   * Operational/audit tables (consoles, games, maintenance, customer_links,
--     customer_contact_history, customer_credit_events, kyc_audit) are
--     service-role only.
--
-- current_customer_id() is SECURITY DEFINER, so own-row checks on child tables
-- do not recursively trip customers' RLS. The customers policy uses auth.uid()
-- directly to avoid self-reference.

-- 1) Enable RLS on every business table -------------------------------------
alter table public.customers                enable row level security;
alter table public.customer_links           enable row level security;
alter table public.customer_contact_history enable row level security;
alter table public.customer_credit_events   enable row level security;
alter table public.bookings                 enable row level security;
alter table public.booking_games            enable row level security;
alter table public.rentals                  enable row level security;
alter table public.payments                 enable row level security;
alter table public.consoles                 enable row level security;
alter table public.games                    enable row level security;
alter table public.maintenance              enable row level security;
alter table public.incidents                enable row level security;
alter table public.kyc_documents            enable row level security;
alter table public.kyc_audit                enable row level security;

-- 2) Clean-slate grants: deny anon + authenticated by default ----------------
revoke all on public.customers                from anon, authenticated;
revoke all on public.customer_links           from anon, authenticated;
revoke all on public.customer_contact_history from anon, authenticated;
revoke all on public.customer_credit_events   from anon, authenticated;
revoke all on public.bookings                 from anon, authenticated;
revoke all on public.booking_games            from anon, authenticated;
revoke all on public.rentals                  from anon, authenticated;
revoke all on public.payments                 from anon, authenticated;
revoke all on public.consoles                 from anon, authenticated;
revoke all on public.games                    from anon, authenticated;
revoke all on public.maintenance              from anon, authenticated;
revoke all on public.incidents                from anon, authenticated;
revoke all on public.kyc_documents            from anon, authenticated;
revoke all on public.kyc_audit                from anon, authenticated;

-- 3) Backend (service_role) keeps full access --------------------------------
grant all on public.customers                to service_role;
grant all on public.customer_links           to service_role;
grant all on public.customer_contact_history to service_role;
grant all on public.customer_credit_events   to service_role;
grant all on public.bookings                 to service_role;
grant all on public.booking_games            to service_role;
grant all on public.rentals                  to service_role;
grant all on public.payments                 to service_role;
grant all on public.consoles                 to service_role;
grant all on public.games                    to service_role;
grant all on public.maintenance              to service_role;
grant all on public.incidents                to service_role;
grant all on public.kyc_documents            to service_role;
grant all on public.kyc_audit                to service_role;

-- 4) Customers may READ their own rows (read-only) ---------------------------
grant select on public.customers     to authenticated;
grant select on public.bookings      to authenticated;
grant select on public.booking_games to authenticated;
grant select on public.rentals       to authenticated;
grant select on public.payments      to authenticated;
grant select on public.incidents     to authenticated;
grant select on public.kyc_documents to authenticated;

-- 5) Own-row SELECT policies -------------------------------------------------
drop policy if exists customers_select_own on public.customers;
create policy customers_select_own on public.customers
  for select to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists bookings_select_own on public.bookings;
create policy bookings_select_own on public.bookings
  for select to authenticated
  using (customer_id = public.current_customer_id());

drop policy if exists booking_games_select_own on public.booking_games;
create policy booking_games_select_own on public.booking_games
  for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_games.booking_id
        and b.customer_id = public.current_customer_id()
    )
  );

drop policy if exists rentals_select_own on public.rentals;
create policy rentals_select_own on public.rentals
  for select to authenticated
  using (customer_id = public.current_customer_id());

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments
  for select to authenticated
  using (customer_id = public.current_customer_id());

drop policy if exists incidents_select_own on public.incidents;
create policy incidents_select_own on public.incidents
  for select to authenticated
  using (customer_id = public.current_customer_id());

drop policy if exists kyc_documents_select_own on public.kyc_documents;
create policy kyc_documents_select_own on public.kyc_documents
  for select to authenticated
  using (customer_id = public.current_customer_id());

-- No INSERT/UPDATE/DELETE policies exist for authenticated or anon on any
-- business table: all customer/guest writes go through the backend (service_role),
-- which self-authorizes admin operations. payments additionally blocks UPDATE/
-- DELETE for EVERY role via the append-only trigger (0006).