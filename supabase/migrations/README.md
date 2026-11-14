# Prime Games — Supabase business migrations (Phase 3)

Reproducible SQL that consolidates the six business tables into the target Supabase
project, with foreign keys, constraints, indexes and strict Row Level Security.

- **Target project:** `poaxanthiifatydqbnqq.supabase.co`
- **Schema:** `public`
- **Prerequisite:** [`../profiles.sql`](../profiles.sql) already applied (auth + profiles).
- **Source of truth:** the live Qoder-managed database, read **read-only**. These
  migrations never modify the original database.

## Files

| Order | File | Purpose | Contains PII? |
|------|------|---------|---------------|
| 1 | `0001_business_schema.sql` | Create the 6 tables, defaults, named FKs, CHECK constraints, indexes | No |
| 2 | `0002_business_rls.sql` | Enable RLS; default-deny for anon/authenticated (service_role only) | No |
| 3 | *data import* | Insert the exported production rows (provided separately) | **Yes — not in git** |
| 4 | `0003_validate.sql` | Read-only report: counts, FK integrity, uniqueness, RLS posture | No |

All SQL files are idempotent (`create ... if not exists`, `drop policy if exists`,
`on conflict (id) do nothing`) and safe to re-run.

## How to apply

The Supabase MCP connector is unavailable in this environment (returns `-32603`)
and no `service_role` key is exposed to the agent, so apply via the Dashboard:

**Supabase Dashboard → SQL Editor → New query → paste → Run**, in this order:

1. `0001_business_schema.sql`
2. `0002_business_rls.sql`
3. the **data import** file (see below)
4. `0003_validate.sql` — every row must show `pass = true`

### Data import (PII — handled outside git)

The production export contains customer names, phones, NIDA numbers and addresses.
It is **never committed**. It is generated into a local temp folder:

```
C:/Users/samwe/AppData/Local/Temp/prime-games-migration/
  source-data.json   read-only export of the live tables (PII)
  build-import.mjs   generator + local validation (enums, counts, FKs, uniqueness)
  import.sql         generated INSERTs (PII) — paste this into SQL Editor as step 3
```

Regenerate with `node build-import.mjs` from that folder. The import is:

- **Atomic** — wrapped in `begin; … commit;`; any failure rolls back everything.
- **Idempotent** — `on conflict (id) do nothing`.
- **Guarded** — a pre-flight `do` block aborts if any linked booking `user_id`
  is absent from `auth.users`, so member links can never dangle.
- **Faithful** — preserves original `id`, `ref`, `created_at`/`opened_at`/`occurred_at`,
  guest bookings (`user_id null`), member links, and the cancelled test booking
  `PG-PN4HWR`.

## Security model (strict RLS)

Every frontend (landing page, customer portal, admin panel) accesses business data
**only through the backend** (`/functions/v1/app`). The portal uses the anon key
directly only for auth and its own `profiles` row. Therefore:

- The six business tables have **RLS enabled and no anon/authenticated policies**
  → direct access with the publishable/anon key returns zero rows (SELECT) or is
  rejected (writes). This is default-deny and intentional (PII protection).
- The backend must connect with the **`service_role` key** (BYPASSRLS). Wiring that
  is **Phase 4**; until cutover the live app keeps using the original Qoder database.
- `profiles` keeps its own-row select/update policies from `profiles.sql`.

Do **not** add anon policies to business tables.

## Expected data (verified read-only from source)

| Table | Rows |
|-------|------|
| bookings | 14 (12 guest, 2 member-linked; 12 cancelled, 1 delivered+paid, 1 pending) |
| consoles | 1 (`PM-PS5`) |
| games | 1 (`EA FC 27`) |
| maintenance | 1 (resolved, linked to `PM-PS5`) |
| transactions | 0 |
| incidents | 0 |

`0003_validate.sql` checks these counts, orphan-free foreign keys, unique refs,
the two preserved member links, the cancelled `PG-PN4HWR` test booking, and the
RLS posture (6 tables RLS-enabled, 0 business-table policies, profiles unchanged).

## Validation after apply

1. Run `0003_validate.sql` in SQL Editor → all `pass = true`.
2. With the **anon/publishable key**, a REST `SELECT` on `public.bookings` must
   return `[]` even though 14 rows exist — proving RLS denies direct client reads.