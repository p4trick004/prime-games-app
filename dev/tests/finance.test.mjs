// Finance tests: Model C debt semantics, credit gate with atomic rollback,
// append-only ledger, idempotent settlement/reversal, guest dedup race,
// aggregation without row caps, actor attribution, revenue stats.
import test from "node:test";
import assert from "node:assert/strict";
import { setup, call, adminToken, seed, bookingFields, guestBookingBody } from "./helpers.mjs";

const CUST = "aaaaaaaa-0000-4000-8000-000000000001";
const CONSOLE = "cccccccc-0000-4000-8000-000000000001";

async function seedCustomer(ctx, over = {}) {
  await seed(ctx, "customers", {
    full_name: "Test Guest", phone: "255712345678", customer_tier: "basic",
    credit_limit: 0, customer_status: "active", ...over, id: over.id ?? CUST,
  });
}

async function seedConsole(ctx, over = {}) {
  await seed(ctx, "consoles", {
    unit_code: "PS5-01", model: "PS5 Digital", status: "available", condition_grade: "good", ...over, id: over.id ?? CONSOLE,
  });
}

async function customerRow(ctx, token, id = CUST) {
  const res = await call(ctx, "admin_customers", { admin: token });
  assert.equal(res.status, 200);
  return res.body.customers.find((c) => c.id === id);
}

test("Model C: pending/confirmed are commitments, delivered/completed are debt", async () => {
  const ctx = setup();
  const token = await adminToken(ctx);
  await seedCustomer(ctx);
  await seed(ctx, "bookings", bookingFields(CUST, { status: "pending", payment_status: "unpaid", total: 31000 }));
  await seed(ctx, "bookings", bookingFields(CUST, { status: "confirmed", payment_status: "unpaid", total: 50000 }));
  let c = await customerRow(ctx, token);
  assert.equal(c.outstanding, 0);
  await seed(ctx, "bookings", bookingFields(CUST, { status: "delivered", payment_status: "unpaid", total: 25000 }));
  await seed(ctx, "bookings", bookingFields(CUST, { status: "completed", payment_status: "unpaid", total: 15000 }));
  c = await customerRow(ctx, token);
  assert.equal(c.outstanding, 40000);
  // Cancelled bookings never count.
  await seed(ctx, "bookings", bookingFields(CUST, { status: "cancelled", payment_status: "unpaid", total: 99000 }));
  c = await customerRow(ctx, token);
  assert.equal(c.outstanding, 40000);
});

test("credit gate: over-limit handover fails 402 and rolls back atomically", async () => {
  const ctx = setup();
  const token = await adminToken(ctx);
  await seedCustomer(ctx);
  await seedConsole(ctx);
  const booking = await seed(ctx, "bookings", bookingFields(CUST, { status: "confirmed", payment_status: "unpaid", total: 31000 }));
  const res = await call(ctx, "admin_rental_handover", {
    method: "POST", admin: token,
    body: { booking_id: booking.id, console_id: CONSOLE, start_at: "2026-12-01T10:00:00Z", condition_out: "good" },
  });
  assert.equal(res.status, 402);
  assert.equal(res.body.error, "credit_limit_exceeded");
  // Full rollback: no rental, console untouched, booking untouched.
  assert.equal(ctx.supabase._tables.rentals.length, 0);
  const console = ctx.supabase._tables.consoles.find((c) => c.id === CONSOLE);
  assert.equal(console.status, "available");
  const b = ctx.supabase._tables.bookings.find((x) => x.id === booking.id);
  assert.equal(b.status, "confirmed");
});

test("credit gate: settled booking allows Basic handover; other unpaid future booking does not block", async () => {
  const ctx = setup();
  const token = await adminToken(ctx);
  await seedCustomer(ctx);
  await seedConsole(ctx);
  const booking = await seed(ctx, "bookings", bookingFields(CUST, { status: "confirmed", payment_status: "unpaid", total: 31000 }));
  await seed(ctx, "bookings", bookingFields(CUST, { status: "pending", payment_status: "unpaid", total: 50000, start_date: "2026-12-20" }));
  const pay = await call(ctx, "admin_booking_update", { method: "POST", admin: token, body: { id: booking.id, payment_status: "paid" } });
  assert.equal(pay.status, 200);
  const res = await call(ctx, "admin_rental_handover", {
    method: "POST", admin: token,
    body: { booking_id: booking.id, console_id: CONSOLE, start_at: "2026-12-01T10:00:00Z", condition_out: "good" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.rental.status, "active");
  const b = ctx.supabase._tables.bookings.find((x) => x.id === booking.id);
  assert.equal(b.status, "delivered");
  const console = ctx.supabase._tables.consoles.find((c) => c.id === CONSOLE);
  assert.equal(console.status, "rented");
});

test("credit gate: premium credit limit carries an unpaid handover", async () => {
  const ctx = setup();
  const token = await adminToken(ctx);
  await seedCustomer(ctx, { customer_tier: "premium", credit_limit: 50000 });
  await seedConsole(ctx);
  const booking = await seed(ctx, "bookings", bookingFields(CUST, { status: "confirmed", payment_status: "unpaid", total: 31000 }));
  const res = await call(ctx, "admin_rental_handover", {
    method: "POST", admin: token,
    body: { booking_id: booking.id, console_id: CONSOLE, start_at: "2026-12-01T10:00:00Z", condition_out: "good" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test("settlement: paid is idempotent, unpaid appends a reversal", async () => {
  const ctx = setup();
  const token = await adminToken(ctx);
  await seedCustomer(ctx);
  const booking = await seed(ctx, "bookings", bookingFields(CUST, { status: "delivered", payment_status: "unpaid", total: 31000 }));
  for (let i = 0; i < 2; i += 1) {
    const res = await call(ctx, "admin_booking_update", { method: "POST", admin: token, body: { id: booking.id, payment_status: "paid" } });
    assert.equal(res.status, 200);
  }
  let receipts = ctx.supabase._tables.payments.filter((p) => p.booking_id === booking.id);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].amount, 31000);
  assert.equal(receipts[0].kind, "rental");
  const un = await call(ctx, "admin_booking_update", { method: "POST", admin: token, body: { id: booking.id, payment_status: "unpaid" } });
  assert.equal(un.status, 200);
  receipts = ctx.supabase._tables.payments.filter((p) => p.booking_id === booking.id);
  assert.equal(receipts.length, 2);
  const net = receipts.reduce((s, p) => s + p.amount, 0);
  assert.equal(net, 0);
  assert.ok(receipts.some((p) => p.amount === -31000));
});

test("ledger: payments are append-only (update/delete blocked)", async () => {
  const ctx = setup();
  const token = await adminToken(ctx);
  await seedCustomer(ctx);
  const booking = await seed(ctx, "bookings", bookingFields(CUST, { status: "delivered", payment_status: "unpaid" }));
  const res = await call(ctx, "admin_booking_update", { method: "POST", admin: token, body: { id: booking.id, payment_status: "paid" } });
  assert.equal(res.status, 200);
  const row = ctx.supabase._tables.payments[0];
  const upd = await ctx.supabase.from("payments").update({ amount: 1 }).eq("id", row.id);
  assert.ok(upd.error, "direct update must fail");
  const del = await ctx.supabase.from("payments").delete().eq("id", row.id);
  assert.ok(del.error, "direct delete must fail");
});

test("guest dedup: concurrent bookings on one new phone create one customer", async () => {
  const ctx = setup();
  const body = guestBookingBody({ phone: "0799887766", name: "Race Guest" });
  const [r1, r2] = await Promise.all([
    call(ctx, "create_booking", { method: "POST", body }),
    call(ctx, "create_booking", { method: "POST", body }),
  ]);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  const guests = ctx.supabase._tables.customers.filter((c) => c.phone === "255799887766");
  assert.equal(guests.length, 1);
  assert.equal(ctx.supabase._tables.bookings.length, 2);
  assert.equal(r1.body.booking.customer_id, r2.body.booking.customer_id);
});

test("aggregation: outstanding is exact beyond the 5000-row page cap", async () => {
  const ctx = setup();
  const token = await adminToken(ctx);
  await seedCustomer(ctx);
  // 6000 delivered unpaid bookings of 1 TZS each, inserted directly for volume.
  for (let i = 0; i < 6000; i += 1) {
    ctx.supabase._tables.bookings.push({
      ...bookingFields(CUST, { status: "delivered", payment_status: "unpaid", total: 1 }),
      id: crypto.randomUUID(), ref: `BK-VOL${i}`,
    });
  }
  const c = await customerRow(ctx, token);
  assert.equal(c.outstanding, 6000);
  assert.equal(c.bookings, 6000);
});

test("actor attribution: admin and guest actions land in audit rows", async () => {
  const ctx = setup();
  const token = await adminToken(ctx);
  await seedCustomer(ctx);
  const res = await call(ctx, "admin_customer_update", {
    method: "POST", admin: token, body: { id: CUST, customer_tier: "premium", credit_limit: 50000 },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const events = ctx.supabase._tables.customer_credit_events.filter((e) => e.customer_id === CUST);
  assert.ok(events.length > 0);
  assert.ok(events.every((e) => e.changed_by === "admin"), JSON.stringify(events));
  // Guest booking that renames the guest customer is attributed to 'guest'.
  await call(ctx, "create_booking", { method: "POST", body: guestBookingBody({ phone: "0712345678", name: "Renamed Guest" }) });
  const history = ctx.supabase._tables.customer_contact_history.filter((h) => h.customer_id === CUST);
  assert.ok(history.some((h) => h.changed_by === "guest"), JSON.stringify(history));
});

test("revenue stats: settled receipts total and today's EAT portion", async () => {
  const ctx = setup();
  const token = await adminToken(ctx);
  await seedCustomer(ctx);
  const past = new Date(Date.now() - 3 * 86400000).toISOString();
  const create = await call(ctx, "admin_transaction_create", {
    method: "POST", admin: token,
    body: { customer_id: CUST, amount: 10000, kind: "rental", method: "cash", occurred_at: past },
  });
  assert.equal(create.status, 200, JSON.stringify(create.body));
  const today = await call(ctx, "admin_transaction_create", {
    method: "POST", admin: token,
    body: { customer_id: CUST, amount: 7000, kind: "deposit", method: "mpesa" },
  });
  assert.equal(today.status, 200);
  const refund = await call(ctx, "admin_transaction_create", {
    method: "POST", admin: token,
    body: { customer_id: CUST, amount: -2000, kind: "refund", method: "cash" },
  });
  assert.equal(refund.status, 200);
  const stats = await call(ctx, "admin_stats", { admin: token });
  assert.equal(stats.status, 200);
  assert.equal(stats.body.stats.revenue, 15000);
  assert.equal(stats.body.stats.revenue_today, 5000);
});