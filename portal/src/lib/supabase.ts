import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_CONFIGURED } from "../config";

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  tier: "standard" | "premium";
  kyc_status: "none" | "pending" | "verified";
  kyc_id_type: string | null;
  kyc_id_masked: string | null;
  sms_confirmations: boolean;
  loyalty_points: number;
  created_at: string;
}

// Local-dev stand-in so the UI is exercisable before the Supabase project exists.
// Never active in production builds (SUPABASE_CONFIGURED is true there).
export const demoMode = import.meta.env.DEV && !SUPABASE_CONFIGURED;

// Supabase recovery links (implicit flow) land on /reset-password with the
// tokens in the URL fragment. A static page there moves them into sessionStorage
// because HashRouter cannot read the fragment itself.
const RECOVERY_HANDOFF_KEY = "pg_recovery";

export function resetRedirectUrl(): string {
  return `${window.location.origin}/reset-password`;
}

export function takeRecoveryHandoff(): { access_token: string; refresh_token: string } | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(RECOVERY_HANDOFF_KEY);
    if (raw) sessionStorage.removeItem(RECOVERY_HANDOFF_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { access_token?: unknown; refresh_token?: unknown };
    if (typeof parsed.access_token !== "string" || typeof parsed.refresh_token !== "string") return null;
    return { access_token: parsed.access_token, refresh_token: parsed.refresh_token };
  } catch {
    return null;
  }
}

const demoStore = {
  session: null as Session | null,
  profile: null as Profile | null,
};

export function demoGet() {
  return demoStore;
}

export function demoSignIn(email: string, password: string): { error: string | null } {
  if (password.length < 6) return { error: "Invalid login credentials" };
  const id = `demo-${email}`;
  demoStore.session = {
    access_token: `demo-token-${email}`,
    refresh_token: "demo",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id, email, phone: "", user_metadata: { full_name: email.split("@")[0] } },
  } as unknown as Session;
  demoStore.profile = {
    id,
    full_name: (email.split("@")[0] || "Demo Member").replace(/[-_.]/g, " "),
    email,
    phone: "0712345678",
    address: "Sinza, Dar es Salaam",
    tier: "premium",
    kyc_status: "verified",
    kyc_id_type: "nida",
    kyc_id_masked: "19900104-*****",
    sms_confirmations: true,
    loyalty_points: 1250,
    created_at: new Date().toISOString(),
  };
  return { error: null };
}

export function demoSignUp(name: string, email: string): { error: string | null } {
  const r = demoSignIn(email, "demo-password");
  if (!r.error && demoStore.profile) demoStore.profile.full_name = name;
  return r;
}

export function demoSignOut() {
  demoStore.session = null;
  demoStore.profile = null;
}
