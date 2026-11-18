// Harness-only scenario setup via the real API + local auth stub.
// Recreates: 6 consoles, guest booking, two members (one auto-created, one
// pending guest-link), KYC submit + private upload, admin-approved link.
// Usage: node dev/setup-harness.mjs [port]
const PORT = Number(process.argv[2] || 4174);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const API = `${ORIGIN}/functions/v1/app`;

const call = async (action, { method = "POST", body, admin, customer, params } = {}) => {
  const url = new URL(API);
  url.searchParams.set("action", action);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  const headers = { "content-type": "application/json" };
  if (admin) headers["x-admin-token"] = admin;
  if (customer) headers["x-supabase-token"] = customer;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${action} -> ${res.status} ${JSON.stringify(j)}`);
  return j;
};

const signup = async (email, password, full_name, phone) => {
  const res = await fetch(`${ORIGIN}/auth/v1/signup`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, data: { full_name, phone } }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`signup ${email} -> ${res.status} ${JSON.stringify(j)}`);
  return j;
};

const { token: admin } = await call("admin_login", { body: { password: "local-test-admin" } });

const MODELS = [
  ["PG-001", "PS5 Original (Disc)"], ["PG-002", "PS5 Original (Digital)"],
  ["PG-003", "PS5 Slim (Disc)"], ["PG-004", "PS5 Slim (Digital)"],
  ["PG-005", "PS5 Pro"], ["PG-006", "PS5 Pro (Disc Drive)"],
];
for (const [unit_code, model] of MODELS) {
  await call("admin_console_create", { admin, body: { unit_code, model, serial_number: `SN-${unit_code}-TZ`, status: "available", condition_grade: "good", notes: "Harness seed unit" } });
}
console.log("consoles: 6 seeded");

const bookingBase = {
  package: "starter", days: 1, zone: "sinza", start_date: "2026-11-19", start_time: "14:00",
  id_type: "nida", ec_name: "Guest Contact", ec_phone: "0755999888", payment_method: "mpesa",
};
const guest = await call("create_booking", { body: { ...bookingBase, name: "Guest Baraka", phone: "0755123456", address: "Guest Street 9, Sinza (harness)", id_number: "19850202-00002-00002-02" } });
console.log("guest booking:", guest.reference ?? guest.ref ?? JSON.stringify(guest).slice(0, 120));

const amina = await signup("amina@test.primegames.local", "TestPass123!", "Amina Test", "0712345678");
const aminaReg = await call("register_customer", { customer: amina.access_token });
console.log("amina register:", aminaReg.customer ? "customer created" : `link_pending=${aminaReg.link_pending}`);
await call("kyc_submit", { customer: amina.access_token, body: { id_type: "nida", id_number: "19900101-00001-00001-01" } });
const up = await call("kyc_upload_url", { customer: amina.access_token, body: { doc_type: "nida", mime_type: "image/png" } });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const fd = new FormData();
fd.append("cacheControl", "3600");
fd.append("file", new Blob([png], { type: "image/png" }), "kyc-test.png");
const upRes = await fetch(`${ORIGIN}/storage/v1/object/upload/sign/${up.bucket}/${up.path}?token=${up.token}`, { method: "PUT", body: fd });
if (!upRes.ok) throw new Error(`upload -> ${upRes.status}`);
await call("kyc_register", { customer: amina.access_token, body: { storage_path: up.storage_path, doc_type: "nida", mime_type: "image/png", file_name: "kyc-test.png", size_bytes: png.length } });
console.log("amina KYC: submitted + document uploaded privately");
const aminaBooking = await call("create_booking", { customer: amina.access_token, body: { ...bookingBase, zone: "goba", name: "Amina Test", phone: "0712345678", address: "Test Street 1, Goba (harness)", id_number: "19900101-00001-00001-01", start_date: "2026-11-18", start_time: "10:00" } });
console.log("amina booking:", JSON.stringify(aminaBooking).slice(0, 120));

const baraka = await signup("baraka@test.primegames.local", "TestPass456!", "Baraka Member", "0755123456");
const barakaReg = await call("register_customer", { customer: baraka.access_token });
console.log("baraka register:", `link_pending=${barakaReg.link_pending} link_id=${barakaReg.link_id}`);
const links = await call("admin_links", { method: "GET", admin, params: { status: "pending" } });
const link = links.items.find((l) => l.id === barakaReg.link_id);
await call("admin_link_approve", { admin, body: { link_id: link.id, evidence: "Harness test: verified by phone call, ID matched guest booking" } });
console.log("baraka link: approved (guest history preserved)");
console.log("DONE");