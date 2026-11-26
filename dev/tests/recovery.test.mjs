// Admin password recovery (authenticator TOTP) and credential throttling.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setup, call, ADMIN_PASSWORD } from "./helpers.mjs";
import { generateTotp } from "../../supabase/functions/app/lib/totp.mjs";
import { resetThrottle } from "../../supabase/functions/app/lib/throttle.mjs";

// RFC 6238 reference secret: base32 of ASCII "12345678901234567890".
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

beforeEach(() => resetThrottle());

async function wrongCode() {
  const current = Number(await generateTotp(SECRET));
  return String((current + 1) % 1_000_000).padStart(6, "0");
}

test("totp: RFC 6238 SHA-1 test vectors (6 digits)", async () => {
  assert.equal(await generateTotp(SECRET, 59_000), "287082");
  assert.equal(await generateTotp(SECRET, 1_111_111_109_000), "081804");
  assert.equal(await generateTotp(SECRET, 1_111_111_111_000), "050471");
  assert.equal(await generateTotp(SECRET, 1_234_567_890_000), "005924");
  assert.equal(await generateTotp(SECRET, 2_000_000_000_000), "279037");
});

test("admin_recover: valid authenticator code issues a working admin token", async () => {
  const ctx = setup({ ADMIN_TOTP_SECRET: SECRET });
  const code = await generateTotp(SECRET);
  const res = await call(ctx, "admin_recover", { method: "POST", body: { code }, origin: null });
  assert.equal(res.status, 200);
  assert.ok(res.body?.token);
  const authed = await call(ctx, "admin_bookings", { admin: res.body.token });
  assert.equal(authed.status, 200);
});

test("admin_recover: code with spaces is accepted", async () => {
  const ctx = setup({ ADMIN_TOTP_SECRET: SECRET });
  const code = await generateTotp(SECRET);
  const res = await call(ctx, "admin_recover", { method: "POST", body: { code: `${code.slice(0, 3)} ${code.slice(3)}` }, origin: null });
  assert.equal(res.status, 200);
});

test("admin_recover: wrong and malformed codes are rejected", async () => {
  const ctx = setup({ ADMIN_TOTP_SECRET: SECRET });
  const wrong = await call(ctx, "admin_recover", { method: "POST", body: { code: await wrongCode() }, origin: null });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body?.error, "invalid_code");
  const malformed = await call(ctx, "admin_recover", { method: "POST", body: { code: "abcdef" }, origin: null });
  assert.equal(malformed.status, 401);
  const missing = await call(ctx, "admin_recover", { method: "POST", body: {}, origin: null });
  assert.equal(missing.status, 400);
});

test("admin_recover: fails closed without ADMIN_TOTP_SECRET, GET not allowed", async () => {
  const unset = await call(setup(), "admin_recover", { method: "POST", body: { code: "123456" } });
  assert.equal(unset.status, 503);
  assert.equal(unset.body?.error, "recovery_not_configured");
  const ctx = setup({ ADMIN_TOTP_SECRET: SECRET });
  assert.equal((await call(ctx, "admin_recover")).status, 405);
});

test("admin_recover: 5 failures then 429 with retry-after", async () => {
  const ctx = setup({ ADMIN_TOTP_SECRET: SECRET });
  const bad = await wrongCode();
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await call(ctx, "admin_recover", { method: "POST", body: { code: bad }, origin: null })).status, 401);
  }
  const blocked = await call(ctx, "admin_recover", { method: "POST", body: { code: bad }, origin: null });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body?.error, "rate_limited");
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  // Blocked even with a valid code while the window is open.
  assert.equal((await call(ctx, "admin_recover", { method: "POST", body: { code: await generateTotp(SECRET) }, origin: null })).status, 429);
});

test("admin_recover: a success clears earlier failures", async () => {
  const ctx = setup({ ADMIN_TOTP_SECRET: SECRET });
  const bad = await wrongCode();
  for (let i = 0; i < 4; i += 1) {
    await call(ctx, "admin_recover", { method: "POST", body: { code: bad }, origin: null });
  }
  const ok = await call(ctx, "admin_recover", { method: "POST", body: { code: await generateTotp(SECRET) }, origin: null });
  assert.equal(ok.status, 200);
  assert.equal((await call(ctx, "admin_recover", { method: "POST", body: { code: bad }, origin: null })).status, 401);
});

test("admin_login: 10 failures then 429; success clears the counter", async () => {
  const ctx = setup();
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await call(ctx, "admin_login", { method: "POST", body: { password: "nope" }, origin: null })).status, 401);
  }
  const blocked = await call(ctx, "admin_login", { method: "POST", body: { password: ADMIN_PASSWORD }, origin: null });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);

  resetThrottle();
  for (let i = 0; i < 9; i += 1) {
    await call(ctx, "admin_login", { method: "POST", body: { password: "nope" }, origin: null });
  }
  assert.equal((await call(ctx, "admin_login", { method: "POST", body: { password: ADMIN_PASSWORD }, origin: null })).status, 200);
  assert.equal((await call(ctx, "admin_login", { method: "POST", body: { password: "nope" }, origin: null })).status, 401);
});