// Security tests: JWT verification hardening, CORS allowlist, authorization
// matrix across every action, admin login, method/unknown-action handling.
import test from "node:test";
import assert from "node:assert/strict";
import { verifySupabaseJwt, resetJwksCache } from "../../supabase/functions/app/lib/auth.mjs";
import { mintToken, testKeys } from "../test-auth.mjs";
import { setup, installJwksStub, call, adminToken, ADMIN_PASSWORD, ORIGIN } from "./helpers.mjs";

const jwks = installJwksStub();
const UUID1 = "11111111-1111-4111-8111-111111111111";

test("JWT: valid token verifies", async () => {
  setup(); resetJwksCache();
  const claims = await verifySupabaseJwt(await mintToken({ sub: UUID1 }));
  assert.equal(claims?.sub, UUID1);
});

test("JWT: expired token rejected", async () => {
  setup(); resetJwksCache();
  const token = await mintToken({ sub: UUID1, exp: Math.floor(Date.now() / 1000) - 10 });
  assert.equal(await verifySupabaseJwt(token), null);
});

test("JWT: missing exp rejected (mandatory)", async () => {
  setup(); resetJwksCache();
  const token = await mintToken({ sub: UUID1, exp: undefined });
  assert.equal(await verifySupabaseJwt(token), null);
});

test("JWT: unknown kid rejected after one forced refetch", async () => {
  setup(); resetJwksCache();
  const before = jwks.fetches;
  const token = await mintToken({ sub: UUID1, kid: "rotated-away-key" });
  assert.equal(await verifySupabaseJwt(token), null);
  assert.equal(jwks.fetches - before, 2); // cached read + one forced refresh
});

test("JWT: missing kid header rejected", async () => {
  setup(); resetJwksCache();
  const token = await mintToken({ sub: UUID1, kid: undefined });
  assert.equal(await verifySupabaseJwt(token), null);
});

test("JWT: key rotation accepted via refetch", async () => {
  setup(); resetJwksCache();
  const { publicJwk } = await testKeys();
  const rotated = { ...publicJwk, kid: "test-key-2" };
  // Warm the cache with the old key only, then rotate the served JWKS.
  await verifySupabaseJwt(await mintToken({ sub: UUID1 }));
  jwks.keys = [rotated];
  const token = await mintToken({ sub: UUID1, kid: "test-key-2" });
  const claims = await verifySupabaseJwt(token);
  assert.equal(claims?.sub, UUID1);
  jwks.keys = null;
});

test("JWT: wrong aud / iss / sub / alg rejected", async () => {
  setup(); resetJwksCache();
  assert.equal(await verifySupabaseJwt(await mintToken({ sub: UUID1, aud: "anon" })), null);
  assert.equal(await verifySupabaseJwt(await mintToken({ sub: UUID1, iss: "https://evil.test/auth/v1" })), null);
  assert.equal(await verifySupabaseJwt(await mintToken({ sub: "not-a-uuid" })), null);
  const hs256 = await mintToken({ sub: UUID1 });
  const [h, p, s] = hs256.split(".");
  const badHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid: "test-key-1" })).toString("base64url");
  assert.equal(await verifySupabaseJwt(`${badHeader}.${p}.${s}`), null);
});

test("CORS: allowed origin echoed, disallowed gets no ACAO", async () => {
  const ctx = setup();
  const ok = await call(ctx, "admin_login", { method: "POST", body: { password: ADMIN_PASSWORD }, origin: ORIGIN });
  assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(ok.headers.get("vary"), "Origin");
  const bad = await call(ctx, "admin_login", { method: "POST", body: { password: ADMIN_PASSWORD }, origin: "https://evil.test" });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
  const none = await call(ctx, "admin_login", { method: "POST", body: { password: ADMIN_PASSWORD }, origin: null });
  assert.equal(none.headers.get("access-control-allow-origin"), null);
});

test("CORS: preflight follows the allowlist", async () => {
  const ctx = setup();
  const ok = await call(ctx, "admin_stats", { method: "OPTIONS", origin: ORIGIN });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
  const bad = await call(ctx, "admin_stats", { method: "OPTIONS", origin: "https://evil.test" });
  assert.equal(bad.status, 204);
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});

const ADMIN_GET = ["admin_bookings", "admin_stats", "admin_customers", "admin_credit_events", "admin_links", "admin_rentals", "admin_consoles", "admin_maintenance", "admin_games", "admin_transactions", "admin_incidents", "admin_kyc", "admin_kyc_url"];
const ADMIN_POST = ["admin_booking_update", "admin_customer_update", "admin_link_approve", "admin_link_reject", "admin_rental_handover", "admin_rental_return", "admin_rental_overdue", "admin_console_create", "admin_console_update", "admin_maintenance_create", "admin_maintenance_update", "admin_game_create", "admin_game_update", "admin_transaction_create", "admin_transaction_update", "admin_refund", "admin_incident_create", "admin_incident_update", "admin_kyc_verify"];
const CUSTOMER_GET = ["my_bookings", "auth_me", "my_rentals", "my_payments"];
const CUSTOMER_POST = ["register_customer", "link_guest", "kyc_submit", "kyc_upload_url", "kyc_register"];

test("authz: every admin action requires the admin token", async () => {
  const ctx = setup();
  for (const action of ADMIN_GET) {
    const res = await call(ctx, action);
    assert.equal(res.status, 401, `${action} without token`);
  }
  for (const action of ADMIN_POST) {
    const res = await call(ctx, action, { method: "POST", body: {} });
    assert.equal(res.status, 401, `${action} without token`);
  }
});

test("authz: forged/expired admin tokens rejected", async () => {
  const ctx = setup();
  const forged = `${Date.now() + 3600000}.forgedsignature`;
  const expired = `1.${"a".repeat(43)}`;
  for (const token of [forged, expired, "garbage"]) {
    const res = await call(ctx, "admin_stats", { admin: token });
    assert.equal(res.status, 401);
  }
});

test("authz: customer actions require a customer JWT (except guest create_booking)", async () => {
  const ctx = setup();
  for (const action of CUSTOMER_GET) {
    assert.equal((await call(ctx, action)).status, 401, `${action} without token`);
  }
  for (const action of CUSTOMER_POST) {
    assert.equal((await call(ctx, action, { method: "POST", body: {} })).status, 401, `${action} without token`);
  }
  const guest = await call(ctx, "create_booking", { method: "POST", body: {} });
  assert.equal(guest.status, 400); // guest path open, input validated
});

test("authz: invalid customer JWT rejected on customer endpoints", async () => {
  const ctx = setup(); resetJwksCache();
  const expired = await mintToken({ sub: UUID1, exp: Math.floor(Date.now() / 1000) - 10 });
  assert.equal((await call(ctx, "my_bookings", { customer: expired })).status, 401);
});

test("admin_login: wrong password 401, unconfigured service 503", async () => {
  const ctx = setup();
  assert.equal((await call(ctx, "admin_login", { method: "POST", body: { password: "wrong" } })).status, 401);
  const unconfigured = { supabase: ctx.supabase, env: () => undefined };
  const res = await call(unconfigured, "admin_login", { method: "POST", body: { password: "x" } });
  assert.equal(res.status, 503);
});

test("router: unknown action 404, wrong method 405", async () => {
  const ctx = setup();
  const token = await adminToken(ctx);
  assert.equal((await call(ctx, "no_such_action")).status, 404);
  assert.equal((await call(ctx, "admin_stats", { method: "POST", body: {}, admin: token })).status, 405);
  assert.equal((await call(ctx, "create_booking", { method: "GET" })).status, 405);
});