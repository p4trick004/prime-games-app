-- Prime Games — Phase 3 (customer-centred): 0003 inventory (consoles, games)
-- Target: poaxanthiifatydqbnqq.supabase.co (public). Idempotent + reversible.
-- Depends on: 0001_helpers.sql.
--
-- "Avoid duplicated/derived fields": consoles.current_renter and rentals_count
-- from the legacy schema are REMOVED. The current renter is derived from the
-- active rental joined to customers; the rental count is derived from rentals.
-- Column names/enums otherwise match functions/handler.mjs so the Phase 4
-- backend can reconstruct the existing admin API response shape via joins.
-- console.model stays free-text (the admin UI uses a text input, not an enum).

-- 1) consoles — PS5 fleet ---------------------------------------------------
create table if not exists public.consoles (
  id              uuid primary key default gen_random_uuid(),
  unit_code       text not null,
  model           text not null,
  serial_number   text,
  status          text not null default 'available',
  condition_grade text not null default 'good',
  purchased_at    timestamptz,
  last_audit_at   timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint consoles_unit_code_key unique (unit_code),
  constraint consoles_serial_number_key unique (serial_number),
  constraint consoles_unit_code_check check (unit_code ~ '^[A-Za-z0-9][A-Za-z0-9\- ]{1,31}$'),
  constraint consoles_model_check check (char_length(model) between 2 and 64),
  constraint consoles_status_check
    check (status in ('available', 'rented', 'maintenance', 'retired')),
  constraint consoles_condition_grade_check
    check (condition_grade in ('excellent', 'good', 'fair', 'poor'))
);

create index if not exists consoles_status_idx on public.consoles (status);

drop trigger if exists consoles_set_updated_at on public.consoles;
create trigger consoles_set_updated_at
  before update on public.consoles
  for each row execute function public.set_updated_at();

-- 2) games — catalog --------------------------------------------------------
create table if not exists public.games (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  platform     text not null,
  genre        text,
  media_format text,
  cover_url    text,
  status       text not null default 'available',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint games_title_check check (char_length(title) between 1 and 120),
  constraint games_platform_check check (platform in ('ps5', 'ps4')),
  constraint games_media_format_check check (media_format in ('disc', 'digital')),
  constraint games_status_check check (status in ('available', 'rented', 'retired')),
  constraint games_cover_url_check check (cover_url is null or cover_url ~* '^https?://[^[:space:]]+$')
);

create index if not exists games_platform_idx on public.games (platform);
create index if not exists games_status_idx   on public.games (status);
create index if not exists games_title_idx    on public.games (title);

drop trigger if exists games_set_updated_at on public.games;
create trigger games_set_updated_at
  before update on public.games
  for each row execute function public.set_updated_at();