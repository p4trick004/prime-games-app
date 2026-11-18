// Local-only GoTrue/PostgREST/Storage stand-in so the portal (supabase-js) can
// be browser-tested against the Phase 4 harness without touching production.
// Dev harness only — never deployed, never part of supabase/functions.
import { mintToken } from "./test-auth.mjs";

const b64urlJson = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

export function createAuthStub({ supabase, origin }) {
  const usersByEmail = new Map();
  const usersById = new Map();
  const refreshTokens = new Map(); // refresh_token -> user id
  const objects = new Map(); // `${bucket}/${path}` -> { bytes, mime }

  const gotrueUser = (u) => ({
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email,
    email_confirmed_at: u.created_at, phone: "", confirmed_at: u.created_at,
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: u.user_metadata, identities: [],
    created_at: u.created_at, updated_at: u.created_at,
  });

  async function sessionPayload(u) {
    const nowS = Math.floor(Date.now() / 1000);
    const access_token = await mintToken({ sub: u.id, email: u.email, role: "authenticated" });
    const refresh_token = crypto.randomUUID();
    refreshTokens.set(refresh_token, u.id);
    return {
      access_token, token_type: "bearer", expires_in: 3600, expires_at: nowS + 3600,
      refresh_token, user: gotrueUser(u),
    };
  }

  function createUser(email, password, metadata) {
    const u = {
      id: crypto.randomUUID(), email: email.toLowerCase(), password,
      user_metadata: metadata ?? {}, created_at: new Date().toISOString(),
    };
    usersByEmail.set(u.email, u);
    usersById.set(u.id, u);
    // Mirror the auth.users -> profiles trigger from migration 0001.
    supabase._tables.profiles.push({
      id: u.id,
      full_name: metadata?.full_name || u.email.split("@")[0],
      email: u.email, phone: metadata?.phone ?? null, address: null,
      tier: "standard", kyc_status: "none", kyc_id_type: null, kyc_id_masked: null,
      sms_confirmations: true, loyalty_points: 0, created_at: u.created_at,
    });
    return u;
  }

  const cors = (req) => ({
    "access-control-allow-origin": req.headers.origin ?? origin,
    "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "authorization,apikey,content-type,accept,prefer,x-client-info,x-supabase-api-version",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-max-age": "600",
    vary: "Origin",
  });

  const send = (req, res, status, body, extra = {}) => {
    const headers = { ...cors(req), ...extra };
    if (body === null) { res.writeHead(status, headers); res.end(); return; }
    if (Buffer.isBuffer(body)) { res.writeHead(status, headers); res.end(body); return; }
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

  const eqFilter = (url, col) => {
    const v = url.searchParams.get(col);
    return v?.startsWith("eq.") ? v.slice(3) : null;
  };

  // Returns true when the request was handled.
  return async function handleAuthStub(req, res, url, bodyBuffer) {
    const p = url.pathname;
    const isStub = p.startsWith("/auth/v1/") || p.startsWith("/rest/v1/") || p.startsWith("/storage/v1/");
    if (!isStub || p === "/auth/v1/.well-known/jwks.json") return false;

    if (req.method === "OPTIONS") { send(req, res, 204, null); return true; }
    const bodyText = bodyBuffer.toString("utf8");
    const body = bodyText && (req.headers["content-type"] ?? "").includes("json") ? JSON.parse(bodyText) : {};

    // ---- GoTrue ----
    if (p === "/auth/v1/signup" && req.method === "POST") {
      const email = String(body.email ?? "").toLowerCase();
      if (!email || String(body.password ?? "").length < 6) {
        send(req, res, 422, { code: "validation_failed", msg: "Signup requires a valid email and a password of at least 6 characters" });
        return true;
      }
      if (usersByEmail.has(email)) {
        send(req, res, 422, { code: "user_already_exists", msg: "User already registered" });
        return true;
      }
      const u = createUser(email, body.password, body.data);
      send(req, res, 200, await sessionPayload(u)); // autoconfirm: harness only
      return true;
    }
    if (p === "/auth/v1/token" && req.method === "POST") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const u = usersByEmail.get(String(body.email ?? "").toLowerCase());
        if (!u || u.password !== body.password) {
          send(req, res, 400, { code: "invalid_credentials", msg: "Invalid login credentials" });
          return true;
        }
        send(req, res, 200, await sessionPayload(u));
        return true;
      }
      if (grant === "refresh_token") {
        const id = refreshTokens.get(body.refresh_token);
        refreshTokens.delete(body.refresh_token);
        const u = id && usersById.get(id);
        if (!u) { send(req, res, 400, { code: "refresh_token_not_found", msg: "Invalid Refresh Token" }); return true; }
        send(req, res, 200, await sessionPayload(u));
        return true;
      }
      send(req, res, 400, { code: "unsupported_grant_type", msg: "unsupported grant" });
      return true;
    }
    if (p === "/auth/v1/user" && req.method === "GET") {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /i, "");
      try {
        const claims = b64urlJson(token.split(".")[1]);
        const u = usersById.get(claims.sub);
        if (!u || (claims.exp && claims.exp * 1000 < Date.now())) throw new Error("expired");
        send(req, res, 200, gotrueUser(u));
      } catch {
        send(req, res, 401, { code: "bad_jwt", msg: "invalid JWT" });
      }
      return true;
    }
    if (p === "/auth/v1/logout" && req.method === "POST") {
      send(req, res, 204, null);
      return true;
    }

    // ---- PostgREST: profiles only (the only table the portal reads directly) ----
    if (p === "/rest/v1/profiles") {
      const id = eqFilter(url, "id");
      const rows = supabase._tables.profiles.filter((r) => !id || r.id === id);
      const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object+json");
      if (req.method === "GET") {
        if (wantsObject) {
          if (rows.length !== 1) { send(req, res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }); return true; }
          send(req, res, 200, rows[0]);
        } else {
          send(req, res, 200, rows);
        }
        return true;
      }
      if (req.method === "PATCH") {
        for (const r of rows) Object.assign(r, body);
        if ((req.headers.prefer ?? "").includes("return=representation")) {
          send(req, res, 200, wantsObject ? (rows[0] ?? null) : rows);
        } else {
          send(req, res, 204, null);
        }
        return true;
      }
    }

    // ---- Storage: signed upload + signed read (KYC private bucket) ----
    const up = p.match(/^\/storage\/v1\/object\/upload\/sign\/([^/]+)\/(.+)$/);
    if (up && ["PUT", "POST"].includes(req.method)) {
      let bytes = bodyBuffer;
      let mime = req.headers["content-type"] ?? "application/octet-stream";
      // supabase-js uploadToSignedUrl sends multipart FormData; real Supabase
      // storage extracts the file part — mirror that here.
      if (mime.startsWith("multipart/form-data")) {
        const boundary = mime.split("boundary=")[1];
        for (const seg of bodyBuffer.toString("latin1").split(`--${boundary}`)) {
          if (!/name="file"/.test(seg)) continue;
          const headerEnd = seg.indexOf("\r\n\r\n");
          if (headerEnd === -1) continue;
          const mimeMatch = seg.match(/Content-Type:\s*([^\r\n]+)/i);
          bytes = Buffer.from(seg.slice(headerEnd + 4, seg.lastIndexOf("\r\n")), "latin1");
          mime = mimeMatch ? mimeMatch[1].trim() : "application/octet-stream";
          break;
        }
      }
      objects.set(`${up[1]}/${up[2]}`, { bytes, mime });
      send(req, res, 200, { Key: `${up[1]}/${up[2]}` });
      return true;
    }
    const down = p.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/);
    if (down && req.method === "GET") {
      const obj = objects.get(`${down[1]}/${down[2]}`);
      if (!obj) { send(req, res, 404, { statusCode: "404", error: "Not found", message: "Object not found" }); return true; }
      send(req, res, 200, obj.bytes, { "content-type": obj.mime });
      return true;
    }

    send(req, res, 404, { message: `auth-stub: no route for ${req.method} ${p}` });
    return true;
  };
}