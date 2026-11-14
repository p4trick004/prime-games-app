// Supabase project credentials are public by design (RLS enforces access).
// Replaced with real values once the project is provisioned.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://PLACEHOLDER.supabase.co";
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "PLACEHOLDER-ANON-KEY";
export const SUPABASE_CONFIGURED = !SUPABASE_URL.includes("PLACEHOLDER");

export const API_BASE = "/functions/v1/app";
export const WHATSAPP_NUMBER = "255613138426";
export const SITE_ROOT = "/";
