// In-memory fake of the Phase 3 Supabase schema for LOCAL testing only.
// Emulates the constraints/triggers/RPCs the Edge Function relies on:
//   * append-only payments (deny_mutation)
//   * rentals handover credit gate (assert_credit_available) + one-active-console
//   * customers non-premium-no-credit CHECK + unique auth_user_id + audit triggers
//   * unique refs/unit_code/storage_path, link_customer_auth verified-only semantics
//   * customer_outstanding() derivation
// NOT part of the deployment package. Never connects to a real database.

const now = () => new Date().toISOString();

const TABLES = [
  "customers", "customer_links", "customer_contact_history", "customer_credit_events",
  "bookings", "booking_games", "rentals", "payments", "consoles", "games",
  "maintenance", "incidents", "kyc_documents", "kyc_audit", "profiles",
  "admin_settings",
];

// Nullable unique columns only enforced when the value is non-null.
const UNIQUE = {
  customers: [["id"], ["auth_user_id"]],
  customer_links: [["id"]],
  customer_contact_history: [["id"]],
  customer_credit_events: [["id"]],
  bookings: [["id"], ["ref"]],
  booking_games: [["booking_id", "game_id"]],
  rentals: [["id"]],
  payments: [["id"], ["ref"]],
  consoles: [["id"], ["unit_code"], ["serial_number"]],
  games: [["id"]],
  maintenance: [["id"]],
  incidents: [["id"], ["ref"]],
  kyc_documents: [["id"], ["storage_path"]],
  kyc_audit: [["id"]],
  profiles: [["id"]],
  admin_settings: [["id"]],
};

const LIABILITY = ["damage", "loss", "theft", "late_return"];
const err = (code, message) => ({ code, message });

// Harness browser tests serve signed storage URLs from the local dev server.
let storageOrigin = "https://fake.storage";
export const setFakeStorageOrigin = (origin) => { storageOrigin = origin; };

export function createFakeSupabase() {
  const tables = {};
  for (const t of TABLES) tables[t] = [];

  // Emulates the app.actor GUC set by 0013 RPCs (audit triggers read it).
  let actorGuc = "system";

  // Model C (0013): only delivered/completed bookings are debt; pending and
  // confirmed reservations are commitments, not outstanding.
  function outstanding(customerId) {
    let charges = 0;
    for (const b of tables.bookings) if (b.customer_id === customerId && ["delivered", "completed"].includes(b.status)) charges += b.total ?? 0;
    for (const r of tables.rentals) if (r.customer_id === customerId && r.status !== "cancelled") charges += r.late_fee ?? 0;
    for (const i of tables.incidents) {
      if (i.customer_id === customerId && ["open", "investigating", "resolved"].includes(i.status) && LIABILITY.includes(i.kind)) {
        charges += i.resolved_amount ?? i.claim_amount ?? 0;
      }
    }
    let credits = 0;
    for (const p of tables.payments) if (p.customer_id === customerId && p.status === "settled") credits += p.amount ?? 0;
    return charges - credits;
  }

  function assertCredit(customerId, additional = 0) {
    const c = tables.customers.find((x) => x.id === customerId);
    if (!c) throw err("P0002", "customer_not_found");
    if (c.customer_status !== "active") throw err("P0001", "customer_not_active");
    const out = outstanding(customerId) + (additional ?? 0);
    if (out > c.credit_limit) throw err("P0001", `credit_limit_exceeded: outstanding=${out} credit_limit=${c.credit_limit}`);
  }

  function checkCustomer(row) {
    if (row.customer_tier !== "premium" && row.credit_limit !== 0) {
      throw err("23514", "customers_nonpremium_no_credit");
    }
  }

  function checkRentalActive(row, ignoreId) {
    if (["active", "overdue"].includes(row.status) && row.console_id) {
      const clash = tables.rentals.find((r) => r.id !== ignoreId && r.console_id === row.console_id && ["active", "overdue"].includes(r.status));
      if (clash) throw err("23505", "rentals_one_active_console");
    }
    if (row.status === "active") {
      // 0013 gate: the booking's own total counts until it is delivered.
      const b = tables.bookings.find((x) => x.id === row.booking_id);
      const additional = b && ["pending", "confirmed"].includes(b.status) ? b.total ?? 0 : 0;
      assertCredit(row.customer_id, additional);
    }
  }

  function checkPayment(row) {
    if (!Number.isInteger(row.amount) || row.amount === 0) throw err("23514", "payments_amount_check");
    if (row.kind === "refund" && row.amount >= 0) throw err("23514", "payments_refund_sign_check");
    if (["rental", "deposit", "late_fee", "damage_fee"].includes(row.kind) && row.amount <= 0) throw err("23514", "payments_receipt_sign_check");
  }

  function auditCustomer(oldRow, newRow) {
    for (const field of ["full_name", "phone", "email"]) {
      if (oldRow[field] !== newRow[field]) {
        tables.customer_contact_history.push({ id: crypto.randomUUID(), customer_id: newRow.id, field, old_value: oldRow[field] ?? null, new_value: newRow[field] ?? null, changed_by: actorGuc, created_at: now() });
      }
    }
    const tierChanged = oldRow.customer_tier !== newRow.customer_tier;
    const limitChanged = oldRow.credit_limit !== newRow.credit_limit;
    const statusChanged = oldRow.customer_status !== newRow.customer_status;
    if (tierChanged || limitChanged || statusChanged) {
      const event_type = tierChanged && limitChanged ? "tier_and_credit_change" : tierChanged ? "tier_change" : limitChanged ? "credit_limit_change" : "status_change";
      tables.customer_credit_events.push({
        id: crypto.randomUUID(), customer_id: newRow.id, event_type,
        old_tier: oldRow.customer_tier, new_tier: newRow.customer_tier,
        old_credit_limit: oldRow.credit_limit, new_credit_limit: newRow.credit_limit,
        old_status: oldRow.customer_status, new_status: newRow.customer_status, changed_by: actorGuc, created_at: now(),
      });
    }
  }

  function defaults(table, row) {
    const r = { ...row };
    if (r.created_at === undefined) r.created_at = now();
    if (["customers", "bookings", "rentals", "consoles", "games", "maintenance", "incidents", "kyc_documents"].includes(table) && r.updated_at === undefined) r.updated_at = now();
    if (table === "customers") { r.customer_tier ??= "basic"; r.credit_limit ??= 0; r.customer_status ??= "active"; r.auth_user_id ??= null; }
    if (table === "bookings") { r.status ??= "pending"; r.payment_status ??= "unpaid"; r.discount ??= 0; }
    if (table === "rentals") { r.status ??= "scheduled"; r.late_fee ??= 0; }
    if (table === "payments") { r.status ??= "settled"; r.currency ??= "TZS"; }
    if (table === "consoles") { r.status ??= "available"; r.condition_grade ??= "good"; }
    if (table === "games") { r.status ??= "available"; }
    if (table === "maintenance") { r.status ??= "open"; r.priority ??= "medium"; }
    if (table === "kyc_documents") { r.verification_status ??= "pending"; }
    return r;
  }

  function uniqueViolation(table, row, ignoreId) {
    for (const keys of UNIQUE[table] ?? [["id"]]) {
      if (keys.some((k) => row[k] === undefined || row[k] === null)) continue;
      const dup = tables[table].some((r) => r.id !== ignoreId && keys.every((k) => r[k] === row[k]));
      if (dup) return err("23505", `duplicate ${table}.${keys.join(",")}`);
    }
    return null;
  }

  class Builder {
    constructor(table, mode) {
      this.table = table; this.mode = mode;
      this.filters = []; this.inFilters = []; this.orders = [];
      this.rangeSpec = null; this.limitN = null; this.countExact = false;
      this.insertRow = null; this.updateFields = null; this.singleMode = null;
    }
    select(_cols, opts) { if (opts?.count === "exact") this.countExact = true; return this; }
    eq(col, val) { this.filters.push([col, val]); return this; }
    in(col, vals) { this.inFilters.push([col, vals]); return this; }
    order(col, opts) { this.orders.push([col, opts?.ascending !== false]); return this; }
    range(a, b) { this.rangeSpec = [a, b]; return this; }
    limit(n) { this.limitN = n; return this; }
    insert(row) { this.insertRow = row; return this; }
    update(fields) { this.updateFields = fields; return this; }
    single() { this.singleMode = "single"; return this; }
    maybeSingle() { this.singleMode = "maybe"; return this; }
    matches(row) {
      return this.filters.every(([c, v]) => row[c] === v)
        && this.inFilters.every(([c, vals]) => vals.includes(row[c]));
    }
    run() {
      const t = this.table;
      if (this.mode === "insert") {
        if (t === "payments") checkPayment(this.insertRow);
        const row = defaults(t, this.insertRow);
        if (t === "customers") checkCustomer(row);
        const dup = uniqueViolation(t, row, null);
        if (dup) return { data: null, error: dup };
        if (t === "rentals") { try { checkRentalActive(row, null); } catch (e) { return { data: null, error: e }; } }
        tables[t].push(row);
        return { data: { ...row }, error: null };
      }
      if (this.mode === "delete") {
        if (t === "payments") return { data: null, error: err("P0001", "append_only_violation: DELETE on payments is not permitted") };
        const keep = tables[t].filter((r) => !this.matches(r));
        tables[t].length = 0;
        tables[t].push(...keep);
        return { data: null, error: null };
      }
      if (this.mode === "update") {
        if (t === "payments") return { data: null, error: err("P0001", "append_only_violation: UPDATE on payments is not permitted") };
        const hit = tables[t].find((r) => this.matches(r));
        if (!hit) return { data: null, error: null };
        const oldRow = { ...hit };
        const next = { ...hit, ...this.updateFields };
        if (t === "customers") { try { checkCustomer(next); } catch (e) { return { data: null, error: e }; } }
        if (t === "rentals") { try { checkRentalActive(next, hit.id); } catch (e) { return { data: null, error: e }; } }
        const dup = uniqueViolation(t, next, hit.id);
        if (dup) return { data: null, error: dup };
        Object.assign(hit, this.updateFields);
        if (["customers", "bookings", "rentals", "consoles", "games", "maintenance", "incidents", "kyc_documents"].includes(t)) hit.updated_at = now();
        if (t === "customers") auditCustomer(oldRow, hit);
        return { data: { ...hit }, error: null };
      }
      let rows = tables[t].filter((r) => this.matches(r));
      for (const [col, asc] of [...this.orders].reverse()) {
        rows = rows.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
      }
      const count = rows.length;
      if (this.rangeSpec) rows = rows.slice(this.rangeSpec[0], this.rangeSpec[1] + 1);
      if (this.limitN !== null) rows = rows.slice(0, this.limitN);
      return { data: rows.map((r) => ({ ...r })), error: null, count };
    }
    then(resolve, reject) {
      try {
        const result = this.run();
        if (this.singleMode && Array.isArray(result.data)) {
          const row = result.data[0] ?? null;
          if (!row && this.singleMode === "single") resolve({ data: null, error: result.error ?? err("PGRST116", "no rows") });
          else resolve({ data: row, error: result.error, count: result.count });
          return;
        }
        if (this.singleMode === "single" && (!result.data || result.error)) {
          resolve({ data: null, error: result.error ?? err("PGRST116", "no rows") });
        } else if (this.countExact) {
          resolve({ data: result.data, error: result.error, count: result.count });
        } else {
          resolve(result);
        }
      } catch (e) { reject(e); }
    }
  }

  // ---- 0013 RPC emulation: atomic via snapshot rollback, actor GUC set ----
  function atomic(fn) {
    const snap = {};
    for (const t of TABLES) snap[t] = tables[t].map((r) => ({ ...r }));
    try {
      return fn();
    } catch (e) {
      for (const t of TABLES) { tables[t].length = 0; tables[t].push(...snap[t]); }
      throw e;
    }
  }
  const must = (result) => { if (result.error) throw result.error; return result.data; };
  const upd = (t, id, fields) => must(new Builder(t, "update").eq("id", id).update(fields).run());
  const ins = (t, row) => must(new Builder(t, "insert").insert(row).run());
  const byId = (t, id) => tables[t].find((r) => r.id === id);
  const fail = (code, message) => { throw err(code, message); };
  const CONDITIONS = ["excellent", "good", "fair", "poor"];

  function ledgerRef() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return "TXN-" + [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  }

  function rpcResolveGuest(a) {
    if (typeof a.p_phone !== "string" || !/^255[67][0-9]{8}$/.test(a.p_phone)) fail("P0001", "invalid_input");
    const name = typeof a.p_name === "string" ? a.p_name.trim() : "";
    if (name.length < 2 || name.length > 120) fail("P0001", "invalid_input");
    const guests = tables.customers
      .filter((c) => c.phone === a.p_phone && c.auth_user_id === null)
      .sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)) || String(x.id).localeCompare(String(y.id)));
    if (guests[0]) {
      if (guests[0].full_name !== name) return upd("customers", guests[0].id, { full_name: name });
      return { ...guests[0] };
    }
    return ins("customers", {
      id: crypto.randomUUID(), auth_user_id: null, full_name: name, phone: a.p_phone,
      email: null, customer_tier: "basic", credit_limit: 0, customer_status: "active",
    });
  }

  function rpcHandover(a) {
    const booking = byId("bookings", a.p_booking_id);
    if (!booking) fail("P0002", "booking_not_found");
    if (["cancelled", "completed"].includes(booking.status)) fail("P0001", "booking_not_handoverable");
    const consoleRow = byId("consoles", a.p_console_id);
    if (!consoleRow) fail("P0002", "console_not_found");
    if (consoleRow.status !== "available") fail("P0001", "console_not_available");
    const existing = tables.rentals.filter((r) => r.booking_id === a.p_booking_id);
    if (existing.some((r) => ["active", "overdue", "returned"].includes(r.status))) fail("P0001", "rental_already_exists");
    const start = a.p_start_at ?? now();
    const expected = a.p_expected_return_at ?? new Date(Date.parse(start) + booking.days * 86400000).toISOString();
    if (Date.parse(expected) < Date.parse(start)) fail("P0001", "invalid_input");
    const condition = CONDITIONS.includes(a.p_condition_out) ? a.p_condition_out : consoleRow.condition_grade;
    const scheduled = existing.filter((r) => r.status === "scheduled")
      .sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))[0];
    let rental;
    if (scheduled) {
      rental = upd("rentals", scheduled.id, {
        console_id: a.p_console_id, status: "active", start_at: start, expected_return_at: expected,
        condition_out: condition, notes: a.p_notes ?? scheduled.notes ?? null,
      });
    } else {
      rental = ins("rentals", {
        id: crypto.randomUUID(), customer_id: booking.customer_id, booking_id: booking.id,
        console_id: a.p_console_id, status: "active", start_at: start, expected_return_at: expected,
        condition_out: condition, notes: a.p_notes ?? null,
      });
    }
    upd("consoles", consoleRow.id, { status: "rented" });
    upd("bookings", booking.id, { status: "delivered" });
    return rental;
  }

  function rpcReturn(a) {
    const rental = byId("rentals", a.p_rental_id);
    if (!rental) fail("P0002", "rental_not_found");
    if (!["active", "overdue"].includes(rental.status)) fail("P0001", "rental_not_active");
    const actual = a.p_actual_return_at ?? now();
    if (rental.start_at && Date.parse(actual) < Date.parse(rental.start_at)) fail("P0001", "invalid_input");
    const fee = a.p_late_fee ?? rental.late_fee ?? 0;
    if (!Number.isInteger(fee) || fee < 0) fail("P0001", "invalid_input");
    const condition = CONDITIONS.includes(a.p_condition_in) ? a.p_condition_in : null;
    const updated = upd("rentals", rental.id, {
      status: "returned", actual_return_at: actual, late_fee: fee,
      condition_in: condition ?? rental.condition_in ?? null, notes: a.p_notes ?? rental.notes ?? null,
    });
    if (rental.console_id) {
      const con = byId("consoles", rental.console_id);
      upd("consoles", rental.console_id, { status: "available", condition_grade: condition ?? con.condition_grade });
    }
    upd("bookings", rental.booking_id, { status: "completed" });
    return updated;
  }

  function rpcSettle(a, sign) {
    const booking = byId("bookings", a.p_booking_id);
    if (!booking) fail("P0002", "booking_not_found");
    const settled = tables.payments
      .filter((p) => p.booking_id === booking.id && p.status === "settled")
      .reduce((s, p) => s + p.amount, 0);
    const amount = sign > 0 ? booking.total - settled : -settled;
    const flag = sign > 0 ? "paid" : "unpaid";
    if (sign > 0 ? amount <= 0 : settled <= 0) {
      if (booking.payment_status !== flag) upd("bookings", booking.id, { payment_status: flag });
      return null;
    }
    let payment = null;
    for (let i = 0; i < 3 && !payment; i += 1) {
      const result = new Builder("payments", "insert").insert({
        id: crypto.randomUUID(), ref: ledgerRef(), customer_id: booking.customer_id, booking_id: booking.id,
        amount, kind: sign > 0 ? "rental" : "adjustment",
        method: booking.payment_method === "cod" ? "cod" : "mpesa", status: "settled",
        notes: sign > 0 ? "Booking marked paid" : "Reversal: booking marked unpaid", recorded_by: actorGuc,
      }).run();
      if (!result.error) payment = result.data;
      else if (result.error.code !== "23505") throw result.error;
    }
    if (!payment) fail("23505", "duplicate payments.ref");
    upd("bookings", booking.id, { payment_status: flag });
    return payment;
  }

  function rpcAdminUpdateBooking(a) {
    if (a.p_status != null && !["pending", "confirmed", "delivered", "completed", "cancelled"].includes(a.p_status)) fail("P0001", "invalid_input");
    if (a.p_payment_status != null && !["unpaid", "paid"].includes(a.p_payment_status)) fail("P0001", "invalid_input");
    if (a.p_notes != null && String(a.p_notes).length > 1000) fail("P0001", "invalid_input");
    if (a.p_status == null && a.p_payment_status == null && a.p_notes == null && !a.p_clear_notes) fail("P0001", "invalid_input");
    const booking = byId("bookings", a.p_booking_id);
    if (!booking) fail("P0002", "booking_not_found");
    if (a.p_payment_status != null && a.p_payment_status !== booking.payment_status) {
      rpcSettle({ p_booking_id: booking.id }, a.p_payment_status === "paid" ? 1 : -1);
    }
    return upd("bookings", booking.id, {
      status: a.p_status ?? booking.status,
      notes: a.p_clear_notes ? null : (a.p_notes ?? booking.notes ?? null),
    });
  }

  function rpcAdminUpdateCustomer(a) {
    if (a.p_customer_tier != null && !["basic", "standard", "premium"].includes(a.p_customer_tier)) fail("P0001", "invalid_input");
    if (a.p_customer_status != null && !["active", "suspended", "blacklisted"].includes(a.p_customer_status)) fail("P0001", "invalid_input");
    if (a.p_credit_limit != null && (!Number.isInteger(a.p_credit_limit) || a.p_credit_limit < 0 || a.p_credit_limit > 100000000)) fail("P0001", "invalid_input");
    if (a.p_notes != null && String(a.p_notes).length > 1000) fail("P0001", "invalid_input");
    if (a.p_customer_tier == null && a.p_credit_limit == null && a.p_customer_status == null && a.p_notes == null && !a.p_clear_notes) fail("P0001", "invalid_input");
    const customer = byId("customers", a.p_customer_id);
    if (!customer) fail("P0002", "customer_not_found");
    const tier = a.p_customer_tier ?? customer.customer_tier;
    let limit = a.p_credit_limit ?? customer.credit_limit;
    if (tier !== "premium") limit = 0;
    const updated = upd("customers", customer.id, {
      customer_tier: tier, credit_limit: limit,
      customer_status: a.p_customer_status ?? customer.customer_status,
      notes: a.p_clear_notes ? null : (a.p_notes ?? customer.notes ?? null),
    });
    if (updated.auth_user_id && byId("profiles", updated.auth_user_id)) {
      upd("profiles", updated.auth_user_id, { tier: tier === "premium" ? "premium" : "standard" });
    }
    return updated;
  }

  function rpcCustomerSummaries() {
    return tables.customers.map((c) => {
      const bs = tables.bookings.filter((b) => b.customer_id === c.id);
      const newest = [...bs].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)) || String(y.id).localeCompare(String(x.id)))[0];
      const spend = tables.payments
        .filter((p) => p.customer_id === c.id && p.status === "settled" && p.amount > 0)
        .reduce((s, p) => s + p.amount, 0);
      const lastBooking = bs.reduce((m, b) => (String(b.created_at) > m ? String(b.created_at) : m), "");
      return {
        customer_id: c.id, bookings: bs.length, spend,
        open: bs.filter((b) => ["pending", "confirmed", "delivered"].includes(b.status)).length,
        zone_key: newest?.zone_key ?? null,
        last_at: lastBooking > String(c.created_at) ? lastBooking : c.created_at,
      };
    });
  }

  function rpcRevenueStats() {
    const eatDate = (iso) => new Date(Date.parse(iso) + 3 * 3600000).toISOString().slice(0, 10);
    const today = eatDate(now());
    const settled = tables.payments.filter((p) => p.status === "settled");
    return [{
      revenue: settled.reduce((s, p) => s + p.amount, 0),
      revenue_today: settled.filter((p) => eatDate(p.occurred_at ?? p.created_at) === today).reduce((s, p) => s + p.amount, 0),
    }];
  }

  const ATOMIC_RPCS = {
    resolve_guest_customer: rpcResolveGuest,
    handover_rental: rpcHandover,
    return_rental: rpcReturn,
    settle_booking: (a) => rpcSettle(a, 1),
    unsettle_booking: (a) => rpcSettle(a, -1),
    admin_update_booking: rpcAdminUpdateBooking,
    admin_update_customer: rpcAdminUpdateCustomer,
  };

  const supabase = {
    from(table) {
      if (!Object.hasOwn(tables, table)) throw new Error(`unexpected table ${table}`);
      return {
        select: (cols, opts) => new Builder(table, "select").select(cols, opts),
        insert: (row) => new Builder(table, "insert").insert(row),
        update: (fields) => new Builder(table, "update").update(fields),
        delete: () => new Builder(table, "delete"),
      };
    },
    async rpc(fn, args = {}) {
      try {
        if (Object.hasOwn(ATOMIC_RPCS, fn)) {
          actorGuc = args.p_actor ?? "system";
          try { return { data: atomic(() => ATOMIC_RPCS[fn](args)), error: null }; }
          finally { actorGuc = "system"; }
        }
        if (fn === "outstanding_by_customer") {
          return { data: tables.customers.map((c) => ({ customer_id: c.id, outstanding: outstanding(c.id) })), error: null };
        }
        if (fn === "customer_summaries") return { data: rpcCustomerSummaries(), error: null };
        if (fn === "revenue_stats") return { data: rpcRevenueStats(), error: null };
        if (fn === "customer_commitments") {
          return { data: tables.bookings.filter((b) => b.customer_id === args.p_customer_id && ["pending", "confirmed"].includes(b.status)).reduce((s, b) => s + (b.total ?? 0), 0), error: null };
        }
        if (fn === "customer_outstanding") return { data: outstanding(args.p_customer_id), error: null };
        if (fn === "assert_credit_available") { assertCredit(args.p_customer_id, args.p_additional_charge ?? 0); return { data: null, error: null }; }
        if (fn === "link_customer_auth") {
          const { p_customer_id, p_auth_user_id, p_method, p_evidence } = args;
          if (!["otp", "admin_assisted"].includes(p_method)) return { data: null, error: err("P0001", "unverified_link_method") };
          if (!p_evidence || String(p_evidence).trim().length < 3) return { data: null, error: err("P0001", "link_evidence_required") };
          const existing = tables.customers.find((c) => c.auth_user_id === p_auth_user_id);
          if (existing && existing.id !== p_customer_id) {
            tables.customer_links.push({ id: crypto.randomUUID(), customer_id: p_customer_id, auth_user_id: p_auth_user_id, link_method: p_method, verified: true, evidence: p_evidence, status: "conflict", created_at: now(), resolved_at: now() });
            return { data: null, error: err("P0001", "auth_user_already_linked") };
          }
          const customer = tables.customers.find((c) => c.id === p_customer_id);
          if (!customer) return { data: null, error: err("P0002", "customer_not_found") };
          const oldRow = { ...customer };
          customer.auth_user_id = p_auth_user_id;
          if (customer.customer_tier === "basic") customer.customer_tier = "standard";
          customer.updated_at = now();
          auditCustomer(oldRow, customer);
          tables.customer_links.push({ id: crypto.randomUUID(), customer_id: p_customer_id, auth_user_id: p_auth_user_id, link_method: p_method, verified: true, evidence: p_evidence, status: "linked", created_at: now(), resolved_at: now() });
          return { data: p_customer_id, error: null };
        }
        return { data: null, error: err("PGRST202", `unknown rpc ${fn}`) };
      } catch (e) {
        return { data: null, error: e.code ? e : err("P0001", String(e.message ?? e)) };
      }
    },
    storage: {
      from(bucket) {
        return {
          async createSignedUploadUrl(path) { return { data: { signedUrl: `${storageOrigin}/storage/v1/object/upload/sign/${bucket}/${path}?token=fake`, token: "fake", path }, error: null }; },
          async createSignedUrl(path, expires) { return { data: { signedUrl: `${storageOrigin}/storage/v1/object/sign/${bucket}/${path}?token=fake&expires=${expires}` }, error: null }; },
          async upload() { return { data: { path: "fake" }, error: null }; },
        };
      },
    },
    // Test introspection helpers (not part of the real client).
    _tables: tables,
    _outstanding: outstanding,
  };
  return supabase;
}