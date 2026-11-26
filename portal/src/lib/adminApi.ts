import { API_BASE } from "../config";
import { ApiError } from "./api";

// Admin sessions use the HMAC x-admin-token issued by admin_login, kept in localStorage
// with its expiry so a stale token is dropped before it is ever sent.
const TOKEN_KEY = "pg_admin_token";
const EXP_KEY = "pg_admin_exp";

export function getAdminToken(): string | null {
  const tok = localStorage.getItem(TOKEN_KEY);
  const exp = Number(localStorage.getItem(EXP_KEY) ?? "0");
  if (!tok || !Number.isFinite(exp) || exp <= Date.now()) {
    if (tok) clearAdminToken();
    return null;
  }
  return tok;
}

export function setAdminToken(token: string, expiresAt: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EXP_KEY, String(Date.parse(expiresAt)));
}

export function clearAdminToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXP_KEY);
}

export interface AdminApiOptions {
  method?: "GET" | "POST";
  body?: unknown;
  params?: Record<string, string | number | undefined | null>;
  signal?: AbortSignal;
}

export class AdminUnauthorized extends Error {
  constructor() {
    super("unauthorized");
    this.name = "AdminUnauthorized";
  }
}

export async function adminApi<T = unknown>(action: string, opts: AdminApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const token = getAdminToken();
  if (token) headers["x-admin-token"] = token;

  const qs = new URLSearchParams({ action });
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
  }

  const res = await fetch(`${API_BASE}?${qs.toString()}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  const data = (await res.json().catch(() => null)) as T | null;
  if (res.status === 401) {
    clearAdminToken();
    throw new AdminUnauthorized();
  }
  if (!res.ok || data === null) {
    throw new ApiError((data as { error?: string } | null)?.error ?? `request_failed_${res.status}`, res.status);
  }
  return data;
}

export async function adminLogin(password: string): Promise<void> {
  const res = await fetch(`${API_BASE}?action=admin_login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = (await res.json().catch(() => null)) as
    | { token?: string; expires_at?: string; error?: string }
    | null;
  if (!res.ok || !data?.token || !data?.expires_at) {
    throw new Error(data?.error === "invalid_credentials" ? "invalid_credentials" : "login_failed");
  }
  setAdminToken(data.token, data.expires_at);
}

// Password recovery with the enrolled authenticator app (TOTP). The secret is
// enrolled at Admin → Security and stored server-side; codes are verified there.
export async function adminRecover(code: string): Promise<void> {
  const res = await fetch(`${API_BASE}?action=admin_recover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = (await res.json().catch(() => null)) as
    | { token?: string; expires_at?: string; error?: string }
    | null;
  if (!res.ok || !data?.token || !data?.expires_at) {
    throw new Error(data?.error ?? `recover_failed_${res.status}`);
  }
  setAdminToken(data.token, data.expires_at);
}

export interface AdminTotpStatus {
  active: boolean;
  activated_at: string | null;
  pending: boolean;
}

export interface AdminTotpSetup {
  secret: string;
  otpauth_uri: string;
  issuer: string;
  account: string;
  digits: number;
  period: number;
}

export function adminTotpStatus(): Promise<AdminTotpStatus> {
  return adminApi<AdminTotpStatus>("admin_totp_status");
}

export function adminTotpSetup(): Promise<AdminTotpSetup> {
  return adminApi<AdminTotpSetup>("admin_totp_setup", { method: "POST", body: {} });
}

export function adminTotpVerify(code: string): Promise<{ ok: true; active: true; activated_at: string }> {
  return adminApi("admin_totp_verify", { method: "POST", body: { code } });
}
