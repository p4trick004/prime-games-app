// Append-only financial ledger helpers (Phase 3 payments). Corrections are new
// reversing entries, never edits. Settlement and aggregation run as DB RPCs
// (0013) so the ledger, the payment flag and customer_outstanding() can never
// diverge and no aggregate is silently truncated by a row cap.
import { TXN_KINDS, TXN_METHODS, TXN_STATUSES } from "./core.mjs";
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

// Per-customer outstanding from public.customer_outstanding() (Model C):
// delivered/completed booking totals + rental late fees + liability incidents
// - net settled payments. Computed in SQL; no row caps.
export async function aggregateOutstanding(supabase) {
  const { data, error } = await supabase.rpc("outstanding_by_customer");
  if (error || !Array.isArray(data)) throw new Error("database_request_failed");
  return new Map(data.map((r) => [r.customer_id, r.outstanding]));
}

// Net settled receipts (revenue) + today's portion (EAT), computed in SQL.
export async function revenueStats(supabase) {
  const { data, error } = await supabase.rpc("revenue_stats");
  if (error) throw new Error("database_request_failed");
  const row = Array.isArray(data) ? data[0] : data;
  return { revenue: Number(row?.revenue ?? 0), revenueToday: Number(row?.revenue_today ?? 0) };
}