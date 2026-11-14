import { API_BASE } from "../config";

export interface ApiOptions {
  method?: "GET" | "POST";
  body?: unknown;
  token?: string | null;
}

export async function api<T = unknown>(action: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers["x-supabase-token"] = opts.token;
  const res = await fetch(`${API_BASE}?action=${encodeURIComponent(action)}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as T | null;
  if (!res.ok || data === null) {
    throw new Error((data as { error?: string } | null)?.error ?? `request_failed_${res.status}`);
  }
  return data;
}
