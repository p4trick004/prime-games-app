# Prime Games — Phase 3: Customer-Centred Database (Supabase PostgreSQL)

Target project: **`poaxanthiifatydqbnqq.supabase.co`** (schema `public`).
Status: **implemented, pending application** via the Supabase SQL Editor.

This is the approved customer-centred redesign. It **supersedes** the earlier
6-table consolidation (git commit `bf1e6da`), which was never applied. The new
business schema starts **EMPTY** — the 17 legacy Qoder records are **not**
imported. The original Qoder database, `auth.users`, and `public.profiles` are
preserved **unchanged**.

---

## 1. What this delivers

14 business tables + helper functions + strict RLS + a private KYC Storage bucket:

| Table | Purpose |
|---|---|
| `customers` | Permanent customer record, independent of Auth. Guest (`auth_user_id` NULL, tier `basic`) / registered (tier `standard`) / `premium` (admin-granted). Authoritative `customer_tier` + `credit_limit`. |
| `customer_links` | Audit of guest→account linking. Applied only after **verified OTP** or **secure admin-assisted** verification. |
| `customer_contact_history` | Append-style audit of name/phone/email changes (removes the need for duplicated snapshots). |
| `customer_credit_events` | Auditable log of every tier / credit-limit / status change. |
| `bookings` | Reservations (guest or member). Separate from rentals. |
| `booking_games` | Junction: games requested per booking. |
| `rentals` | Physical console lifecycle (`scheduled→active→returned/overdue`). Handover credit gate lives here. |
| `payments` | **Append-only** financial ledger: partial payments, refunds, adjustments, late fees. |
| `consoles` | PS5 fleet. |
| `games` | Game catalog. |
| `maintenance` | Repair registry. |
| `incidents` | Damage / loss claims. |
| `kyc_documents` | Optional private ID uploads (masked numbers only). |
| `kyc_audit` | KYC verification log. |

Helper functions: `current_customer_id()`, `customer_outstanding()`,
`assert_credit_available()`, `link_customer_auth()`, `set_updated_at()`,
`deny_mutation()`, plus audit/credit trigger functions.

---

## 2. File layout & apply order

```
supabase/
  profiles.sql                      # ALREADY APPLIED — do NOT re-run or modify
  README.md                         # this document
  backup/
    pre-migration-state.json        # captured live inspection (read-only)
    0000_backup_metadata.sql        # RUN FIRST: read-only metadata export
  migrations/
    0001_helpers.sql                # functions (check_function_bodies=off)
    0002_customers.sql              # customers + links + contact/credit audits + link fn
    0003_inventory.sql              # consoles, games
    0004_bookings.sql               # bookings, booking_games
    0005_rentals.sql                # rentals + handover credit gate
    0006_payments.sql               # append-only ledger
    0007_operations.sql             # maintenance, incidents
    0008_kyc.sql                    # kyc_documents, kyc_audit
    0009_storage.sql                # kyc-private bucket + object policies
    0010_rls.sql                    # enable RLS + grants + own-row policies
  validation/
    0011_validate_structure.sql     # read-only PASS/FAIL catalog report + empty counts
    0012_scenario_tests.sql         # BEGIN…ROLLBACK behavioural tests (non-persistent)
  rollback/
    0099_rollback_all.sql           # DESTRUCTIVE: drops Phase 3 only (not profiles/auth)
```

### Application steps (Supabase Dashboard → SQL Editor)

1. **Back up metadata first.** Run `backup/0000_backup_metadata.sql` and save the
   result grids. Confirm `public` contains only `profiles` and that none of the 14
   business tables exist. **If any business table already exists, STOP** (schema
   conflict) and request approval.
2. Apply `migrations/0001_helpers.sql` → `0010_rls.sql` **in numeric order**, one
   file per New query → Run. Each is idempotent.
3. Run `validation/0011_validate_structure.sql`. Every Section A row must be
   **PASS**; every Section B count must be **0**.
4. Run `validation/0012_scenario_tests.sql`. Expect `TEST n PASS` notices; the
   script ends in `ROLLBACK`, so no data persists.
5. To undo: run `rollback/0099_rollback_all.sql` (drops Phase 3 objects only).

> **Execution path note:** the agent has no service-role key / DB password / psql
> / Supabase CLI, and the Supabase MCP server is disconnected. Application is
> therefore performed by the user in the SQL Editor (the same channel used for
> `profiles.sql`). The agent verifies results via read-only anon REST probes and
> the user-run validation scripts.

---

## 3. Identity & tier model

- **Guest** → `customers.auth_user_id` NULL, `customer_tier = 'basic'`, `credit_limit = 0`.
- **Registered** → `auth_user_id` set (UNIQUE), `customer_tier = 'standard'`, `credit_limit = 0`.
- **Premium** → admin-granted `customer_tier = 'premium'`, `credit_limit > 0`.
- `customers.customer_tier` is **authoritative** for business rules. The legacy
  `profiles` table is untouched and remains the portal's profile store; the
  backend (Phase 4) syncs `profiles ↔ customers`.
- A CHECK enforces **non-premium ⇒ credit_limit = 0**.
- **Linking is never an unverified merge.** `link_customer_auth()` accepts only
  `otp` / `admin_assisted`, requires evidence, serializes per auth user
  (`pg_advisory_xact_lock`), attaches `auth_user_id` to the existing guest customer
  (preserving history), promotes `basic→standard`, and writes a verified
  `customer_links` row. If the auth user is already linked to a different
  customer it records a `conflict` and aborts — it never silently merges.
- Verified contacts are unique (`customers_phone_verified_key`,
  `customers_email_verified_key` partial unique indexes); unverified contacts may
  repeat and are never auto-merged.

---

## 4. Financial model

- **Bookings vs rentals:** a booking is a reservation; a rental is the console
  lifecycle. Basic/Standard **may create unpaid reservations**. Payment is
  enforced **before console handover**, not at booking time.
- **Append-only ledger (`payments`):** rows are immutable — a trigger
  (`deny_mutation`) blocks UPDATE/DELETE for **every** role including
  `service_role`. Corrections are new reversing entries.
  - Sign convention: **positive = received**, **negative = refunded**.
  - `kind`: `rental, deposit, refund, late_fee, damage_fee, adjustment, other`.
  - Only `status = 'settled'` entries affect the balance; `pending`/`failed` are
    informational. Partial payments are multiple settled entries that sum.
- **Outstanding balance** is **derived**, never stored:
  `customer_outstanding()` = non-cancelled booking totals + rental late fees +
  customer-liability incident claims (damage/loss/theft/late_return, not waived)
  − net settled payments.
- **Transactional credit gate:** `assert_credit_available()` locks the customer
  row `FOR UPDATE`, recomputes outstanding, and raises `credit_limit_exceeded` if
  it exceeds `credit_limit`. A trigger fires it when a rental becomes `active`
  (handover). Because Basic/Standard have `credit_limit = 0`, they must be fully
  settled first; Premium may carry outstanding within their approved limit. The
  row lock serializes concurrent handovers so the limit cannot be bypassed.

---

## 5. Security model

- **RLS enabled on all 14 tables.**
  - `anon`: **no** direct access (guests use the backend).
  - `authenticated`: **read-only SELECT of their own rows** on `customers`,
    `bookings`, `booking_games`, `rentals`, `payments`, `incidents`,
    `kyc_documents`. No writes.
  - `service_role`: full access, bypasses RLS — **backend only**.
  - Operational/audit tables (`consoles`, `games`, `maintenance`,
    `customer_links`, `customer_contact_history`, `customer_credit_events`,
    `kyc_audit`) are service-role only.
- **Admin authorization** is enforced in the backend via the `ADMIN_PASSWORD`
  HMAC token (`requireAdmin`), **not** by a DB role. The admin is not a Supabase
  auth user. The `service_role` key is **never** exposed to the frontend.
- **KYC Storage:** private bucket `kyc-private` (5 MB cap; JPEG/PNG/PDF only).
  Objects live under `kyc-private/<customer_id>/<uuid>`. Authenticated customers
  may SELECT/INSERT only within their **own** folder; no customer UPDATE/DELETE.
  Downloads use short-lived signed URLs generated by the backend. Only **masked**
  ID numbers are stored in `kyc_documents`.
- `current_customer_id()` is `SECURITY DEFINER` so own-row checks don't recurse
  into `customers`' RLS. All definer functions pin `search_path = public, pg_temp`.

---

## 6. Normalization decisions ("avoid duplicated/derived fields")

Removed from the legacy shape (reconstructed by the backend via joins in Phase 4):

- `bookings.customer_name`, `customer_phone`, `user_id`, `console_id`
  → identity via `customer_id`; console via `rentals`.
- `consoles.current_renter`, `rentals_count` → derived from active rental / rental count.
- `maintenance.unit_code` → derived from `console_id`.
- `incidents.customer_name`, `customer_phone`, `booking_ref`, `unit_code`
  → derived from `customer_id` / `booking_id` / `console_id`.
- `transactions` table → replaced by the append-only `payments` ledger.
- No stored `outstanding_balance` / `agreed_total` / `daily_rate` → derived.

Kept deliberately: `bookings.id_type/id_number/ec_name/ec_phone` (per-agreement
contract identity + emergency contact, not derivable from `customers`);
`bookings.total` (agreed-price snapshot, pinned by a CHECK to
`rental_amount + delivery_fee`); `bookings.payment_status` (workflow flag for API
compatibility — the ledger is authoritative for balances).

---

## 7. Phase 4 backend adaptation notes (NOT done in Phase 3)

Phase 3 is database-only. To preserve the existing API response shapes, the
Phase 4 backend must:

1. Create/resolve a `customers` row on booking (guest by normalized phone;
   member by `auth_user_id`), and set `bookings.customer_id`.
2. Reconstruct legacy API fields via joins: `customer_name`/`customer_phone`
   (from `customers`), `unit_code` (from `consoles`), `current_renter` /
   `rentals_count` (from `rentals`), `booking_ref` (from `bookings`).
3. Replace `admin_transaction_update` with **append** operations (refund /
   adjustment entries) — `payments` is append-only.
4. Orchestrate registration + verified linking via `link_customer_auth()` (after
   real OTP / admin verification), and sync `profiles ↔ customers`.
5. Call the handover flow so rentals activate through the credit gate; record
   payments as settled ledger entries.
6. Set `SET LOCAL app.actor = 'admin:<id>'` before admin updates so audit rows
   attribute the actor.

No frontend deployment, no application-code changes, and no Phase 4 work are part
of this phase.

---

## 8. Preservation guarantees

- `auth.users`: **never modified** (only referenced by nullable FKs).
- `public.profiles` + `handle_new_user()`: **unchanged** (no trigger added on `auth.users`).
- Original Qoder database (6 tables, 17 records): **untouched**; remains the backup.
- New business schema starts **EMPTY**; no legacy import.
- Account deletion (GDPR) is a controlled backend procedure: customers with
  financial history are anonymized rather than hard-deleted (ledger RESTRICT);
  KYC documents/audit cascade on customer deletion.