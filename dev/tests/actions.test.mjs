// End-to-end lifecycle exercising ALL 43 router actions against the local fake,
// with a coverage assertion so a new/removed action fails this suite.
import test from "node:test";
import assert from "node:assert/strict";
import { resetJwksCache } from "../../supabase/functions/app/lib/auth.mjs";
import { mintToken } from "../test-auth.mjs";
import { setup, installJwksStub, call, adminToken, seed, guestBookingBody, ADMIN_PASSWORD } from "./helpers.mjs";

installJwksStub();

const U1 = "11111111-1111-4111-8111-111111111111"; // fresh member
const U2 = "22222222-2222-4222-8222-222222222222"; // claims the guest identity
const U3 = "33333333-3333-4333-8333-333333333333"; // link rejected

const ALL_ACTIONS = [
  "my_bookings", "auth_me", "my_rentals", "my_payments",
  "create_booking", "register_customer", "link_guest", "kyc_submit", "kyc_upload_url", "kyc_register",
  "admin_login",
  "admin_bookings", "admin_stats", "admin_customers", "admin_credit_events", "admin_links",
  "admin_rentals", "admin_consoles", "admin_maintenance", "admin_games", "admin_transactions",
  "admin_incidents", "admin_kyc", "admin_kyc_url",
  "admin_booking_update", "admin_customer_update", "admin_link_approve", "admin_link_reject",
  "admin_rental_handover", "admin_rental_return", "admin_rental_overdue",
  "admin_console_create", "admin_console_update", "admin_maintenance_create", "admin_maintenance_update",
  "admin_game_create", "admin_game_update", "admin_transaction_create", "admin_transaction_update",
  "admin_refund", "admin_incident_create", "admin_incident_update", "admin_kyc_verify",
];

test("full lifecycle covers all 43 actions", async () => {
  const ctx = setup();
  resetJwksCache();
  const covered = new Set();
  const hit = async (action, opts = {}, expect = 200) => {
    const res = await call(ctx, action, opts);
    assert.equal(res.status, expect, `${action}: ${JSON.stringify(res.body)}`);
    covered.add(action);
    return res.body;
  };
  const post = (action, body, extra = {}) => hit(action, { method: "POST", body, ...extra });

  // --- admin login ---
  const login = await post("admin_login", { password: ADMIN_PASSWORD }, { origin: null });
  const admin = login.token;
  const A = { admin };

  // --- guest booking (public) ---
  const guest = await post("create_booking", guestBookingBody());
  const guestBookingId = guest.booking.id;
  assert.equal(guest.booking.total, 31000);
  const guestCustomer = ctx.supabase._tables.customers.find((c) => c.phone === "255712345678");
  assert.ok(guestCustomer);

  // --- member registration + profile ---
  await seed(ctx, "profiles", { id: U1, full_name: "Member One", phone: "0700000001", email: "one@test", tier: "standard" });
  const t1 = await mintToken({ sub: U1 });
  const reg = await post("register_customer", {}, { customer: t1 });
  assert.equal(reg.link_pending, false);
  const memberCustomerId = reg.customer.id;
  const me = await hit("auth_me", { customer: t1 });
  assert.equal(me.customer.id, memberCustomerId);
  await post("create_booking", guestBookingBody({ phone: "0700000001", name: "Member One" }), { customer: t1 });
  const mine = await hit("my_bookings", { customer: t1 });
  assert.equal(mine.items.length, 1);

  // --- verified guest linking: U2 approved, U3 rejected ---
  await seed(ctx, "profiles", { id: U2, full_name: "Member Two", phone: "0700000002", email: "two@test", tier: "standard" });
  const t2 = await mintToken({ sub: U2 });
  const link = await post("link_guest", { phone: "0712345678" }, { customer: t2 });
  assert.equal(link.status, "pending_verification");
  const links = await hit("admin_links", A);
  const pending = links.items.find((l) => l.id === link.link_id);
  assert.ok(pending);
  await post("admin_link_approve", { link_id: link.link_id, evidence: "ID checked in person" }, A);
  const linkedCustomer = ctx.supabase._tables.customers.find((c) => c.id === guestCustomer.id);
  assert.equal(linkedCustomer.auth_user_id, U2);

  await post("create_booking", guestBookingBody({ phone: "0799112233", name: "Other Guest" }));
  await seed(ctx, "profiles", { id: U3, full_name: "Member Three", phone: "0700000003", email: "three@test", tier: "standard" });
  const t3 = await mintToken({ sub: U3 });
  const link3 = await post("link_guest", { phone: "0799112233" }, { customer: t3 });
  await post("admin_link_reject", { link_id: link3.link_id, reason: "Identity mismatch" }, A);

  // --- KYC: masked submit, private upload, register, admin review ---
  const kyc = await post("kyc_submit", { id_type: "nida", id_number: "123456789012" }, { customer: t1 });
  assert.equal(kyc.kyc_id_masked, "••••9012");
  const up = await post("kyc_upload_url", { doc_type: "nida", mime_type: "image/jpeg" }, { customer: t1 });
  assert.ok(up.storage_path.startsWith(`kyc-private/${memberCustomerId}/`));
  const docRes = await post("kyc_register", {
    storage_path: up.storage_path, doc_type: "nida", mime_type: "image/jpeg",
    file_name: "nida.jpg", size_bytes: 1024, id_number: "123456789012",
  }, { customer: t1 });
  const docId = docRes.document.id;
  const kycList = await hit("admin_kyc", A);
  assert.ok(kycList.items.some((d) => d.id === docId));
  const kycUrl = await hit("admin_kyc_url", { ...A, params: { document_id: docId } });
  assert.ok(kycUrl.url);
  await post("admin_kyc_verify", { document_id: docId, decision: "verified" }, A);

  // --- inventory: console, maintenance, game ---
  const con = await post("admin_console_create", { unit_code: "PS5-01", model: "PS5 Digital", status: "available", condition_grade: "good" }, A);
  const consoleId = con.item.id;
  const consoles = await hit("admin_consoles", A);
  assert.ok(consoles.items.some((c) => c.id === consoleId));
  await post("admin_console_update", { id: consoleId, notes: "Front desk unit" }, A);
  const maint = await post("admin_maintenance_create", { console_id: consoleId, issue: "HDMI port loose", status: "open", priority: "high" }, A);
  const maintList = await hit("admin_maintenance", A);
  assert.ok(maintList.items.some((m) => m.id === maint.item.id));
  await post("admin_maintenance_update", { id: maint.item.id, status: "resolved", resolved_at: new Date().toISOString() }, A);
  const game = await post("admin_game_create", { title: "FC 26", platform: "ps5", media_format: "disc" }, A);
  const games = await hit("admin_games", A);
  assert.ok(games.items.some((g) => g.id === game.item.id));
  await post("admin_game_update", { id: game.item.id, genre: "Sports" }, A);

  // --- booking administration + settlement ---
  const bookings = await hit("admin_bookings", A);
  assert.ok(bookings.items.length >= 3);
  const filtered = await hit("admin_bookings", { ...A, params: { status: "pending" } });
  assert.ok(filtered.items.every((b) => b.status === "pending"));
  await post("admin_booking_update", { id: guestBookingId, status: "confirmed", notes: "Confirmed by phone" }, A);
  await post("admin_booking_update", { id: guestBookingId, payment_status: "paid" }, A);

  // --- rental lifecycle: handover -> overdue -> return ---
  const handover = await post("admin_rental_handover", {
    booking_id: guestBookingId, console_id: consoleId,
    start_at: "2026-12-01T10:00:00Z", condition_out: "good",
  }, A);
  const rentalId = handover.rental.id;
  const rentals = await hit("admin_rentals", A);
  assert.ok(rentals.items.some((r) => r.id === rentalId));
  await post("admin_rental_overdue", { rental_id: rentalId }, A);
  const returned = await post("admin_rental_return", {
    rental_id: rentalId, actual_return_at: "2026-12-03T10:00:00Z", late_fee: 2000, condition_in: "good",
  }, A);
  assert.equal(returned.rental.status, "returned");
  const myRentals = await hit("my_rentals", { customer: t2 });
  assert.ok(myRentals.items.some((r) => r.id === rentalId));

  // --- ledger: create, list, correcting entry, refund ---
  const txn = await post("admin_transaction_create", { customer_id: guestCustomer.id, amount: 10000, kind: "deposit", method: "cash" }, A);
  const txns = await hit("admin_transactions", A);
  assert.ok(txns.items.some((t) => t.id === txn.item.id));
  const correction = await post("admin_transaction_update", { id: txn.item.id }, A);
  assert.equal(correction.appended, true);
  assert.equal(correction.reversed_ref, txn.item.ref);
  assert.equal(correction.item.amount, -10000);
  const refund = await post("admin_refund", { customer_id: guestCustomer.id, amount: 1000, method: "mpesa" }, A);
  assert.equal(refund.item.amount, -1000);

  // --- incidents ---
  const incident = await post("admin_incident_create", {
    customer_id: guestCustomer.id, rental_id: rentalId, console_id: consoleId,
    kind: "damage", severity: "medium", status: "open", claim_amount: 5000, description: "Scratched controller",
  }, A);
  const incidents = await hit("admin_incidents", A);
  assert.ok(incidents.items.some((i) => i.id === incident.item.id));
  await post("admin_incident_update", { id: incident.item.id, status: "resolved", resolved_amount: 3000 }, A);

  // --- customer admin + credit events + stats ---
  await post("admin_customer_update", { id: memberCustomerId, customer_tier: "premium", credit_limit: 50000 }, A);
  const events = await hit("admin_credit_events", { ...A, params: { customer_id: memberCustomerId } });
  assert.ok(events.items.length > 0);
  const customers = await hit("admin_customers", A);
  const memberRow = customers.customers.find((c) => c.id === memberCustomerId);
  assert.equal(memberRow.customer_tier, "premium");
  assert.equal(memberRow.credit_limit, 50000);

  // Model C end-to-end: guest debt = completed 31000 + late fee 2000 + resolved
  // incident 3000 - net settled 30000 (31000 receipt + 10000 deposit - 10000
  // correction - 1000 refund) = 6000.
  const payments = await hit("my_payments", { customer: t2 });
  assert.equal(payments.outstanding, 6000);
  const stats = await hit("admin_stats", A);
  assert.equal(stats.stats.outstanding, 6000);
  assert.equal(stats.stats.total_bookings, 3);

  assert.deepEqual([...covered].sort(), [...ALL_ACTIONS].sort(), "every router action must be exercised");
  assert.equal(covered.size, 43);
});

test("create_booking rejects invalid input", async () => {
  const ctx = setup();
  const bad = (over) => call(ctx, "create_booking", { method: "POST", body: guestBookingBody(over) });
  assert.equal((await bad({ package: "gold" })).status, 400);
  assert.equal((await bad({ zone: "mars" })).status, 400);
  assert.equal((await bad({ days: 0 })).status, 400);
  assert.equal((await bad({ package: "weekend", days: 2 })).status, 400);
  assert.equal((await bad({ phone: "123" })).status, 400);
  assert.equal((await bad({ start_date: "2020-01-01" })).status, 400);
  assert.equal((await bad({ payment_method: "paypal" })).status, 400);
});

test("admin updates reject unknown ids and empty patches", async () => {
  const ctx = setup();
  const admin = await adminToken(ctx);
  const missing = "99999999-9999-4999-8999-999999999999";
  assert.equal((await call(ctx, "admin_booking_update", { method: "POST", admin, body: { id: missing, status: "confirmed" } })).status, 404);
  assert.equal((await call(ctx, "admin_customer_update", { method: "POST", admin, body: { id: missing, customer_tier: "premium" } })).status, 404);
  assert.equal((await call(ctx, "admin_customer_update", { method: "POST", admin, body: { id: missing } })).status, 400);
  assert.equal((await call(ctx, "admin_console_update", { method: "POST", admin, body: { id: missing, status: "retired" } })).status, 404);
  assert.equal((await call(ctx, "admin_game_update", { method: "POST", admin, body: { id: missing, status: "retired" } })).status, 404);
  assert.equal((await call(ctx, "admin_maintenance_update", { method: "POST", admin, body: { id: missing, status: "resolved" } })).status, 404);
  assert.equal((await call(ctx, "admin_incident_update", { method: "POST", admin, body: { id: missing, status: "waived" } })).status, 404);
  assert.equal((await call(ctx, "admin_transaction_update", { method: "POST", admin, body: { id: missing } })).status, 404);
  assert.equal((await call(ctx, "admin_link_approve", { method: "POST", admin, body: { link_id: missing, evidence: "checked" } })).status, 404);
  assert.equal((await call(ctx, "admin_kyc_url", { admin, params: { document_id: missing } })).status, 404);
});