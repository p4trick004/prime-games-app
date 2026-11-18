// Local-only harness for the PHASE 4 backend (supabase/functions/app) against
// the in-memory Phase 3 fixture (edge-fake.mjs). Serves web/, the API and a
// test JWKS so customer JWT flows can be exercised in a browser.
// Not part of the deployment package. Never connects to a real database.
//
//   node dev/edge-server.mjs [port]        (default 4175)
//   admin password: local-test-admin       (fixture credential, local only)
//   customer token: node dev/mint-token.mjs <auth-user-uuid>
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { handleApi } from "../supabase/functions/app/handler.mjs";
import { configureAuth } from "../supabase/functions/app/lib/core.mjs";
import { createFakeSupabase, setFakeStorageOrigin } from "./edge-fake.mjs";
import { setTestIssuer, testJwksUrl, testJwksResponse } from "./test-auth.mjs";
import { createAuthStub } from "./auth-stub.mjs";

const PORT = Number(process.argv[2] || 4175);
const WEB_ROOT = join(import.meta.dirname, "..", "web");
const ENV = {
  ADMIN_PASSWORD: "local-test-admin",
  // Harness only: the vite portal dev server (4175) proxies /functions here.
  CORS_ORIGINS: [PORT, 4175].flatMap((p) => [`http://127.0.0.1:${p}`, `http://localhost:${p}`]).join(","),
};

setTestIssuer(`http://127.0.0.1:${PORT}`);
configureAuth({ issuer: `http://127.0.0.1:${PORT}`, jwksUrl: testJwksUrl() });
setFakeStorageOrigin(`http://127.0.0.1:${PORT}`);
const supabase = createFakeSupabase();
const handleAuthStub = createAuthStub({ supabase, origin: `http://127.0.0.1:${PORT}` });

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const bodyBuffer = Buffer.concat(chunks);
  if (await handleAuthStub(req, res, url, bodyBuffer)) return;
  if (url.pathname === "/auth/v1/.well-known/jwks.json") {
    const jwks = await testJwksResponse();
    res.writeHead(jwks.status, Object.fromEntries(jwks.headers.entries()));
    res.end(await jwks.text());
    return;
  }
  if (url.pathname.startsWith("/functions/v1/app")) {
    const body = bodyBuffer.toString("utf8");
    const request = new Request(url.toString(), {
      method: req.method,
      headers: Object.entries(req.headers).filter(([, v]) => typeof v === "string"),
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
    });
    const response = await handleApi({ request, supabase, env: (n) => ENV[n] });
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(await response.text());
    return;
  }
  const path = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
  let file;
  try {
    file = await readFile(join(WEB_ROOT, path));
  } catch {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(path).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(file);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Prime Games PHASE 4 dev server: http://127.0.0.1:${PORT}/ (admin: /admin.html, fixture password: ${ENV.ADMIN_PASSWORD})`);
});