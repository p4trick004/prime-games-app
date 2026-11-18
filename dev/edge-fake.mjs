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
};

const LIABILITY = ["damage", "loss", "theft", "late_return"];
const err = (code, message) => ({ code, message });

export function createFakeSupabase() {
  const tables = {};
  for (const t of TABLES) tables[t] = [];

  function outstanding(customerId) {
    let charges = 0;
    for (const b of tables.bookings) if (b.customer_id === customerId && b.status !== "cancelled") charges += b.total ?? 0;
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
    if (row.status === "active") assertCredit(row.customer_id, 0);
  }

  function checkPayment(row) {
    if (!Number.isInteger(row.amount) || row.amount === 0) throw err("23514", "payments_amount_check");
    if (row.kind === "refund" && row.amount >= 0) throw err("23514", "payments_refund_sign_check");
    if (["rental", "deposit", "late_fee", "damage_fee"].includes(row.kind) && row.amount <= 0) throw err("23514", "payments_receipt_sign_check");
  }

  function auditCustomer(oldRow, newRow) {
    for (const field of ["full_name", "phone", "email"]) {
      if (oldRow[field] !== newRow[field]) {
        tables.customer_contact_history.push({ id: crypto.randomUUID(), customer_id: newRow.id, field, old_value: oldRow[field] ?? null, new_value: newRow[field] ?? null, changed_by: "system", created_at: now() });
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
        old_status: oldRow.customer_status, new_status: newRow.customer_status, changed_by: "system", created_at: now(),
      });
    }
  }

  function defaults(table, row) {
    const r = { ...row };
    if (r.created_at === undefined) r.created_at = now();
    if (["customers", "bookings", "rentals", "consoles", "games", "maintenance", "incidents", "kyc_documents"].includes(table) && r.updated_at === undefined) r.updated_at = now();
    if (table === "customers") { r.customer_tier ??= "basic"; r.credit_limit ??= 0; r.customer_status ??= "active"; }
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

  const supabase = {
    from(table) {
      if (!Object.hasOwn(tables, table)) throw new Error(`unexpected table ${table}`);
      return {
        select: (cols, opts) => new Builder(table, "select").select(cols, opts),
        insert: (row) => new Builder(table, "insert").insert(row),
        update: (fields) => new Builder(table, "update").update(fields),
      };
    },
    async rpc(fn, args = {}) {
      try {
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
          async createSignedUploadUrl(path) { return { data: { signedUrl: `https://fake.storage/${bucket}/${path}?token=fake`, token: "fake", path }, error: null }; },
          async createSignedUrl(path, expires) { return { data: { signedUrl: `https://fake.storage/${bucket}/${path}?expires=${expires}` }, error: null }; },
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