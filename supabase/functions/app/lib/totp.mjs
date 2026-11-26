// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) for admin access recovery.
// WebCrypto only, so it runs unchanged on Deno and Node (dev harness/tests).

export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return out.length > 0 ? new Uint8Array(out) : null;
}

function stepBytes(step) {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(step));
  return buf;
}

async function hmacSha1(keyBytes, messageBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, messageBytes));
}

async function codeAt(secretBytes, step) {
  const digest = await hmacSha1(secretBytes, stepBytes(step));
  const offset = digest[digest.length - 1] & 0x0f;
  const bin = ((digest[offset] & 0x7f) << 24)
    | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8)
    | digest[offset + 3];
  return String(bin % 1_000_000).padStart(TOTP_DIGITS, "0");
}

export async function generateTotp(base32Secret, nowMs = Date.now()) {
  const secret = base32Decode(base32Secret);
  if (!secret) return null;
  return codeAt(secret, Math.floor(nowMs / 1000 / TOTP_PERIOD));
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Accepts the current step plus ±1 step for clock skew, like authenticator apps.
export async function verifyTotp(base32Secret, code, { nowMs = Date.now(), window = 1 } = {}) {
  if (typeof base32Secret !== "string" || !base32Secret) return false;
  const normalized = typeof code === "string" ? code.replace(/[\s-]/g, "") : "";
  if (!/^\d{6}$/.test(normalized)) return false;
  const secret = base32Decode(base32Secret);
  if (!secret) return false;
  const step = Math.floor(nowMs / 1000 / TOTP_PERIOD);
  let ok = false;
  for (let i = -window; i <= window; i += 1) {
    if (timingSafeEqual(await codeAt(secret, step + i), normalized)) ok = true;
  }
  return ok;
}