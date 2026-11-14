// Local-only dev harness: serves web/ and runs the real business handler
// against an in-memory fixture database. Not part of the deployment package.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { handleApi } from "../functions/handler.mjs";

const WEB_ROOT = join(import.meta.dirname, "..", "web");
const PORT = Number(process.argv[2] || 4174);
const ENV = { ADMIN_PASSWORD: "local-test-admin" }; // fixture credential, local only

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

// ---- in-memory fixture supabase ----
const tables = { bookings: [], consoles: [], maintenance: [], games: [], transactions: [], incidents: [] };
const UNIQUE = {
  bookings: ["id", "ref"],
  consoles: ["id", "unit_code"],
  maintenance: ["id"],
  games: ["id"],
  transactions: ["id", "ref"],
  incidents: ["id", "ref"],
};

class Builder {
  constructor(table, mode) {
    this.table = table; this.mode = mode;
    this.filters = []; this.orders = [];
    this.rangeSpec = null; this.limitN = null; this.countExact = false;
    this.insertRow = null; this.updateFields = null; this.selectCols = null;
    this.singleMode = null;
  }
  select(cols, opts) { this.selectCols = cols; if (opts?.count === "exact") this.countExact = true; return this; }
  eq(col, val) { this.filters.push([col, val]); return this; }
  order(col, opts) { this.orders.push([col, opts?.ascending !== false]); return this; }
  range(a, b) { this.rangeSpec = [a, b]; return this; }
  limit(n) { this.limitN = n; return this; }
  insert(row) { this.insertRow = row; return this; }
  update(fields) { this.updateFields = fields; return this; }
  single() { this.singleMode = "single"; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  matches(row) { return this.filters.every(([c, v]) => row[c] === v); }
  rows() { return tables[this.table]; }
  run() {
    if (this.mode === "insert") {
      const keys = UNIQUE[this.table] || ["id"];
      const dup = this.rows().some((r) => keys.some((k) => this.insertRow[k] !== undefined && r[k] === this.insertRow[k]));
      if (dup) return { data: null, error: { code: "23505", message: "duplicate" } };
      this.rows().push({ ...this.insertRow });
      return { data: { ...this.insertRow }, error: null };
    }
    if (this.mode === "update") {
      const hit = this.rows().find((r) => this.matches(r));
      if (!hit) return { data: null, error: null };
      Object.assign(hit, this.updateFields);
      return { data: { ...hit }, error: null };
    }
    let rows = this.rows().filter((r) => this.matches(r));
    for (const [col, asc] of [...this.orders].reverse()) {
      rows = rows.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
    }
    const count = rows.length;
    if (this.rangeSpec) rows = rows.slice(this.rangeSpec[0], this.rangeSpec[1] + 1);
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return { data: rows.map((r) => ({ ...r })), error: null, count };
  }
  then(resolve, reject) {
    try {
      const result = this.run();
      // Real supabase-js unwraps .single()/.maybeSingle() on a select to one object
      // (or null). insert/update already resolve to a single object, so only unwrap arrays.
      if (this.singleMode && Array.isArray(result.data)) {
        const row = result.data[0] ?? null;
        if (!row && this.singleMode === "single") {
          resolve({ data: null, error: result.error ?? { code: "PGRST116", message: "no rows" } });
        } else {
          resolve({ data: row, error: result.error, count: result.count });
        }
        return;
      }
      if (this.singleMode === "single" && (!result.data || result.error)) {
        resolve({ data: null, error: result.error ?? { code: "PGRST116", message: "no rows" } });
      } else if (this.countExact) {
        resolve({ data: result.data, error: result.error, count: result.count });
      } else {
        resolve(result);
      }
    } catch (e) { reject(e); }
  }
}

const fakeSupabase = {
  from(table) {
    if (!Object.hasOwn(tables, table)) throw new Error(`unexpected table ${table}`);
    return {
      select: (cols, opts) => new Builder(table, "select").select(cols, opts),
      insert: (row) => new Builder(table, "insert").insert(row),
      update: (fields) => new Builder(table, "update").update(fields),
    };
  },
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname.startsWith("/functions/v1/app")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString("utf8");
    const request = new Request(url.toString(), {
      method: req.method,
      headers: Object.entries(req.headers).filter(([k, v]) => typeof v === "string"),
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
    });
    const response = await handleApi({ request, supabase: fakeSupabase, env: (n) => ENV[n] });
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(await response.text());
    return;
  }
  let path = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
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
  console.log(`Prime Games dev server: http://127.0.0.1:${PORT}/ (admin: /admin.html, fixture password: ${ENV.ADMIN_PASSWORD})`);
});
