// Exercises the consolidated customer-history builders and the single-PDF
// renderer against the real TypeScript source. The modules are bundled with the
// esbuild copy that ships with Vite, because Node's type stripping cannot
// resolve extensionless TS imports.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const portal = path.join(root, "portal");

// Bundle the real TS modules with the esbuild copy that ships with Vite.
// Node's type stripping cannot resolve extensionless TS imports, and jsPDF has
// to be resolved from portal/node_modules.
const { build } = await import(pathToFileURL(path.join(portal, "node_modules/esbuild/lib/main.js")).href);
const outDir = await mkdtemp(path.join(os.tmpdir(), "prime-records-"));
async function bundle(entry) {
  const outfile = path.join(outDir, entry.replace(/\.ts$/, ".mjs"));
  await build({
    entryPoints: [path.join(portal, "src/lib", entry)],
    outfile,
    absWorkingDir: portal,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}
const records = await bundle("records.ts");
const pdfModule = await bundle("pdf.ts");

const booking = (over = {}) => ({
  id: "b1111111-1111-4111-8111-111111111111",
  ref: "PG-1001",
  customer_name: "Amina Hassan",
  customer_phone: "0712000000",
  zone_key: "sinza",
  address: "Sinza C",
  package_key: "starter",
  days: 3,
  start_date: "2026-03-01",
  start_time: "14:00",
  id_type: "nida",
  id_number: "19900104123456789012",
  ec_name: "Emergency Contact",
  ec_phone: "0712999999",
  payment_method: "mpesa",
  rental_amount: 75000,
  discount: 5000,
  delivery_fee: 0,
  total: 70000,
  status: "confirmed",
  payment_status: "unpaid",
  notes: null,
  created_at: "2026-02-25T10:00:00Z",
  ...over,
});

const rental = (over = {}) => ({
  id: "a1234567-89ab-4cde-8f01-23456789abcd",
  booking_id: "b1111111-1111-4111-8111-111111111111",
  customer_id: "c1",
  console_id: "k1",
  status: "active",
  start_at: "2026-03-01T11:00:00Z",
  expected_return_at: "2026-03-04T11:00:00Z",
  actual_return_at: null,
  condition_out: "excellent",
  condition_in: null,
  late_fee: 0,
  notes: null,
  created_at: "2026-02-25T10:05:00Z",
  customer_name: "Amina Hassan",
  customer_phone: "0712000000",
  booking_ref: "PG-1001",
  package_key: "starter",
  days: 3,
  unit_code: "PS5-A1",
  ...over,
});

const payment = (over = {}) => ({
  id: "p1",
  ref: "RCP-9001",
  booking_id: "b1111111-1111-4111-8111-111111111111",
  booking_ref: "PG-1001",
  customer_name: "Amina Hassan",
  customer_phone: "0712000000",
  amount: 50000,
  method: "mpesa",
  kind: "rental",
  status: "settled",
  notes: null,
  occurred_at: "2026-03-02T09:00:00Z",
  created_at: "2026-03-02T09:00:05Z",
  ...over,
});

const account = (over = {}) => ({
  name: "Amina Hassan",
  email: "amina@example.com",
  phone: "0712000000",
  tier: "standard",
  memberSince: "2026-01-10T08:00:00Z",
  creditLimit: null,
  ...over,
});

const now = new Date("2026-11-27T09:00:00+03:00");

test("account section shows contact and membership without street address", () => {
  const standard = Object.fromEntries(records.buildAccountTable(account()).sections[0].rows);
  assert.equal(standard.Name, "Amina Hassan");
  assert.equal(standard.Email, "amina@example.com");
  assert.equal(standard.Phone, "0712000000");
  assert.equal(standard.Membership, "Standard member");
  assert.equal(standard["Customer since"], "2026-01-10");
  assert.ok(!("Approved credit limit" in standard));

  const premium = Object.fromEntries(
    records.buildAccountTable(account({ tier: "premium", creditLimit: 100000 })).sections[0].rows,
  );
  assert.equal(premium.Membership, "Premium member");
  assert.equal(premium["Approved credit limit"], 100000);
});

test("booking history excludes identity data and uses the out console", () => {
  const consoleRental = rental({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "returned", unit_code: "PS5-OLD", created_at: "2026-03-10T10:00:00Z" });
  const table = records.buildBookingTable([booking()], [consoleRental, rental()]);
  const [row] = table.sections[0].rows;
  assert.equal(row[0], "PG-1001");
  assert.equal(row[6], "PS5-A1");
  assert.equal(row[8], "Confirmed");
  assert.equal(row[9], "Unpaid");
  assert.equal(row[13], 70000);
  const flat = JSON.stringify(table);
  assert.ok(!flat.includes("19900104123456789012"), "NIDA number leaked into export");
  assert.ok(!flat.includes("0712999999"), "emergency contact leaked into export");
  assert.ok(!flat.includes("Sinza C"), "street address leaked into export");
});

test("cancelled bookings show no payment state in the export", () => {
  const table = records.buildBookingTable([booking({ status: "cancelled", payment_status: "paid" })], []);
  assert.equal(table.sections[0].rows[0][9], "—");
});

test("rental rows derive a stable rental ref and durations", () => {
  const returned = rental({ actual_return_at: "2026-03-04T23:00:00Z", status: "returned", late_fee: 5000 });
  const row = records.buildRentalTable([returned]).sections[0].rows[0];
  assert.equal(row[0], "R-A1234567");
  assert.equal(row[1], "PG-1001");
  assert.equal(row[7], "3.5 days");
  assert.equal(row[9], 5000);
});

test("payment rows keep refunds negative and label method/type", () => {
  const rows = records.buildPaymentTable([
    payment({ id: "p2", ref: "RCP-9002", amount: -3000, kind: "refund", status: "settled" }),
  ]).sections[0].rows;
  assert.equal(rows[0][0], "RCP-9002");
  assert.equal(rows[0][2], -3000);
  assert.equal(rows[0][3], "M-Pesa");
  assert.equal(rows[0][4], "Refund");
});

test("spending summary covers the full history and nets refunds once", () => {
  const rentals = [rental({ late_fee: 2000 })];
  const payments = [
    payment(),
    payment({ id: "p-refund", ref: "RCP-9003", amount: -3000, kind: "refund", occurred_at: "2026-03-03T09:00:00Z" }),
    payment({ id: "p-pending", ref: "RCP-9004", amount: 15000, status: "pending" }),
  ];
  const table = records.buildSummaryTable({
    bookings: [booking(), booking({ id: "b-cancel", ref: "PG-CANCEL", status: "cancelled", total: 40000 })],
    rentals,
    payments,
    outstanding: 12500,
  });
  const totals = Object.fromEntries(table.sections[0].rows);
  assert.equal(totals["Rental expenditure (all bookings)"], 70000);
  assert.equal(totals["Late fees"], 2000);
  assert.equal(totals["Payments received"], 50000);
  assert.equal(totals["Refunds & adjustments"], 3000);
  assert.equal(totals["Net paid"], 47000);
  assert.equal(totals["Outstanding balance (current)"], 12500);

  const byRef = Object.fromEntries(table.sections[1].rows.map((r) => [r[0], r]));
  assert.deepEqual(Object.keys(byRef).sort(), ["PG-1001", "PG-CANCEL"]);
  assert.equal(byRef["PG-1001"][4], 47000);
  assert.equal(byRef["PG-1001"][5], 23000);
  assert.equal(byRef["PG-CANCEL"][5], 0);
});

test("bundle carries every section in one document", () => {
  const bundle = records.buildRecordsBundle({
    account: account(),
    bookings: [booking()],
    rentals: [rental()],
    payments: [
      payment({ id: "p-old", ref: "RCP-8000", occurred_at: "2026-02-01T09:00:00Z" }),
      payment(),
    ],
    outstanding: 20000,
    now,
  });
  assert.deepEqual(Object.keys(bundle.tables).sort(), ["account", "bookings", "payments", "rentals", "summary"]);
  assert.deepEqual(records.TABLE_ORDER, ["account", "bookings", "rentals", "payments", "summary"]);
  assert.equal(bundle.customerName, "Amina Hassan");
  assert.equal(bundle.generatedAt.getTime(), now.getTime());
  // newest receipt first in payment history
  assert.deepEqual(bundle.tables.payments.sections[0].rows.map((r) => r[0]), ["RCP-9001", "RCP-8000"]);
});

test("history filename is safe and descriptive", () => {
  assert.equal(
    records.historyFilename("Amina Hassan", now),
    "prime-games-complete-history-amina-hassan-2026-11-27.pdf",
  );
  assert.equal(
    records.historyFilename("  <>  ", now),
    "prime-games-complete-history-customer-2026-11-27.pdf",
  );
});

test("PDF renders one document containing all four history sections", () => {
  const bundle = records.buildRecordsBundle({
    account: account(),
    bookings: [booking(), booking({ id: "b2", ref: "PG-1002", status: "cancelled" })],
    rentals: [rental()],
    payments: [payment()],
    outstanding: 20000,
    now,
  });
  const tables = records.TABLE_ORDER.map((kind) => bundle.tables[kind]);
  const bytes = new Uint8Array(pdfModule.renderStatementPdf(tables, {
    customerName: bundle.customerName,
    generatedAt: now,
  }));
  assert.match(new TextDecoder("latin1").decode(bytes.slice(0, 8)), /^%PDF-1\.\d$/);
  assert.ok(bytes.length > 5000, `PDF too small (${bytes.length} bytes)`);
  const text = new TextDecoder("latin1").decode(bytes);
  for (const expected of [
    "PRIME GAMES",
    "Complete account history",
    "Customer account",
    "Booking history",
    "Rental history",
    "Payment history",
    "Customer spending summary",
    "Rental expenditure",
    "All amounts in TZS",
    "amina@example.com",
  ]) {
    assert.ok(text.includes(expected), `PDF missing ${expected}`);
  }
  assert.ok(!text.includes("19900104123456789012"), "NIDA number leaked into PDF");
});
