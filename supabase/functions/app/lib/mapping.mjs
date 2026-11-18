// Reconstruct the legacy admin/customer API response shapes from the normalized
// Phase 3 schema via explicit bulk queries + JS joins (README §7.2).
// Removed columns are derived here: customer_name/phone, console_id, unit_code,
// current_renter, rentals_count, booking_ref.

// Fetch rows keyed by id. Empty id list -> empty map (no query).
export async function mapById(supabase, table, ids, columns = "*") {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out = new Map();
  if (uniq.length === 0) return out;
  const { data, error } = await supabase.from(table).select(columns).in("id", uniq);
  if (error || !Array.isArray(data)) throw new Error("database_request_failed");
  for (const row of data) out.set(row.id, row);
  return out;
}

// Fetch rows whose `col` is in ids (non-id foreign key). Returns the raw array.
export async function fetchIn(supabase, table, col, ids, columns = "*") {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return [];
  const { data, error } = await supabase.from(table).select(columns).in(col, uniq);
  if (error || !Array.isArray(data)) throw new Error("database_request_failed");
  return data;
}

const ACTIVE_RENTAL = ["active", "overdue"];

// bookings -> legacy Booking (adds customer_name, customer_phone, console_id).
export async function mapBookings(supabase, rows) {
  if (rows.length === 0) return [];
  const customers = await mapById(supabase, "customers", rows.map((b) => b.customer_id), "id,full_name,phone");
  const rentals = await fetchIn(supabase, "rentals", "booking_id", rows.map((b) => b.id), "id,booking_id,console_id,status,created_at");
  const consoleByBooking = new Map();
  for (const r of rentals) {
    const cur = consoleByBooking.get(r.booking_id);
    // Prefer an active/overdue rental's console; otherwise the most recent assignment.
    const rank = (x) => (ACTIVE_RENTAL.includes(x.status) ? 2 : x.console_id ? 1 : 0);
    if (!cur || rank(r) > rank(cur) || (rank(r) === rank(cur) && String(r.created_at) > String(cur.created_at))) {
      consoleByBooking.set(r.booking_id, r);
    }
  }
  return rows.map((b) => {
    const c = customers.get(b.customer_id);
    const r = consoleByBooking.get(b.id);
    return {
      ...b,
      customer_name: c?.full_name ?? "",
      customer_phone: c?.phone ?? "",
      console_id: r?.console_id ?? null,
    };
  });
}

// consoles -> legacy ConsoleUnit (adds current_renter, rentals_count).
export async function mapConsoles(supabase, rows) {
  if (rows.length === 0) return [];
  const rentals = await fetchIn(supabase, "rentals", "console_id", rows.map((c) => c.id), "id,console_id,customer_id,status");
  const countByConsole = new Map();
  const activeCustomerByConsole = new Map();
  for (const r of rentals) {
    if (r.status === "cancelled") continue;
    countByConsole.set(r.console_id, (countByConsole.get(r.console_id) ?? 0) + 1);
    if (ACTIVE_RENTAL.includes(r.status)) activeCustomerByConsole.set(r.console_id, r.customer_id);
  }
  const customers = await mapById(supabase, "customers", [...activeCustomerByConsole.values()], "id,full_name");
  return rows.map((c) => {
    const renterId = activeCustomerByConsole.get(c.id);
    return {
      ...c,
      current_renter: renterId ? (customers.get(renterId)?.full_name ?? null) : null,
      rentals_count: countByConsole.get(c.id) ?? 0,
    };
  });
}

// maintenance -> legacy MaintenanceRecord (adds unit_code).
export async function mapMaintenance(supabase, rows) {
  if (rows.length === 0) return [];
  const consoles = await mapById(supabase, "consoles", rows.map((m) => m.console_id), "id,unit_code");
  return rows.map((m) => ({ ...m, unit_code: consoles.get(m.console_id)?.unit_code ?? "" }));
}

// payments -> legacy Transaction (adds customer_name, customer_phone, booking_ref).
export async function mapTransactions(supabase, rows) {
  if (rows.length === 0) return [];
  const customers = await mapById(supabase, "customers", rows.map((p) => p.customer_id), "id,full_name,phone");
  const bookings = await mapById(supabase, "bookings", rows.map((p) => p.booking_id), "id,ref");
  return rows.map((p) => {
    const c = customers.get(p.customer_id);
    return {
      id: p.id,
      ref: p.ref,
      booking_id: p.booking_id ?? null,
      booking_ref: p.booking_id ? (bookings.get(p.booking_id)?.ref ?? null) : null,
      customer_name: c?.full_name ?? "",
      customer_phone: c?.phone ?? null,
      amount: p.amount,
      method: p.method,
      kind: p.kind,
      status: p.status,
      notes: p.notes ?? null,
      occurred_at: p.occurred_at,
      created_at: p.created_at,
    };
  });
}

// incidents -> legacy Incident (adds customer_name/phone, booking_ref, unit_code).
export async function mapIncidents(supabase, rows) {
  if (rows.length === 0) return [];
  const customers = await mapById(supabase, "customers", rows.map((i) => i.customer_id), "id,full_name,phone");
  const bookings = await mapById(supabase, "bookings", rows.map((i) => i.booking_id), "id,ref");
  const consoles = await mapById(supabase, "consoles", rows.map((i) => i.console_id), "id,unit_code");
  return rows.map((i) => {
    const c = customers.get(i.customer_id);
    return {
      ...i,
      customer_name: c?.full_name ?? "",
      customer_phone: c?.phone ?? null,
      booking_ref: i.booking_id ? (bookings.get(i.booking_id)?.ref ?? null) : null,
      unit_code: i.console_id ? (consoles.get(i.console_id)?.unit_code ?? null) : null,
    };
  });
}