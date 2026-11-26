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
│   ├── aliases/            # /book, /admin, /admin/login, /reset-password (Vercel rewrites)
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
(local only). Pass `ADMIN_PASSWORD` in the environment to exercise another
credential; authenticator enrollment happens in the console (Admin → Security).

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
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key, server-side only |
| `CORS_ORIGINS` | Comma-separated browser origin allowlist (fail-closed) |

The authenticator secret is **not** an environment variable: it is enrolled from
the admin console and stored in `public.admin_settings` (migration 0014,
service_role only).

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

Password recovery uses a code from an authenticator app. The app is connected
from the admin console, never from a shared secret in the repo or environment:

1. Sign in at `/admin/login` with the admin password.
2. Open **Admin → Security** and choose *Set up authenticator*.
3. Scan the QR code (or type the displayed key) into Google Authenticator /
   Authy / 1Password.
4. Enter the current 6-digit code to activate it.

Until enrollment is verified, `admin_recover` fails closed
(`503 recovery_not_configured`) and the login screen says no authenticator is
connected. The secret is stored server-side in `admin_settings`
(service_role-only; migration 0014) and is never returned to the browser after
setup. *Replace authenticator* keeps the old app working until the new one
verifies. Treat the authenticator entry as a second credential: anyone with a
current code can sign in. `admin_login`, `admin_recover`, and
`admin_totp_verify` are throttled per client IP (best effort, per warm instance).

If both the password and the authenticator are lost, rotate
`ADMIN_PASSWORD` with `supabase secrets set`.

Locally, the same enrollment works against the in-memory fixture:

```bash
ADMIN_PASSWORD='<new-password>' node dev/edge-server.mjs
# sign in, then Admin → Security → Set up authenticator
```

## Customer password reset

Customers reset their own password from the portal sign-in screen
(**Forgot password?** → email → link). Requesting a link never reveals whether
an account exists; only throttling errors are surfaced. The emailed Supabase
recovery link lands on `/reset-password`, a static hand-off page
(`web/aliases/reset-password.html`) that moves the session tokens out of the
URL fragment into `sessionStorage` and opens the SPA route `#/reset-password`,
where the customer picks a new password (the session is then signed out).

Supabase Auth must allow that URL, or the email link falls back to the Site URL
and cannot complete. In **Authentication → URL Configuration**: set the Site
URL to the live production domain and add `https://<domain>/**` to the redirect
allowlist.

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