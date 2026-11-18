// Authentication: admin HMAC tokens (preserved unchanged) + Supabase customer JWT (ES256).
import { json, UUID_RE, TOKEN_TTL_MS, authIssuer, jwksUrl, JWKS_TTL_MS } from "./core.mjs";

export async function hmacSign(password, message) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let jwksCache = { keys: null, at: 0 };

export function resetJwksCache() {
  jwksCache = { keys: null, at: 0 };
}

async function getSigningKeys(force = false) {
  const now = Date.now();
  if (!force && jwksCache.keys && now - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(jwksUrl());
  if (!res.ok) throw new Error("jwks_unavailable");
  const data = await res.json();
  jwksCache = { keys: Array.isArray(data.keys) ? data.keys : [], at: now };
  return jwksCache.keys;
}

// Verify a Supabase auth JWT (ES256/P-256). Returns claims, or null if invalid.
export async function verifySupabaseJwt(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
  } catch {
    return null;
  }
  if (!header || header.alg !== "ES256") return null;
  if (typeof header.kid !== "string" || !header.kid) return null;
  // Strict kid match only; one forced refetch covers signing-key rotation.
  let keys = await getSigningKeys();
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await getSigningKeys(true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256") return null;
  let cryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true, key_ops: ["verify"] },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let ok = false;
  try {
    ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, cryptoKey, b64urlToBytes(parts[2]), signed);
  } catch {
    return null;
  }
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
  if (payload.aud !== "authenticated") return null;
  const issuer = authIssuer();
  if (payload.iss !== issuer && payload.iss !== `${issuer}/auth/v1`) return null;
  if (typeof payload.sub !== "string" || !UUID_RE.test(payload.sub)) return null;
  return payload;
}

// Resolve the signed-in customer from x-supabase-token, or null for guests.
export async function currentUser(request) {
  const token = request.headers.get("x-supabase-token");
  if (!token) return null;
  try {
    return await verifySupabaseJwt(token);
  } catch {
    return null;
  }
}

// Returns null when authorized; otherwise a Response to send back.
export async function requireAdmin(request, env) {
  const password = env("ADMIN_PASSWORD");
  if (!password) return json({ error: "service_not_configured" }, 503);
  const token = request.headers.get("x-admin-token");
  if (typeof token !== "string") return json({ error: "unauthorized" }, 401);
  const dot = token.indexOf(".");
  if (dot <= 0) return json({ error: "unauthorized" }, 401);
  const exp = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isSafeInteger(exp) || exp < Date.now()) return json({ error: "unauthorized" }, 401);
  const expected = await hmacSign(password, `primegames-admin:${exp}`);
  if (!safeEqual(sig, expected)) return json({ error: "unauthorized" }, 401);
  return null;
}

export async function issueAdminToken(password) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const sig = await hmacSign(password, `primegames-admin:${exp}`);
  return { token: `${exp}.${sig}`, expires_at: new Date(exp).toISOString() };
}