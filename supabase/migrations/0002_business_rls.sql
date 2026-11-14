-- Prime Games — Phase 3: strict Row Level Security for business tables
-- Target project: poaxanthiifatydqbnqq.supabase.co  (schema: public)
-- Run AFTER 0001_business_schema.sql. Idempotent (safe to re-run).
--
-- Security model
-- --------------
-- Every frontend (landing page, customer portal, admin panel) reads and writes
-- business data exclusively through the backend (/functions/v1/app). The portal
-- uses the anon/publishable key directly ONLY for auth and its own profiles row.
-- Verified: no frontend calls supabase.from('<business table>') directly.
--
-- Therefore the six business tables are locked to service_role only:
--   * RLS is ENABLED on each table;
--   * NO permissive policies are granted to anon or authenticated, so direct
--     access with the publishable/anon key returns zero rows (SELECT) or is
--     rejected (INSERT/UPDATE/DELETE) — default-deny;
--   * the backend connects with the service_role key, which has BYPASSRLS and
--     is unaffected by these policies (wired in Phase 4).
--
-- This contains customer PII (names, phones, NIDA numbers, addresses). Denying
-- direct client access is intentional and required. Do NOT add anon policies.
--
-- profiles RLS (own-row select/update) is managed separately in supabase/profiles.sql
-- and is left unchanged here.

alter table public.consoles     enable row level security;
alter table public.games        enable row level security;
alter table public.bookings     enable row level security;
alter table public.maintenance  enable row level security;
alter table public.transactions enable row level security;
alter table public.incidents    enable row level security;

-- Defensive clean slate: remove any stray policies on these tables so the
-- default-deny posture is guaranteed even if a policy was added out of band.
-- (No policies are expected on freshly created tables; this is a no-op then.)
do $$
declare
  p record;
begin
  for p in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('consoles', 'games', 'bookings', 'maintenance', 'transactions', 'incidents')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- No CREATE POLICY statements: anon/authenticated have no direct access.
-- service_role bypasses RLS. See 0003_validate.sql to confirm the posture.