// Shared primitives for the Prime Games Edge Function (runtime-agnostic: Deno + Node).
// Ported from functions/handler.mjs and extended for the Phase 3 customer-centred schema.

export const MAX_BODY = 20000;
export const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

// Public project issuer (like the anon key, this is not a secret).
export const SUPABASE_AUTH_ISSUER = "https://poaxanthiifatydqbnqq.supabase.co";
export const JWKS_URL = `${SUPABASE_AUTH_ISSUER}/auth/v1/.well-known/jwks.json`;
export const JWKS_TTL_MS = 10 * 60 * 1000;

// Local test harnesses point auth at a fixture JWKS; production uses the defaults.
let authConfig = { issuer: SUPABASE_AUTH_ISSUER, jwksUrl: JWKS_URL };
export function configureAuth({ issuer, jwksUrl } = {}) {
  authConfig = {
    issuer: typeof issuer === "string" && issuer ? issuer : SUPABASE_AUTH_ISSUER,
    jwksUrl: typeof jwksUrl === "string" && jwksUrl ? jwksUrl : JWKS_URL,
  };
}
export const authIssuer = () => authConfig.issuer;
export const jwksUrl = () => authConfig.jwksUrl;

export const CORS_HEADERS = {
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-supabase-token, x-admin-token, authorization, apikey",
  "access-control-max-age": "86400",
};

// Fail-closed: no ACAO header unless the request Origin is in CORS_ORIGINS
// (comma-separated allowlist, set as edge-function config at deploy time).
export function corsOriginHeaders(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  const allowed = String(env?.("CORS_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return { "access-control-allow-origin": origin, vary: "Origin" };
}

export function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...CORS_HEADERS },
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function readJsonBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// Map Postgres RPC exceptions to the API {error,status} contract. `overrides`
// maps message needles to HTTP statuses for call-site-specific conflicts.
export function rpcFailure(error, overrides = {}) {
  const msg = String(error?.message ?? "");
  for (const [needle, status] of Object.entries(overrides)) {
    if (msg.includes(needle)) return { error: needle, status };
  }
  if (msg.includes("invalid_input")) return { error: "invalid_input", status: 400 };
  if (msg.includes("credit_limit_exceeded")) return { error: "credit_limit_exceeded", status: 402 };
  if (msg.includes("customer_not_active")) return { error: "customer_not_active", status: 403 };
  const notFound = msg.match(/[a-z_]*not_found/);
  if (notFound) return { error: notFound[0], status: 404 };
  if (error?.code === "23505") return { error: "duplicate", status: 409 };
  return { error: "database_request_failed", status: 503 };
}

// ---- Business vocabularies (mirror the Phase 3 CHECK constraints) ----
export const RATES = { starter: 25000, weekend: 50000, night: 15000 };
export const ZONE_FEES = { goba: 6000, sinza: 8000, mbezi: 8000, kigamboni: 10000, magomeni: 10000, oyster: 10000, other: null };
export const ID_TYPES = ["nida", "licence", "passport"];
export const PAYMENT_METHODS = ["mpesa", "cod"];
export const STATUSES = ["pending", "confirmed", "delivered", "completed", "cancelled"];
export const PAYMENT_STATUSES = ["unpaid", "paid"];

export const CONSOLE_STATUSES = ["available", "rented", "maintenance", "retired"];
export const CONSOLE_CONDITIONS = ["excellent", "good", "fair", "poor"];
export const MAINT_STATUSES = ["open", "in_progress", "resolved"];
export const MAINT_PRIORITIES = ["low", "medium", "high", "critical"];
export const GAME_STATUSES = ["available", "rented", "retired"];
export const GAME_PLATFORMS = ["ps5", "ps4"];
export const GAME_FORMATS = ["disc", "digital"];
// payments.kind adds 'adjustment' (append-only corrections); the legacy UI treats kind as free text.
export const TXN_METHODS = ["mpesa", "cod", "cash", "bank"];
export const TXN_KINDS = ["rental", "deposit", "refund", "damage_fee", "late_fee", "adjustment", "other"];
export const TXN_STATUSES = ["settled", "pending", "failed", "refunded"];
export const INCIDENT_KINDS = ["damage", "loss", "theft", "late_return", "malfunction", "other"];
export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"];
export const INCIDENT_STATUSES = ["open", "investigating", "resolved", "waived"];

export const CUSTOMER_TIERS = ["basic", "standard", "premium"];
export const CUSTOMER_STATUSES = ["active", "suspended", "blacklisted"];
export const RENTAL_STATUSES = ["scheduled", "active", "returned", "overdue", "cancelled"];
export const KYC_DOC_TYPES = ["nida", "licence", "passport", "selfie", "proof_of_address", "other"];
export const KYC_DOC_STATUSES = ["pending", "verified", "rejected", "expired"];
export const KYC_ACTIONS = ["uploaded", "verified", "rejected", "expired", "viewed"];
export const LINK_METHODS = ["otp", "admin_assisted", "registration", "document"];
export const LINK_STATUSES = ["pending", "linked", "rejected", "conflict"];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const ID_NUMBER_RE = /^[\w\-/. ]+$/;

// ---- Scalar validators ----
export function str(v, min, max) {
  return typeof v === "string" && v.trim().length >= min && v.trim().length <= max ? v.trim() : null;
}

export function normalizePhone(raw) {
  if (typeof raw !== "string") return null;
  const m = raw.replace(/[\s\-()]/g, "").match(/^(\+?255|0)([67]\d{8})$/);
  return m ? "255" + m[2] : null;
}

export function eatToday() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ---- Optional-field collectors (presence / invalid / clear semantics) ----
export function optStr(v, min, max) {
  if (v === undefined) return { set: false };
  if (v === null) return { set: true, value: null };
  if (typeof v !== "string") return { set: true, invalid: true };
  const t = v.trim();
  if (t === "") return { set: true, value: null };
  if (t.length < min || t.length > max) return { set: true, invalid: true };
  return { set: true, value: t };
}
export function optInt(v, min, max) {
  if (v === undefined) return { set: false };
  if (v === null || v === "") return { set: true, value: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return { set: true, invalid: true };
  return { set: true, value: n };
}
export function optIso(v) {
  if (v === undefined) return { set: false };
  if (v === null || v === "") return { set: true, value: null };
  if (typeof v !== "string") return { set: true, invalid: true };
  const t = Date.parse(v);
  if (Number.isNaN(t)) return { set: true, invalid: true };
  return { set: true, value: new Date(t).toISOString() };
}
export function optEnum(v, allowed) {
  if (v === undefined) return { set: false };
  if (v === null) return { set: true, value: null };
  if (typeof v !== "string" || !allowed.includes(v)) return { set: true, invalid: true };
  return { set: true, value: v };
}
export function optUuid(v) {
  if (v === undefined || v === null || v === "") return { set: true, value: null };
  if (typeof v !== "string" || !UUID_RE.test(v)) return { set: true, invalid: true };
  return { set: true, value: v };
}
export function collectFields(body, spec) {
  const fields = {};
  for (const name of Object.keys(spec)) {
    if (body[name] === undefined) continue;
    const rule = spec[name];
    let res;
    if (rule.type === "str") res = optStr(body[name], rule.min, rule.max);
    else if (rule.type === "int") res = optInt(body[name], rule.min, rule.max);
    else if (rule.type === "iso") res = optIso(body[name]);
    else if (rule.type === "enum") res = optEnum(body[name], rule.allowed);
    else res = { set: true, invalid: true };
    if (res.invalid) return { error: true };
    fields[name] = res.value;
  }
  return { fields };
}
export function hasRequired(fields, names) {
  return names.every((n) => fields[n] !== undefined && fields[n] !== null);
}