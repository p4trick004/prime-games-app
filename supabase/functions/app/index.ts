// Prime Games — Supabase Edge Function entry ("app").
// Deploy name MUST be "app" so the frontend API_BASE "/functions/v1/app" is preserved.
//
// Required Edge Function secrets (set via `supabase secrets set`, NEVER in code):
//   SUPABASE_URL                 e.g. https://poaxanthiifatydqbnqq.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service_role key (bypasses RLS; backend only)
//   ADMIN_PASSWORD               admin HMAC secret (preserved from the Qoder backend)
//   ADMIN_TOTP_SECRET            base32 TOTP secret for admin password recovery
//                                (`node dev/totp-enroll.mjs`). Optional: unset means
//                                admin_recover fails closed with 503.
//
// Required configuration (not secret):
//   CORS_ORIGINS                 comma-separated browser origin allowlist, e.g.
//                                https://<production-site-origin>. Fail-closed:
//                                unset means no browser origin is allowed.
//
// The service_role key is never returned to the browser. Admin authorization is
// enforced in the handler via the ADMIN_PASSWORD HMAC token, not by a DB role.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { handleApi } from "./handler.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

Deno.serve(async (request: Request): Promise<Response> => {
  if (!supabase) {
    return Response.json({ error: "service_not_configured" }, { status: 503 });
  }
  return await handleApi({
    request,
    supabase,
    env: (name: string) => Deno.env.get(name),
  });
});