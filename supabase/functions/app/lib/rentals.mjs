// Rental lifecycle: console handover (through the Phase 3 credit gate), returns,
// and overdue marking. The credit gate is enforced by the DB trigger
// rentals_enforce_credit -> assert_credit_available() when a rental becomes
// 'active'; Basic/Standard (credit_limit 0) must be settled first.
import { CONSOLE_CONDITIONS } from "./core.mjs";
import { mapById } from "./mapping.mjs";

const DAY_MS = 86400000;

function isoOrNow(v) {
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return new Date().toISOString();
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

// Hand over a console for a booking: activate a rental through the credit gate,
// mark the console rented and the booking delivered. Returns {ok,...} or {error,status}.
export async function handoverRental(supabase, input) {
  const { booking_id, console_id } = input;
  const { data: booking, error: bErr } = await supabase.from("bookings").select("*").eq("id", booking_id).maybeSingle();
  if (bErr) throw new Error("database_request_failed");
  if (!booking) return { error: "booking_not_found", status: 404 };
  if (booking.status === "cancelled" || booking.status === "completed") return { error: "booking_not_handoverable", status: 409 };

  const { data: console, error: cErr } = await supabase.from("consoles").select("*").eq("id", console_id).maybeSingle();
  if (cErr) throw new Error("database_request_failed");
  if (!console) return { error: "console_not_found", status: 404 };
  if (console.status !== "available") return { error: "console_not_available", status: 409 };

  // Reject a second handover for the same booking.
  const { data: existing, error: eErr } = await supabase.from("rentals").select("id,status").eq("booking_id", booking_id);
  if (eErr) throw new Error("database_request_failed");
  if ((existing ?? []).some((r) => ["active", "overdue", "returned"].includes(r.status))) {
    return { error: "rental_already_exists", status: 409 };
  }

  const startAt = isoOrNow(input.start_at);
  const expectedReturn = input.expected_return_at
    ? isoOrNow(input.expected_return_at)
    : new Date(Date.parse(startAt) + booking.days * DAY_MS).toISOString();
  const conditionOut = CONSOLE_CONDITIONS.includes(input.condition_out) ? input.condition_out : console.condition_grade;

  const fields = {
    customer_id: booking.customer_id,
    booking_id,
    console_id,
    status: "active",
    start_at: startAt,
    expected_return_at: expectedReturn,
    condition_out: conditionOut,
    notes: input.notes ?? null,
  };

  // Reuse a scheduled rental if present, else create one. Activating fires the gate.
  const scheduled = (existing ?? []).find((r) => r.status === "scheduled");
  let rental;
  if (scheduled) {
    const { data, error } = await supabase.from("rentals").update(fields).eq("id", scheduled.id).select("*").maybeSingle();
    if (error) return creditError(error);
    rental = data;
  } else {
    const { data, error } = await supabase.from("rentals").insert({ id: crypto.randomUUID(), ...fields }).select("*").single();
    if (error) return creditError(error);
    rental = data;
  }
  if (!rental) return { error: "database_request_failed", status: 503 };

  await supabase.from("consoles").update({ status: "rented" }).eq("id", console_id);
  await supabase.from("bookings").update({ status: "delivered" }).eq("id", booking_id);
  const [view] = await mapRentals(supabase, [rental]);
  return { ok: true, rental: view };
}

function creditError(error) {
  const msg = String(error?.message ?? "");
  if (msg.includes("credit_limit_exceeded")) return { error: "credit_limit_exceeded", status: 402 };
  if (msg.includes("customer_not_active")) return { error: "customer_not_active", status: 403 };
  if (msg.includes("customer_not_found")) return { error: "customer_not_found", status: 404 };
  if (error?.code === "23505") return { error: "console_already_rented", status: 409 };
  return { error: "database_request_failed", status: 503 };
}

// Mark a rental returned: free the console, complete the booking, record late fee.
export async function returnRental(supabase, input) {
  const { data: rental, error } = await supabase.from("rentals").select("*").eq("id", input.rental_id).maybeSingle();
  if (error) throw new Error("database_request_failed");
  if (!rental) return { error: "rental_not_found", status: 404 };
  if (!["active", "overdue"].includes(rental.status)) return { error: "rental_not_active", status: 409 };

  const actualReturn = isoOrNow(input.actual_return_at);
  if (Date.parse(actualReturn) < Date.parse(rental.start_at)) return { error: "invalid_input", status: 400 };
  const lateFee = Number.isInteger(input.late_fee) && input.late_fee >= 0 ? input.late_fee : rental.late_fee ?? 0;
  const conditionIn = CONSOLE_CONDITIONS.includes(input.condition_in) ? input.condition_in : null;

  const patch = { status: "returned", actual_return_at: actualReturn, late_fee: lateFee };
  if (conditionIn) patch.condition_in = conditionIn;
  if (input.notes !== undefined) patch.notes = input.notes ?? null;
  const { data: updated, error: upErr } = await supabase.from("rentals").update(patch).eq("id", rental.id).select("*").maybeSingle();
  if (upErr || !updated) return { error: "database_request_failed", status: 503 };

  if (rental.console_id) {
    const consolePatch = { status: "available" };
    if (conditionIn) consolePatch.condition_grade = conditionIn;
    await supabase.from("consoles").update(consolePatch).eq("id", rental.console_id);
  }
  await supabase.from("bookings").update({ status: "completed" }).eq("id", rental.booking_id);
  const [view] = await mapRentals(supabase, [updated]);
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