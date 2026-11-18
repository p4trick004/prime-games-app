// Shared fixtures for the Phase 4 backend test suite (local fake DB only).
import { handleApi } from "../../supabase/functions/app/handler.mjs";
import { configureAuth } from "../../supabase/functions/app/lib/core.mjs";
import { createFakeSupabase } from "../edge-fake.mjs";
import { setTestIssuer, testJwksUrl, testKeys } from "../test-auth.mjs";
import { makeRef } from "../../supabase/functions/app/lib/pricing.mjs";

export const ADMIN_PASSWORD = "test-admin-password";
export const ORIGIN = "https://portal.test";
export const ISSUER = "https://auth.test";

export function setup() {
  setTestIssuer(ISSUER);
  configureAuth({ issuer: ISSUER, jwksUrl: testJwksUrl() });
  const supabase = createFakeSupabase();
  const values = { ADMIN_PASSWORD, CORS_ORIGINS: ORIGIN };
  return { supabase, env: (n) => values[n] };
}

// Serve the test JWKS through a fetch stub; `state.keys` can be swapped to
// simulate signing-key rotation, `state.fetches` counts JWKS requests.
export function installJwksStub() {
  const state = { fetches: 0, keys: null };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) === testJwksUrl()) {
      state.fetches += 1;
      const keys = state.keys ?? [(await testKeys()).publicJwk];
      return Response.json({ keys });
    }
    return realFetch(input, init);
  };
  return state;
}

export async function call(ctx, action, opts = {}) {
  const { method = "GET", body, params = {}, admin, customer, origin = ORIGIN, headers = {} } = opts;
  const qs = new URLSearchParams({ action, ...params });
  const h = { ...headers };
  if (origin) h.origin = origin;
  if (body !== undefined) h["content-type"] = "application/json";
  if (admin) h["x-admin-token"] = admin;
  if (customer) h["x-supabase-token"] = customer;
  const request = new Request(`https://api.test/functions/v1/app?${qs.toString()}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await handleApi({ request, supabase: ctx.supabase, env: ctx.env });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* non-JSON (e.g. 204) */ }
  return { status: res.status, body: parsed, headers: res.headers };
}

export async function adminToken(ctx) {
  const res = await call(ctx, "admin_login", { method: "POST", body: { password: ADMIN_PASSWORD }, origin: null });
  if (!res.body?.token) throw new Error(`admin_login failed: ${res.status}`);
  return res.body.token;
}

export async function seed(ctx, table, row) {
  const { data, error } = await ctx.supabase.from(table).insert(row);
  if (error) throw new Error(`seed ${table}: ${JSON.stringify(error)}`);
  return data;
}

export function bookingFields(customerId, over = {}) {
  return {
    id: crypto.randomUUID(), ref: makeRef(), customer_id: customerId,
    zone_key: "goba", address: "Test address 1", package_key: "starter", days: 1,
    start_date: "2026-12-01", start_time: "10:00", id_type: "nida", id_number: "12345678",
    ec_name: "Emergency Contact", ec_phone: "255712345678", payment_method: "mpesa",
    rental_amount: 25000, discount: 0, delivery_fee: 6000, total: 31000,
    ...over,
  };
}

export const guestBookingBody = (over = {}) => ({
  package: "starter", zone: "goba", days: 1, name: "Guest Customer", phone: "0712345678",
  address: "Test address 1", start_date: "2026-12-01", start_time: "10:00",
  id_type: "nida", id_number: "12345678", ec_name: "Emergency Contact", ec_phone: "0712345679",
  payment_method: "mpesa", ...over,
});