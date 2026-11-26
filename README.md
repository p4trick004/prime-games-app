# Prime Games — PS5 Rental Management

Private production application for **Prime Games** (Dar es Salaam): PS5 console
rentals with a public booking landing page, a customer account portal, and an
admin operations console.

> **Status:** production runs on **Vercel + Supabase** (https://prime-games-portal.vercel.app).
> Phases 1–6 complete. The legacy Qoder Sites deployment and its backend are
> retired; the code for them has been removed from this repo. See
> [Migration roadmap](#migration-roadmap).

## Architecture (current)

- **Landing page** — vanilla HTML/CSS/JS (`web/`), EN/SW i18n, public booking form.
- **Customer + Admin portal** — React 18 + TypeScript + Vite SPA (`portal/`),
  HashRouter. On Vercel it builds with base `/portal/` into `web/portal/`; for
  local/harness work it builds with base `/app/` into `web/app/`.
- **Backend** — Supabase Edge Function `app`
  (`supabase/functions/app/`), called as
  `https://<project>.supabase.co/functions/v1/app?action=<name>`; server-side
  pricing and validation (client money values are never trusted).
- **Data** — one Supabase project: Postgres (schema + RLS), Auth, Storage (private
  KYC bucket). `web/site-config.js` points the browser at the Supabase function
  on Vercel and keeps same-origin paths for local harnesses.

## Repository layout

```
.
├── portal/                 # React + TS + Vite customer/admin SPA
│   ├── src/                # Components, pages, lib, config
│   ├── vite.config.ts      # base /app/ -> ../web/app (override for Vercel)
│   └── .env.example        # Public frontend env template
├── supabase/
│   ├── functions/app/      # Production Edge Function (handler + libs)
│   ├── migrations/         # Phase 3 schema + 0013 Model C
│   └── validation/         # 0011 structure + 0012 scenario tests
├── dev/                    # Local harnesses, test suite, TOTP enrollment
├── web/                    # Static landing + built portal
│   ├── index.html          # Landing (source)
│   ├── aliases/            # /book, /admin, /admin/login route aliases (Vercel rewrites)
│   ├── site-config.js      # Host-aware portal/API wiring
│   ├── app/                # Local portal build (gitignored)
│   └── portal/             # Vercel portal build (gitignored)
├── .gitignore
└── README.md
```

Local-only design references (`dev/figma/`, `vibe_images/`) are intentionally
**not tracked** and remain on the development machine.

## Prerequisites

- Node.js 18+ (developed on Node 24)
- npm

## Local development

Run the backend + landing harness (no external services required):

```bash
node dev/edge-server.mjs 4174
```

This serves `web/` at `http://127.0.0.1:4174` and the API at
`/functions/v1/app`, running the real Supabase handler against an **empty
in-memory fixture database**. Fixture admin password: `local-test-admin`
(local only). Pass `ADMIN_PASSWORD` / `ADMIN_TOTP_SECRET` in the environment to
exercise other credentials.

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
npm run build          # local/harness layout: tsc --noEmit, vite base /app/ -> web/app/
npm run build:vercel   # production layout: vite base /portal/ -> web/portal/
```

Vercel project settings (dashboard, since the project predates a `vercel.json`):
build command `cd portal && npm ci && npm run build:vercel`, output directory
`web`, and env `VITE_API_BASE=https://poaxanthiifatydqbnqq.supabase.co/functions/v1/app`.
Routes `/book`, `/admin`, `/admin/login` are rewritten to `web/aliases/*.html`
(see the aliases in the layout above).

## Environment variables

**Frontend** (`portal/.env`, copy from `portal/.env.example`):

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Public Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Public publishable/anon key (public by design; RLS enforces access) |
| `VITE_API_BASE` | Absolute Edge Function URL on Vercel; relative for local harness |

These are baked into the client build. **Never** put a `service_role` key in
frontend env.

**Backend** (Supabase Edge Function secrets, never committed):

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Admin operations password (HMAC key for admin tokens) |
| `ADMIN_TOTP_SECRET` | Base32 TOTP secret for admin recovery (optional) |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key, server-side only |
| `CORS_ORIGINS` | Comma-separated browser origin allowlist (fail-closed) |

## Security

- No secrets are committed. `portal/.env` is gitignored; `portal/.env.example`
  holds public publishable values only.
- Customer PII (bookings, ID numbers) lives in the database, never in this repo.
- The dev harness uses empty fixture tables and a local-only password.

## Admin password & recovery

The admin password is an edge-function secret — never in the repo or the browser:

```bash
supabase secrets set ADMIN_PASSWORD='<new-password>'
```

Rotating it invalidates every issued admin token, because tokens are HMAC'd with
it (`x-admin-token`, 12 h TTL).

Password recovery uses a TOTP code from an authenticator app. Enroll once:

```bash
node dev/totp-enroll.mjs
# scan the printed otpauth:// URI into Google Authenticator / Authy / 1Password
supabase secrets set ADMIN_TOTP_SECRET=<printed base32 secret>
```

With `ADMIN_TOTP_SECRET` unset, `admin_recover` fails closed
(`503 recovery_not_configured`). Treat the authenticator entry as a second
credential: anyone with a current code can sign in. Both `admin_login` and
`admin_recover` are throttled per client IP (best effort, per warm instance).

For local development pass the same values to the harness:

```bash
ADMIN_PASSWORD='<new-password>' ADMIN_TOTP_SECRET=<secret> node dev/edge-server.mjs
node dev/totp-enroll.mjs --code <secret>   # current code, for manual testing
```

## Migration roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Repository & infrastructure audit | Complete |
| 2 | GitHub source control & repository hygiene | Complete |
| 3 | Supabase database consolidation | Complete |
| 4 | Backend → Supabase Edge Functions | Complete |
| 5 | Frontend integration & Vercel preparation | Complete |
| 6 | Production cutover & validation | Complete |
| 7 | Optional post-migration improvements | Pending (separate approval) |

## Ownership

Private / proprietary. © Prime Games. All rights reserved.