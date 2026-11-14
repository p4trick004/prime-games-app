# Prime Games — PS5 Rental Management

Private production application for **Prime Games** (Dar es Salaam): PS5 console
rentals with a public booking landing page, a customer account portal, and an
admin operations console.

> **Status:** infrastructure migration in progress. Phase 1 (audit) and Phase 2
> (GitHub source control & hygiene) are complete. Production currently still runs
> on Qoder Sites; the target architecture is **GitHub + Vercel + Supabase**.
> See [Migration roadmap](#migration-roadmap). No application behavior was changed
> during source-control onboarding.

## Architecture (current)

- **Landing page** — vanilla HTML/CSS/JS (`web/`), EN/SW i18n, public booking form.
- **Customer + Admin portal** — React 18 + TypeScript + Vite SPA (`portal/`),
  HashRouter, built to `web/app/` and served under `/app/`.
- **Backend** — a single Deno edge function (`functions/`) exposing
  `/functions/v1/app?action=<name>` with 22 actions; server-side pricing and
  validation (client money values are never trusted).
- **Data** — currently two stores: a Qoder-managed Postgres (6 business tables)
  reached through a Supabase-REST gateway, and a public Supabase project
  (customer Auth + `profiles`). Phase 3 consolidates these into one Supabase
  project.

## Repository layout

```
.
├── functions/              # Deno edge function (backend)
│   ├── adapter.mjs         # Qoder DB routing (replaced in Phase 4)
│   ├── handler.mjs         # Business logic + 22 API actions
│   └── index.ts            # Entry point
├── portal/                 # React + TS + Vite customer/admin SPA
│   ├── src/                # Components, pages, lib, config
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts      # base /app/, build -> ../web/app
│   └── .env.example        # Public frontend env template
├── supabase/
│   └── profiles.sql        # Profiles DDL + RLS (public Supabase)
├── dev/
│   └── local-server.mjs    # Local dev harness (in-memory fixture DB)
├── web/                    # Static landing + built portal
│   ├── index.html          # Landing (source)
│   ├── app.js / styles.css
│   ├── admin.html / admin.js   # Legacy admin (removed in Phase 7)
│   ├── assets/             # Runtime images (logo, hero, game covers)
│   └── app/                # Portal build output (gitignored)
├── .gitignore
└── README.md
```

Local-only design references (`dev/figma/`, `vibe_images/`) and the Qoder Sites
descriptor (`*.qoder.site`) are intentionally **not tracked**; they remain on disk
for the Qoder development environment.

## Prerequisites

- Node.js 18+ (developed on Node 24)
- npm

## Local development

Run the backend + landing harness (no external services required):

```bash
node dev/local-server.mjs 4174
```

This serves `web/` at `http://127.0.0.1:4174` and the API at
`/functions/v1/app`, running the real handler against an **empty in-memory
fixture database**. Fixture admin password: `local-test-admin` (local only).

For React hot reload, run the portal dev server in a second terminal:

```bash
cd portal
npm install
npm run dev          # http://127.0.0.1:4175, proxies /functions -> 127.0.0.1:4174
```

## Build

```bash
cd portal
npm install
npm run build        # tsc --noEmit, then vite build -> web/app/ (base /app/)
```

## Environment variables

**Frontend** (`portal/.env`, copy from `portal/.env.example`):

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Public Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Public publishable/anon key (public by design; RLS enforces access) |

These are baked into the client build. **Never** put a `service_role` key in
frontend env.

**Backend** (runtime secrets, never committed):

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Admin operations password |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Data gateway credentials (current Qoder runtime) |

On Supabase Edge Functions these become function secrets; the backend will use a
`service_role` key **server-side only**.

## Security

- No secrets are committed. `portal/.env` is gitignored; `portal/.env.example`
  holds public publishable values only.
- Customer PII (bookings, ID numbers) lives in the database, never in this repo.
- The dev harness uses empty fixture tables and a local-only password.

## Migration roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Repository & infrastructure audit | Complete |
| 2 | GitHub source control & repository hygiene | Complete |
| 3 | Supabase database consolidation | Pending |
| 4 | Backend → Supabase Edge Functions | Pending |
| 5 | Frontend integration & Vercel preparation | Pending |
| 6 | Production cutover & validation | Pending |
| 7 | Optional post-migration improvements | Pending (separate approval) |

## Ownership

Private / proprietary. © Prime Games. All rights reserved.