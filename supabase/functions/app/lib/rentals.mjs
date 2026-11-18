// Rental lifecycle: console handover (through the Phase 3 credit gate), returns,
// and overdue marking. Handover/return run as single-transaction DB RPCs
// (0013): the credit gate, console and booking updates commit or roll back
// together. Basic/Standard (credit_limit 0) must be settled first.
import { CONSOLE_CONDITIONS, rpcFailure } from "./core.mjs";
import { mapById } from "./mapping.mjs";

function validIsoOrNull(v) {
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

// rentals -> view with customer_name, booking_ref, unit_code (for admin/customer).
export async function mapRentals(supabase, rows) {
  if (rows.length === 0) return [];
  const customers = await mapById(supabase, "customers", rows.map((r) => r.customer_id), "id,full_name,phone");
  const bookings = await mapById(supabase, "bookings", rows.map((r) => r.booking_id), "id,ref,package_key,days");
  const consoles = await mapById(supabase, "consoles", rows.map((r) => r.console_id), "id,unit_code");
  return rows.map((r) => {
    const c = customers.get(r.customer_id);
    const b = bookings.get(r.booking_id);
    return {
      ...r,
      customer_name: c?.full_name ?? "",
      customer_phone: c?.phone ?? null,
      booking_ref: b?.ref ?? null,
      package_key: b?.package_key ?? null,
      days: b?.days ?? null,
      unit_code: r.console_id ? (consoles.get(r.console_id)?.unit_code ?? null) : null,
    };
  });
}

// Hand over a console for a booking via the atomic handover_rental RPC:
// rental activation through the credit gate, console rented, booking delivered.
export async function handoverRental(supabase, input) {
  const { data, error } = await supabase.rpc("handover_rental", {
    p_booking_id: input.booking_id,
    p_console_id: input.console_id,
    p_start_at: validIsoOrNull(input.start_at),
    p_expected_return_at: validIsoOrNull(input.expected_return_at),
    p_condition_out: CONSOLE_CONDITIONS.includes(input.condition_out) ? input.condition_out : null,
    p_notes: typeof input.notes === "string" ? input.notes : null,
    p_actor: "admin",
  });
  if (error) {
    if (error.code === "23505") return { error: "console_already_rented", status: 409 };
    return rpcFailure(error, {
      booking_not_handoverable: 409,
      console_not_available: 409,
      rental_already_exists: 409,
    });
  }
  if (!data) return { error: "database_request_failed", status: 503 };
  const [view] = await mapRentals(supabase, [data]);
  return { ok: true, rental: view };
}

// Mark a rental returned via the atomic return_rental RPC: frees the console,
// completes the booking and records the late fee in one transaction.
export async function returnRental(supabase, input) {
  const { data, error } = await supabase.rpc("return_rental", {
    p_rental_id: input.rental_id,
    p_actual_return_at: validIsoOrNull(input.actual_return_at),
    p_late_fee: Number.isInteger(input.late_fee) && input.late_fee >= 0 ? input.late_fee : null,
    p_condition_in: CONSOLE_CONDITIONS.includes(input.condition_in) ? input.condition_in : null,
    p_notes: typeof input.notes === "string" ? input.notes : null,
    p_actor: "admin",
  });
  if (error) return rpcFailure(error, { rental_not_active: 409 });
  if (!data) return { error: "database_request_failed", status: 503 };
  const [view] = await mapRentals(supabase, [data]);
  return { ok: true, rental: view };
}

export async function markOverdue(supabase, rentalId) {
  const { data: rental, error } = await supabase.from("rentals").select("*").eq("id", rentalId).maybeSingle();
  if (error) throw new Error("database_request_failed");
  if (!rental) return { error: "rental_not_found", status: 404 };
  if (rental.status !== "active") return { error: "rental_not_active", status: 409 };
  const { data, error: upErr } = await supabase.from("rentals").update({ status: "overdue" }).eq("id", rentalId).select("*").maybeSingle();
  if (upErr || !data) return { error: "database_request_failed", status: 503 };
  const [view] = await mapRentals(supabase, [data]);
  return { ok: true, rental: view };
}