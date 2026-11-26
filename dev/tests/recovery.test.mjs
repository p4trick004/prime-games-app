// Admin authenticator enrollment, password recovery, and credential throttling.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setup, call, adminToken, ADMIN_PASSWORD } from "./helpers.mjs";
import { generateTotp } from "../../supabase/functions/app/lib/totp.mjs";
import { resetThrottle } from "../../supabase/functions/app/lib/throttle.mjs";

// RFC 6238 reference secret: base32 of ASCII "12345678901234567890".
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

beforeEach(() => resetThrottle());

async function wrongCode(secret) {
  const current = Number(await generateTotp(secret));
  return String((current + 1) % 1_000_000).padStart(6, "0");
}

async function startSetup(ctx, token) {
  const res = await call(ctx, "admin_totp_setup", { method: "POST", body: {}, admin: token });
  assert.equal(res.status, 200);
  return res.body;
}

async function verifySetup(ctx, token, secret) {
  const res = await call(ctx, "admin_totp_verify", { method: "POST", body: { code: await generateTotp(secret) }, admin: token });
  assert.equal(res.status, 200);
  return res.body;
}

async function enrolled() {
  const ctx = setup();
  const token = await adminToken(ctx);
  const { secret } = await startSetup(ctx, token);
  await verifySetup(ctx, token, secret);
  return { ctx, token, secret };
}

test("totp: RFC 6238 SHA-1 test vectors (6 digits)", async () => {
  assert.equal(await generateTotp(RFC_SECRET, 59_000), "287082");
  assert.equal(await generateTotp(RFC_SECRET, 1_111_111_109_000), "081804");
  assert.equal(await generateTotp(RFC_SECRET, 1_111_111_111_000), "050471");
  assert.equal(await generateTotp(RFC_SECRET, 1_234_567_890_000), "005924");
  assert.equal(await generateTotp(RFC_SECRET, 2_000_000_000_000), "279037");
});

test("enrollment endpoints require an admin session", async () => {
  const ctx = setup();
  assert.equal((await call(ctx, "admin_totp_status")).status, 401);
  assert.equal((await call(ctx, "admin_totp_setup", { method: "POST", body: {} })).status, 401);
  assert.equal((await call(ctx, "admin_totp_verify", { method: "POST", body: { code: "123456" } })).status, 401);
});

test("status starts inactive; methods are enforced", async () => {
  const ctx = setup();
  const token = await adminToken(ctx);
  const status = await call(ctx, "admin_totp_status", { admin: token });
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, { active: false, activated_at: null, pending: false });
  assert.equal((await call(ctx, "admin_totp_setup", { admin: token })).status, 405);
  assert.equal((await call(ctx, "admin_totp_verify", { admin: token })).status, 405);
});

test("setup issues a unique secret + otpauth URI but does not activate", async () => {
  const ctx = setup();
  const token = await adminToken(ctx);
  const first = await startSetup(ctx, token);
  assert.match(first.secret, /^[A-Z2-7]{32}$/);
  assert.match(first.otpauth_uri, /^otpauth:\/\/totp\/Prime%20Games:admin\?secret=[A-Z2-7]{32}&issuer=Prime%20Games&algorithm=SHA1&digits=6&period=30$/);
  assert.equal(first.digits, 6);
  assert.equal(first.period, 30);

  const status = await call(ctx, "admin_totp_status", { admin: token });
  assert.equal(status.body.active, false);
  assert.equal(status.body.pending, true);
  assert.ok(!JSON.stringify(status.body).includes(first.secret));

  const second = await startSetup(ctx, token);
  assert.notEqual(second.secret, first.secret);

  // The pending secret survives a restart of setup but never activates recovery.
  const recover = await call(ctx, "admin_recover", { method: "POST", body: { code: await generateTotp(second.secret) }, origin: null });
  assert.equal(recover.status, 503);
  assert.equal(recover.body?.error, "recovery_not_configured");
});

test("recovery is refused until enrollment is verified", async () => {
  const ctx = setup();
  const res = await call(ctx, "admin_recover", { method: "POST", body: { code: "123456" } });
  assert.equal(res.status, 503);
  assert.equal(res.body?.error, "recovery_not_configured");
  assert.equal((await call(ctx, "admin_recover")).status, 405);
});

test("verify rejects wrong codes and requires a pending setup", async () => {
  const ctx = setup();
  const token = await adminToken(ctx);
  const missing = await call(ctx, "admin_totp_verify", { method: "POST", body: { code: "123456" }, admin: token });
  assert.equal(missing.status, 400);
  assert.equal(missing.body?.error, "setup_required");

  const { secret } = await startSetup(ctx, token);
  const wrong = await call(ctx, "admin_totp_verify", { method: "POST", body: { code: await wrongCode(secret) }, admin: token });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body?.error, "invalid_code");
  const malformed = await call(ctx, "admin_totp_verify", { method: "POST", body: { code: "abcdef" }, admin: token });
  assert.equal(malformed.status, 401);
  const empty = await call(ctx, "admin_totp_verify", { method: "POST", body: {}, admin: token });
  assert.equal(empty.status, 400);

  const status = await call(ctx, "admin_totp_status", { admin: token });
  assert.equal(status.body.active, false);
  assert.equal(status.body.pending, true);
});

test("a verified code activates the authenticator", async () => {
  const ctx = setup();
  const token = await adminToken(ctx);
  const { secret } = await startSetup(ctx, token);
  const activated = await verifySetup(ctx, token, secret);
  assert.equal(activated.active, true);
  assert.ok(activated.activated_at);

  const status = await call(ctx, "admin_totp_status", { admin: token });
  assert.equal(status.body.active, true);
  assert.equal(status.body.pending, false);
  assert.equal(status.body.activated_at, activated.activated_at);
  assert.ok(!JSON.stringify(status.body).includes(secret));
});

test("admin_recover: enrolled code issues a working admin token", async () => {
  const { ctx, secret } = await enrolled();
  const code = await generateTotp(secret);
  const res = await call(ctx, "admin_recover", { method: "POST", body: { code }, origin: null });
  assert.equal(res.status, 200);
  assert.ok(res.body?.token);
  assert.equal((await call(ctx, "admin_bookings", { admin: res.body.token })).status, 200);

  const spaced = await call(ctx, "admin_recover", { method: "POST", body: { code: `${code.slice(0, 3)} ${code.slice(3)}` }, origin: null });
  assert.equal(spaced.status, 200);
});

test("admin_recover: wrong and malformed codes are rejected", async () => {
  const { ctx, secret } = await enrolled();
  const wrong = await call(ctx, "admin_recover", { method: "POST", body: { code: await wrongCode(secret) }, origin: null });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body?.error, "invalid_code");
  assert.equal((await call(ctx, "admin_recover", { method: "POST", body: { code: "abcdef" }, origin: null })).status, 401);
  assert.equal((await call(ctx, "admin_recover", { method: "POST", body: {}, origin: null })).status, 400);
});

test("replacing the authenticator: old codes work until the new one verifies", async () => {
  const { ctx, token, secret } = await enrolled();
  const { secret: next } = await startSetup(ctx, token);

  const oldWhilePending = await call(ctx, "admin_recover", { method: "POST", body: { code: await generateTotp(secret) }, origin: null });
  assert.equal(oldWhilePending.status, 200);

  resetThrottle();
  await verifySetup(ctx, token, next);

  resetThrottle();
  const nextOk = await call(ctx, "admin_recover", { method: "POST", body: { code: await generateTotp(next) }, origin: null });
  assert.equal(nextOk.status, 200);
  const oldRejected = await call(ctx, "admin_recover", { method: "POST", body: { code: await generateTotp(secret) }, origin: null });
  assert.equal(oldRejected.status, 401);
});

test("admin_totp_verify: 5 failures then 429 with retry-after", async () => {
  const ctx = setup();
  const token = await adminToken(ctx);
  const { secret } = await startSetup(ctx, token);
  const bad = await wrongCode(secret);
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await call(ctx, "admin_totp_verify", { method: "POST", body: { code: bad }, admin: token })).status, 401);
  }
  const blocked = await call(ctx, "admin_totp_verify", { method: "POST", body: { code: await generateTotp(secret) }, admin: token });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body?.error, "rate_limited");
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});

test("admin_recover: 5 failures then 429 with retry-after", async () => {
  const { ctx, secret } = await enrolled();
  const bad = await wrongCode(secret);
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await call(ctx, "admin_recover", { method: "POST", body: { code: bad }, origin: null })).status, 401);
  }
  const blocked = await call(ctx, "admin_recover", { method: "POST", body: { code: bad }, origin: null });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body?.error, "rate_limited");
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  // Blocked even with a valid code while the window is open.
  assert.equal((await call(ctx, "admin_recover", { method: "POST", body: { code: await generateTotp(secret) }, origin: null })).status, 429);
});

test("admin_recover: a success clears earlier failures", async () => {
  const { ctx, secret } = await enrolled();
  const bad = await wrongCode(secret);
  for (let i = 0; i < 4; i += 1) {
    await call(ctx, "admin_recover", { method: "POST", body: { code: bad }, origin: null });
  }
  assert.equal((await call(ctx, "admin_recover", { method: "POST", body: { code: await generateTotp(secret) }, origin: null })).status, 200);
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
