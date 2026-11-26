// Best-effort throttle for credential endpoints (admin password + TOTP code).
// Edge isolates are ephemeral and per-instance, so this raises the cost of
// online guessing rather than guaranteeing a global limit.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_KEYS = 2000;

const failures = new Map();

export function clientKey(request, scope) {
  const h = request.headers;
  const ip = h.get("cf-connecting-ip")
    || h.get("x-real-ip")
    || (h.get("x-forwarded-for") || "").split(",")[0].trim()
    || "unknown";
  return `${scope}:${ip}`;
}

export function throttleStatus(key, max, now = Date.now()) {
  const list = (failures.get(key) ?? []).filter((t) => t > now - WINDOW_MS);
  if (list.length === 0) failures.delete(key);
  else failures.set(key, list);
  if (list.length < max) return { blocked: false, retryAfterSec: 0 };
  const retryMs = list[0] + WINDOW_MS - now;
  return { blocked: true, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)) };
}

export function recordFailure(key, now = Date.now()) {
  const list = failures.get(key) ?? [];
  list.push(now);
  failures.set(key, list);
  if (failures.size > MAX_KEYS) {
    const cutoff = now - WINDOW_MS;
    for (const [k, v] of failures) {
      const kept = v.filter((t) => t > cutoff);
      if (kept.length > 0) failures.set(k, kept);
      else failures.delete(k);
    }
  }
}

export function clearThrottle(key) {
  failures.delete(key);
}

export function resetThrottle() {
  failures.clear();
}