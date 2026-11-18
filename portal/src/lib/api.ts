import { API_BASE } from "../config";

// Error with the backend's {error} code and HTTP status so callers can branch
// on e.g. 402 credit_limit_exceeded or 403 customer_not_active.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface ApiOptions {
  method?: "GET" | "POST";
  body?: unknown;
  token?: string | null;
  params?: Record<string, string | number | undefined | null>;
}

export async function api<T = unknown>(action: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers["x-supabase-token"] = opts.token;
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
  });
  const data = (await res.json().catch(() => null)) as T | null;
  if (!res.ok || data === null) {
    throw new ApiError((data as { error?: string } | null)?.error ?? `request_failed_${res.status}`, res.status);
  }
  return data;
}