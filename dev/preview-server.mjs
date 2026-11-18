// Dev-only static preview of the integrated Vercel layout. Serves an assembled
// site directory and proxies API/auth/storage to the local harness (4174), so
// the full public-site + portal journey is testable with zero production writes.
// Usage: node dev/preview-server.mjs <site-dir> [port]
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname, resolve } from "node:path";

const ROOT = resolve(process.argv[2] || "../pg-preview");
const PORT = Number(process.argv[3] || 4176);
const HARNESS = "http://127.0.0.1:4174";
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".json": "application/json", ".woff2": "font/woff2", ".ico": "image/x-icon",
};

const tryRead = async (f) => { try { return await readFile(f); } catch { return null; } };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p.startsWith("/functions/") || p.startsWith("/auth/") || p.startsWith("/rest/") || p.startsWith("/storage/")) {
    const headers = { ...req.headers, host: "127.0.0.1:4174" };
    delete headers["accept-encoding"];
    const upstream = await fetch(HARNESS + req.url, {
      method: req.method, headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
      duplex: "half",
    });
    const out = {};
    upstream.headers.forEach((v, k) => { if (!["content-encoding", "content-length", "transfer-encoding"].includes(k)) out[k] = v; });
    res.writeHead(upstream.status, out);
    res.end(Buffer.from(await upstream.arrayBuffer()));
    return;
  }

  // Qoder-style portal links still resolve inside the preview.
  if (p === "/app" || p === "/app/" || p === "/app/index.html") {
    res.writeHead(302, { location: "/portal/" + (url.hash || "") });
    res.end();
    return;
  }

  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  let served = file;
  let bytes = await tryRead(served);
  if (!bytes) { served = join(file, "index.html"); bytes = await tryRead(served); }
  if (!bytes && !extname(file)) { served = file + ".html"; bytes = await tryRead(served); }
  if (!bytes) { res.writeHead(404, { "content-type": "text/plain" }); res.end("preview: not found"); return; }
  res.writeHead(200, { "content-type": MIME[extname(served).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(bytes);
});

server.listen(PORT, () => console.log(`preview: ${ROOT} -> http://localhost:${PORT}/ (API proxied to ${HARNESS})`));