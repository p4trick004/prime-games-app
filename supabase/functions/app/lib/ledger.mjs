// Append-only financial ledger helpers (Phase 3 payments). Corrections are new
// reversing entries, never edits. Outstanding/revenue are derived, mirroring
// public.customer_outstanding() so the dashboard and credit gate agree.
import { TXN_KINDS, TXN_METHODS, TXN_STATUSES, LIABILITY_KINDS, eatToday } from "./core.mjs";
import { makeTxnRef } from "./pricing.mjs";

const RECEIPT_KINDS = ["rental", "deposit", "late_fee", "damage_fee"];

// Validate + append one ledger entry. Returns {row} or {error,status}.
export async function appendPayment(supabase, input) {
  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount === 0) return { error: "invalid_input", status: 400 };
  const kind = input.kind;
  const method = input.method;
  const status = input.status ?? "settled";
  if (!TXN_KINDS.includes(kind)) return { error: "invalid_input", status: 400 };
  if (!TXN_METHODS.includes(method)) return { error: "invalid_input", status: 400 };
  if (!TXN_STATUSES.includes(status)) return { error: "invalid_input", status: 400 };
  if (kind === "refund" && amount >= 0) return { error: "refund_must_be_negative", status: 400 };
  if (RECEIPT_KINDS.includes(kind) && amount <= 0) return { error: "receipt_must_be_positive", status: 400 };
  if (!input.customer_id) return { error: "invalid_input", status: 400 };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = {
      id: crypto.randomUUID(),
      ref: makeTxnRef(),
      customer_id: input.customer_id,
      booking_id: input.booking_id ?? null,
      rental_id: input.rental_id ?? null,
      amount,
      currency: "TZS",
      kind,
      method,
      status,
      external_reference: input.external_reference ?? null,
      notes: input.notes ?? null,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
      recorded_by: input.recorded_by ?? null,
    };
    const { data, error } = await supabase.from("payments").insert(row).select("*").single();
    if (!error && data) return { row: data };
    if (!error || error.code !== "23505") return { error: "database_request_failed", status: 503 };
  }
  return { error: "database_request_failed", status: 503 };
}

// Net settled ledger amount already recorded against a booking.
export async function settledForBooking(supabase, bookingId) {
  const { data, error } = await supabase.from("payments").select("amount,status")
    .eq("booking_id", bookingId).eq("status", "settled");
  if (error || !Array.isArray(data)) throw new Error("database_request_failed");
  return data.reduce((s, p) => s + (Number.isInteger(p.amount) ? p.amount : 0), 0);
}

// Mark a booking paid: append a settled receipt for the remaining agreed total.
export async function settleBooking(supabase, booking, recordedBy) {
  const settled = await settledForBooking(supabase, booking.id);
  const remaining = booking.total - settled;
  if (remaining <= 0) return null;
  const res = await appendPayment(supabase, {
    customer_id: booking.customer_id,
    booking_id: booking.id,
    amount: remaining,
    kind: "rental",
    method: booking.payment_method === "cod" ? "cod" : "mpesa",
    status: "settled",
    notes: "Booking marked paid",
    recorded_by: recordedBy,
  });
  if (res.error) throw new Error(res.error);
  return res.row;
}

// Mark a booking unpaid: append a reversing adjustment zeroing its settled ledger.
export async function unsettleBooking(supabase, booking, recordedBy) {
  const settled = await settledForBooking(supabase, booking.id);
  if (settled <= 0) return null;
  const res = await appendPayment(supabase, {
    customer_id: booking.customer_id,
    booking_id: booking.id,
    amount: -settled,
    kind: "adjustment",
    method: booking.payment_method === "cod" ? "cod" : "mpesa",
    status: "settled",
    notes: "Reversal: booking marked unpaid",
    recorded_by: recordedBy,
  });
  if (res.error) throw new Error(res.error);
  return res.row;
}

// Per-customer outstanding, mirroring public.customer_outstanding():
//   non-cancelled booking totals + non-cancelled rental late fees
//   + customer-liability incident claims (not waived) - net settled payments.
export async function aggregateOutstanding(supabase) {
  const [bookings, rentals, incidents, payments] = await Promise.all([
    supabase.from("bookings").select("customer_id,total,status").limit(5000),
    supabase.from("rentals").select("customer_id,late_fee,status").limit(5000),
    supabase.from("incidents").select("customer_id,kind,status,claim_amount,resolved_amount").limit(5000),
    supabase.from("payments").select("customer_id,amount,status").limit(5000),
  ]);
  for (const r of [bookings, rentals, incidents, payments]) {
    if (r.error || !Array.isArray(r.data)) throw new Error("database_request_failed");
  }
  const charges = new Map();
  const add = (id, n) => { if (id) charges.set(id, (charges.get(id) ?? 0) + (Number.isFinite(n) ? n : 0)); };
  for (const b of bookings.data) if (b.status !== "cancelled") add(b.customer_id, b.total);
  for (const r of rentals.data) if (r.status !== "cancelled") add(r.customer_id, r.late_fee);
  for (const i of incidents.data) {
    if (["open", "investigating", "resolved"].includes(i.status) && LIABILITY_KINDS.includes(i.kind)) {
      add(i.customer_id, i.resolved_amount ?? i.claim_amount ?? 0);
    }
  }
  for (const p of payments.data) if (p.status === "settled") add(p.customer_id, -p.amount);
  return charges; // customer_id -> outstanding integer (may be negative)
}

// Net settled receipts (revenue) + today's portion, from the ledger.
export async function revenueStats(supabase) {
  const { data, error } = await supabase.from("payments").select("amount,status,occurred_at")
    .eq("status", "settled").limit(5000);
  if (error || !Array.isArray(data)) throw new Error("database_request_failed");
  const today = eatToday();
  let revenue = 0, revenueToday = 0;
  for (const p of data) {
    if (!Number.isInteger(p.amount)) continue;
    revenue += p.amount;
    if (typeof p.occurred_at === "string" && p.occurred_at.slice(0, 10) === today) revenueToday += p.amount;
  }
  return { revenue, revenueToday };
}