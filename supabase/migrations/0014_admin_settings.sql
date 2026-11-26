-- Prime Games — 0014 admin security settings (authenticator enrollment)
-- Target: poaxanthiifatydqbnqq.supabase.co (public). Idempotent.
-- Depends on: 0010_rls.sql (service-role-only table conventions).
--
-- The admin authenticator (TOTP) secret is a server-side credential:
--   * only the backend (service_role) reads/writes this table;
--   * anon/authenticated have no grants and no policies exist;
--   * the secret is never printed by any API — admin_totp_status reports
--     only whether enrollment is active, admin_totp_setup returns the
--     pending secret once so the admin can scan it.
--
-- Password recovery (admin_recover) fails closed until an admin completes
-- enrollment at Admin → Security, which sets totp_secret + totp_activated_at.

create table if not exists public.admin_settings (
  id                     text primary key,
  totp_secret            text,
  totp_pending_secret    text,
  totp_pending_issued_at timestamptz,
  totp_activated_at      timestamptz,
  updated_at             timestamptz not null default now()
);

alter table public.admin_settings enable row level security;

revoke all on public.admin_settings from anon, authenticated;
grant all on public.admin_settings to service_role;

comment on table public.admin_settings is
  'Server-only admin security settings: authenticator (TOTP) secret for password recovery.';
