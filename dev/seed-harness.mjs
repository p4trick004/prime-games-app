// Harness-only seed: creates the six PS5 model units via the real admin API.
// Usage: node dev/seed-harness.mjs [port]   (fixture admin password, local only)
const PORT = Number(process.argv[2] || 4174);
const BASE = `http://127.0.0.1:${PORT}/functions/v1/app`;

const login = await fetch(`${BASE}?action=admin_login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "local-test-admin" }),
});
const { token } = await login.json();
if (!token) throw new Error("admin_login failed");

const MODELS = [
  ["PG-001", "PS5 Original (Disc)"],
  ["PG-002", "PS5 Original (Digital)"],
  ["PG-003", "PS5 Slim (Disc)"],
  ["PG-004", "PS5 Slim (Digital)"],
  ["PG-005", "PS5 Pro"],
  ["PG-006", "PS5 Pro (Disc Drive)"],
];
for (const [unit_code, model] of MODELS) {
  const res = await fetch(`${BASE}?action=admin_console_create`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": token },
    body: JSON.stringify({
      unit_code, model, serial_number: `SN-${unit_code}-TZ`,
      status: "available", condition_grade: "good",
      notes: "Harness seed unit",
    }),
  });
  const j = await res.json();
  console.log(unit_code, model, res.status, j.ok ? "OK" : JSON.stringify(j));
}