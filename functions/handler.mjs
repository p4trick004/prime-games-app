// Prime Games bookings API. Business handler for the bundled anonymous adapter.
// Routes are selected with the `action` query parameter; never trust browser-computed money.

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store" },
});

const RATES = { starter: 25000, weekend: 50000, night: 15000 };
const ZONE_FEES = { goba: 6000, sinza: 8000, mbezi: 8000, kigamboni: 10000, magomeni: 10000, oyster: 10000, other: null };
const ID_TYPES = ["nida", "licence", "passport"];
const PAYMENT_METHODS = ["mpesa", "cod"];
const STATUSES = ["pending", "confirmed", "delivered", "completed", "cancelled"];
const PAYMENT_STATUSES = ["unpaid", "paid"];

// Admin-managed entity vocabularies. Values are stored verbatim; the UI maps them to labels.
const CONSOLE_STATUSES = ["available", "rented", "maintenance", "retired"];
const CONSOLE_CONDITIONS = ["excellent", "good", "fair", "poor"];
const MAINT_STATUSES = ["open", "in_progress", "resolved"];
const MAINT_PRIORITIES = ["low", "medium", "high", "critical"];
const GAME_STATUSES = ["available", "rented", "retired"];
const GAME_PLATFORMS = ["ps5", "ps4"];
const GAME_FORMATS = ["disc", "digital"];
const TXN_METHODS = ["mpesa", "cod", "cash", "bank"];
const TXN_KINDS = ["rental", "deposit", "refund", "damage_fee", "late_fee", "other"];
const TXN_STATUSES = ["settled", "pending", "failed", "refunded"];
const INCIDENT_KINDS = ["damage", "loss", "theft", "late_return", "malfunction", "other"];
const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"];
const INCIDENT_STATUSES = ["open", "investigating", "resolved", "waived"];

const CONSOLE_COLUMNS = "id,unit_code,model,serial_number,status,condition_grade,current_renter,rentals_count,last_audit_at,purchased_at,notes,created_at";
const MAINT_COLUMNS = "id,console_id,unit_code,issue,status,priority,engineer,cost,notes,opened_at,resolved_at,created_at";
const GAME_COLUMNS = "id,title,platform,genre,media_format,cover_url,status,created_at";
const TXN_COLUMNS = "id,ref,booking_id,booking_ref,customer_name,customer_phone,amount,method,kind,status,notes,occurred_at,created_at";
const INCIDENT_COLUMNS = "id,ref,booking_id,booking_ref,console_id,unit_code,customer_name,customer_phone,kind,severity,status,description,claim_amount,resolved_amount,occurred_at,created_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY = 20000;

// Customer auth lives in a separate Supabase project (public issuer URL, like the anon key).
// Bookings stay in the managed DB; we verify the Supabase JWT to stamp bookings with user_id.
const SUPABASE_AUTH_ISSUER = "https://poaxanthiifatydqbnqq.supabase.co";
const JWKS_URL = `${SUPABASE_AUTH_ISSUER}/auth/v1/.well-known/jwks.json`;
const JWKS_TTL_MS = 10 * 60 * 1000;

const BOOKING_COLUMNS = "id,ref,customer_name,customer_phone,zone_key,address,package_key,days,start_date,start_time,id_type,id_number,ec_name,ec_phone,payment_method,rental_amount,discount,delivery_fee,total,status,payment_status,notes,console_id,created_at";

function str(v, min, max) {
  return typeof v === "string" && v.trim().length >= min && v.trim().length <= max ? v.trim() : null;
}

function normalizePhone(raw) {
  if (typeof raw !== "string") return null;
  const m = raw.replace(/[\s\-()]/g, "").match(/^(\+?255|0)([67]\d{8})$/);
  return m ? "255" + m[2] : null;
}

function eatToday() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function starterDiscount(days) {
  if (days >= 5) return 10000;
  if (days === 4) return 7000;
  if (days === 3) return 5000;
  return 0;
}

function priceBooking(packageKey, days, zoneKey) {
  let base, discount = 0, freeDelivery = false;
  if (packageKey === "starter") {
    base = RATES.starter * days;
    discount = starterDiscount(days);
    freeDelivery = days >= 2;
  } else if (packageKey === "weekend") {
    base = RATES.weekend;
    freeDelivery = true;
  } else {
    base = RATES.night * days;
  }
  const rental = base - discount;
  const delivery = freeDelivery ? 0 : ZONE_FEES[zoneKey]; // null = to be agreed with rider
  return { rental, discount, delivery, total: rental + (delivery ?? 0) };
}

function makeCode(prefix) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return `${prefix}${code}`;
}

function makeRef() {
  return makeCode("PG-");
}

async function hmacSign(password, message) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readJsonBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let jwksCache = { keys: null, at: 0 };

async function getSigningKeys() {
  const now = Date.now();
  if (jwksCache.keys && now - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error("jwks_unavailable");
  const data = await res.json();
  jwksCache = { keys: Array.isArray(data.keys) ? data.keys : [], at: now };
  return jwksCache.keys;
}

// Verify a Supabase auth JWT (ES256/P-256). Returns the payload claims, or null if invalid.
async function verifySupabaseJwt(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
  } catch {
    return null;
  }
  if (!header || header.alg !== "ES256") return null;
  const keys = await getSigningKeys();
  const jwk = keys.find((k) => k.kid === header.kid)
    ?? keys.find((k) => k.kty === "EC" && k.crv === "P-256");
  if (!jwk) return null;
  let cryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true, key_ops: ["verify"] },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let ok = false;
  try {
    ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, cryptoKey, b64urlToBytes(parts[2]), signed);
  } catch {
    return null;
  }
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < nowSec) return null;
  if (payload.aud !== "authenticated") return null;
  if (payload.iss !== SUPABASE_AUTH_ISSUER && payload.iss !== `${SUPABASE_AUTH_ISSUER}/auth/v1`) return null;
  if (typeof payload.sub !== "string" || !UUID_RE.test(payload.sub)) return null;
  return payload;
}

// Resolve the signed-in customer from the x-supabase-token header, or null for guests.
async function currentUser(request) {
  const token = request.headers.get("x-supabase-token");
  if (!token) return null;
  try {
    return await verifySupabaseJwt(token);
  } catch {
    return null;
  }
}

// Returns null when authorized; otherwise a Response to send back.
async function requireAdmin(request, env) {
  const password = env("ADMIN_PASSWORD");
  if (!password) return json({ error: "service_not_configured" }, 503);
  const token = request.headers.get("x-admin-token");
  if (typeof token !== "string") return json({ error: "unauthorized" }, 401);
  const dot = token.indexOf(".");
  if (dot <= 0) return json({ error: "unauthorized" }, 401);
  const exp = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isSafeInteger(exp) || exp < Date.now()) return json({ error: "unauthorized" }, 401);
  const expected = await hmacSign(password, `primegames-admin:${exp}`);
  if (!safeEqual(sig, expected)) return json({ error: "unauthorized" }, 401);
  return null;
}

async function handleCreateBooking(request, supabase) {
  const body = await readJsonBody(request);
  if (!body) return json({ error: "invalid_input" }, 400);

  const packageKey = typeof body.package === "string" && Object.hasOwn(RATES, body.package) ? body.package : null;
  if (!packageKey) return json({ error: "invalid_input" }, 400);
  const zoneKey = typeof body.zone === "string" && Object.hasOwn(ZONE_FEES, body.zone) ? body.zone : null;
  if (!zoneKey) return json({ error: "invalid_input" }, 400);

  const days = Number(body.days);
  if (!Number.isInteger(days) || days < 1 || days > 30) return json({ error: "invalid_input" }, 400);
  if (packageKey === "weekend" && days !== 1) return json({ error: "invalid_input" }, 400);

  const name = str(body.name, 2, 120);
  const phone = normalizePhone(body.phone);
  const address = str(body.address, 3, 200);
  const startDate = typeof body.start_date === "string" && DATE_RE.test(body.start_date)
    && !Number.isNaN(Date.parse(`${body.start_date}T00:00:00Z`))
    && body.start_date >= eatToday() ? body.start_date : null;
  const startTime = typeof body.start_time === "string" && TIME_RE.test(body.start_time) ? body.start_time : null;
  const idType = typeof body.id_type === "string" && ID_TYPES.includes(body.id_type) ? body.id_type : null;
  const idNumber = str(body.id_number, 4, 64);
  const ecName = str(body.ec_name, 2, 120);
  const ecPhone = normalizePhone(body.ec_phone);
  const paymentMethod = typeof body.payment_method === "string" && PAYMENT_METHODS.includes(body.payment_method) ? body.payment_method : null;

  if (!name || !phone || !address || !startDate || !startTime || !idType || !idNumber || !ecName || !ecPhone || !paymentMethod) {
    return json({ error: "invalid_input" }, 400);
  }
  if (!/^[\w\-/. ]+$/.test(idNumber)) return json({ error: "invalid_input" }, 400);

  const price = priceBooking(packageKey, days, zoneKey);

  // Optional game list from the portal wizard; kept short and rendered as text downstream.
  const rawNotes = typeof body.notes === "string" ? body.notes.trim().slice(0, 400) : "";
  const notes = rawNotes === "" ? null : rawNotes;
  // Signed-in members get their booking linked; guests (basic tier) book with user_id null.
  const user = await currentUser(request);
  const userId = user ? user.sub : null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ref = makeRef();
    const { data, error } = await supabase.from("bookings").insert({
      id: crypto.randomUUID(),
      ref,
      customer_name: name,
      customer_phone: phone,
      zone_key: zoneKey,
      address,
      package_key: packageKey,
      days,
      start_date: startDate,
      start_time: startTime,
      id_type: idType,
      id_number: idNumber,
      ec_name: ecName,
      ec_phone: ecPhone,
      payment_method: paymentMethod,
      rental_amount: price.rental,
      discount: price.discount,
      delivery_fee: price.delivery,
      total: price.total,
      status: "pending",
      payment_status: "unpaid",
      notes,
      user_id: userId,
      created_at: new Date().toISOString(),
    }).select("id,ref,rental_amount,discount,delivery_fee,total,status,payment_status").single();
    if (!error && data) return json({ ok: true, booking: data });
    if (!error || error.code !== "23505") return json({ error: "database_request_failed" }, 503);
  }
  return json({ error: "database_request_failed" }, 503);
}

// Bookings belonging to the signed-in member. Requires a valid Supabase JWT.
async function handleMyBookings(request, supabase) {
  const user = await currentUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const { data, error } = await supabase.from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("user_id", user.sub)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(200);
  if (error || !Array.isArray(data)) return json({ error: "database_request_failed" }, 503);
  return json({ items: data });
}

async function handleAdminLogin(request, env) {
  const password = env("ADMIN_PASSWORD");
  if (!password) return json({ error: "service_not_configured" }, 503);
  const body = await readJsonBody(request);
  if (!body || typeof body.password !== "string" || body.password.length > 512) {
    return json({ error: "invalid_input" }, 400);
  }
  const a = await hmacSign(password, `login-check:${body.password}`);
  const b = await hmacSign(password, `login-check:${password}`);
  if (!safeEqual(a, b)) return json({ error: "invalid_credentials" }, 401);
  const exp = Date.now() + TOKEN_TTL_MS;
  const sig = await hmacSign(password, `primegames-admin:${exp}`);
  return json({ ok: true, token: `${exp}.${sig}`, expires_at: new Date(exp).toISOString() });
}

async function handleAdminBookings(request, supabase) {
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  if (status !== null && status !== "" && !STATUSES.includes(status)) return json({ error: "invalid_input" }, 400);
  const rawOffset = params.get("offset") ?? "0";
  if (!/^(0|[1-9][0-9]{0,5})$/.test(rawOffset)) return json({ error: "invalid_input" }, 400);
  const offset = Number(rawOffset);
  const pageSize = 25;
  let query = supabase.from("bookings").select(BOOKING_COLUMNS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + pageSize);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) return json({ error: "database_request_failed" }, 503);
  const hasMore = data.length > pageSize;
  return json({ items: data.slice(0, pageSize), hasMore, nextOffset: hasMore ? offset + pageSize : null });
}

async function handleAdminBookingUpdate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.id !== "string" || !UUID_RE.test(body.id)) return json({ error: "invalid_input" }, 400);
  const fields = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return json({ error: "invalid_input" }, 400);
    fields.status = body.status;
  }
  if (body.payment_status !== undefined) {
    if (!PAYMENT_STATUSES.includes(body.payment_status)) return json({ error: "invalid_input" }, 400);
    fields.payment_status = body.payment_status;
  }
  if (body.notes !== undefined) {
    if (body.notes !== null) {
      const notes = str(body.notes, 0, 1000);
      if (notes === null) return json({ error: "invalid_input" }, 400);
      fields.notes = notes === "" ? null : notes;
    } else {
      fields.notes = null;
    }
  }
  if (Object.keys(fields).length === 0) return json({ error: "invalid_input" }, 400);
  const { data, error } = await supabase.from("bookings")
    .update(fields).eq("id", body.id)
    .select(BOOKING_COLUMNS).maybeSingle();
  if (error) return json({ error: "database_request_failed" }, 503);
  if (!data) return json({ error: "not_found" }, 404);
  return json({ ok: true, booking: data });
}

async function handleAdminStats(supabase) {
  const countOf = async (table, filters) => {
    let q = supabase.from(table).select("id", { count: "exact" }).limit(1);
    for (const [column, value] of filters) q = q.eq(column, value);
    const { count, error } = await q;
    if (error || !Number.isSafeInteger(count)) throw new Error("count_unavailable");
    return count;
  };
  try {
    const [
      pending, confirmed, delivered, totalBookings, unpaid,
      consolesTotal, consolesAvailable, consolesRented, consolesMaint, consolesRetired,
      maintOpen, maintProgress, gamesTotal, gamesAvailable, incidentsOpen,
      paidRows, unpaidRows,
    ] = await Promise.all([
      countOf("bookings", [["status", "pending"]]),
      countOf("bookings", [["status", "confirmed"]]),
      countOf("bookings", [["status", "delivered"]]),
      countOf("bookings", []),
      countOf("bookings", [["payment_status", "unpaid"]]),
      countOf("consoles", []),
      countOf("consoles", [["status", "available"]]),
      countOf("consoles", [["status", "rented"]]),
      countOf("consoles", [["status", "maintenance"]]),
      countOf("consoles", [["status", "retired"]]),
      countOf("maintenance", [["status", "open"]]),
      countOf("maintenance", [["status", "in_progress"]]),
      countOf("games", []),
      countOf("games", [["status", "available"]]),
      countOf("incidents", [["status", "open"]]),
      supabase.from("bookings").select("total,status,created_at").eq("payment_status", "paid").limit(1000),
      supabase.from("bookings").select("total").eq("payment_status", "unpaid").limit(1000),
    ]);
    if (paidRows.error || !Array.isArray(paidRows.data)) return json({ error: "database_request_failed" }, 503);
    if (unpaidRows.error || !Array.isArray(unpaidRows.data)) return json({ error: "database_request_failed" }, 503);
    const today = eatToday();
    let revenue = 0, revenueToday = 0;
    for (const row of paidRows.data) {
      if (row.status === "cancelled" || !Number.isFinite(row.total)) continue;
      revenue += row.total;
      if (typeof row.created_at === "string" && row.created_at.slice(0, 10) === today) revenueToday += row.total;
    }
    let outstanding = 0;
    for (const row of unpaidRows.data) if (Number.isFinite(row.total)) outstanding += row.total;
    return json({
      ok: true,
      stats: {
        pending, confirmed, active: confirmed + delivered, unpaid,
        total_bookings: totalBookings, revenue, revenue_today: revenueToday, outstanding,
        consoles_total: consolesTotal, consoles_available: consolesAvailable,
        consoles_rented: consolesRented, consoles_maintenance: consolesMaint, consoles_retired: consolesRetired,
        maintenance_open: maintOpen + maintProgress,
        games_total: gamesTotal, games_available: gamesAvailable,
        incidents_open: incidentsOpen,
      },
    });
  } catch {
    return json({ error: "database_request_failed" }, 503);
  }
}

async function handleAdminCustomers(supabase) {
  const { data, error } = await supabase.from("bookings")
    .select("customer_name,customer_phone,zone_key,total,status,payment_status,created_at")
    .order("created_at", { ascending: false })
    .limit(400);
  if (error || !Array.isArray(data)) return json({ error: "database_request_failed" }, 503);
  const byPhone = new Map();
  for (const row of data) {
    let entry = byPhone.get(row.customer_phone);
    if (!entry) {
      entry = { name: row.customer_name, phone: row.customer_phone, zone_key: row.zone_key, bookings: 0, spend: 0, open: 0, last_at: row.created_at };
      byPhone.set(row.customer_phone, entry);
    }
    entry.bookings += 1;
    if (row.payment_status === "paid" && row.status !== "cancelled" && Number.isFinite(row.total)) entry.spend += row.total;
    if (["pending", "confirmed", "delivered"].includes(row.status)) entry.open += 1;
  }
  const customers = [...byPhone.values()].sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)));
  return json({ ok: true, customers });
}

// ---- Admin entity helpers ----------------------------------------------------
// Optional-field collectors: `set` marks presence, `invalid` marks a rejected value,
// and a `null` value means "clear this column". Undefined body keys are skipped.
function optStr(v, min, max) {
  if (v === undefined) return { set: false };
  if (v === null) return { set: true, value: null };
  if (typeof v !== "string") return { set: true, invalid: true };
  const t = v.trim();
  if (t === "") return { set: true, value: null };
  if (t.length < min || t.length > max) return { set: true, invalid: true };
  return { set: true, value: t };
}
function optInt(v, min, max) {
  if (v === undefined) return { set: false };
  if (v === null || v === "") return { set: true, value: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return { set: true, invalid: true };
  return { set: true, value: n };
}
function optIso(v) {
  if (v === undefined) return { set: false };
  if (v === null || v === "") return { set: true, value: null };
  if (typeof v !== "string") return { set: true, invalid: true };
  const t = Date.parse(v);
  if (Number.isNaN(t)) return { set: true, invalid: true };
  return { set: true, value: new Date(t).toISOString() };
}
function optEnum(v, allowed) {
  if (v === undefined) return { set: false };
  if (v === null) return { set: true, value: null };
  if (typeof v !== "string" || !allowed.includes(v)) return { set: true, invalid: true };
  return { set: true, value: v };
}
function collectFields(body, spec) {
  const fields = {};
  for (const name of Object.keys(spec)) {
    if (body[name] === undefined) continue;
    const rule = spec[name];
    let res;
    if (rule.type === "str") res = optStr(body[name], rule.min, rule.max);
    else if (rule.type === "int") res = optInt(body[name], rule.min, rule.max);
    else if (rule.type === "iso") res = optIso(body[name]);
    else if (rule.type === "enum") res = optEnum(body[name], rule.allowed);
    else res = { set: true, invalid: true };
    if (res.invalid) return { error: true };
    fields[name] = res.value;
  }
  return { fields };
}
function hasRequired(fields, names) {
  return names.every((n) => fields[n] !== undefined && fields[n] !== null);
}
function optUuid(v) {
  if (v === undefined || v === null || v === "") return { set: true, value: null };
  if (typeof v !== "string" || !UUID_RE.test(v)) return { set: true, invalid: true };
  return { set: true, value: v };
}

async function listTable(supabase, table, columns, opts) {
  const { order, orderAsc = false, filters = {}, guards = {}, limit = 500 } = opts;
  let query = supabase.from(table).select(columns);
  if (order) query = query.order(order, { ascending: orderAsc });
  for (const [col, val] of Object.entries(filters)) {
    if (val === null || val === undefined || val === "") continue;
    const allowed = guards[col];
    if (allowed && !allowed.includes(val)) return { badInput: true };
    query = query.eq(col, val);
  }
  const { data, error } = await query.limit(limit);
  if (error || !Array.isArray(data)) return { failed: true };
  return { data };
}

const CONSOLE_SPEC = {
  unit_code: { type: "str", min: 2, max: 32 },
  model: { type: "str", min: 2, max: 64 },
  serial_number: { type: "str", min: 2, max: 64 },
  status: { type: "enum", allowed: CONSOLE_STATUSES },
  condition_grade: { type: "enum", allowed: CONSOLE_CONDITIONS },
  current_renter: { type: "str", min: 2, max: 120 },
  rentals_count: { type: "int", min: 0, max: 1000000 },
  last_audit_at: { type: "iso" },
  purchased_at: { type: "iso" },
  notes: { type: "str", min: 1, max: 1000 },
};
const MAINT_SPEC = {
  issue: { type: "str", min: 2, max: 300 },
  status: { type: "enum", allowed: MAINT_STATUSES },
  priority: { type: "enum", allowed: MAINT_PRIORITIES },
  engineer: { type: "str", min: 2, max: 120 },
  cost: { type: "int", min: 0, max: 100000000 },
  notes: { type: "str", min: 1, max: 1000 },
  opened_at: { type: "iso" },
  resolved_at: { type: "iso" },
};
const GAME_SPEC = {
  title: { type: "str", min: 1, max: 120 },
  platform: { type: "enum", allowed: GAME_PLATFORMS },
  genre: { type: "str", min: 1, max: 60 },
  media_format: { type: "enum", allowed: GAME_FORMATS },
  cover_url: { type: "str", min: 1, max: 500 },
  status: { type: "enum", allowed: GAME_STATUSES },
};
const TXN_SPEC = {
  booking_ref: { type: "str", min: 2, max: 32 },
  customer_name: { type: "str", min: 2, max: 120 },
  customer_phone: { type: "str", min: 9, max: 20 },
  amount: { type: "int", min: 0, max: 100000000 },
  method: { type: "enum", allowed: TXN_METHODS },
  kind: { type: "enum", allowed: TXN_KINDS },
  status: { type: "enum", allowed: TXN_STATUSES },
  notes: { type: "str", min: 1, max: 1000 },
  occurred_at: { type: "iso" },
};
const INCIDENT_SPEC = {
  booking_ref: { type: "str", min: 2, max: 32 },
  unit_code: { type: "str", min: 2, max: 32 },
  customer_name: { type: "str", min: 2, max: 120 },
  customer_phone: { type: "str", min: 9, max: 20 },
  kind: { type: "enum", allowed: INCIDENT_KINDS },
  severity: { type: "enum", allowed: INCIDENT_SEVERITIES },
  status: { type: "enum", allowed: INCIDENT_STATUSES },
  description: { type: "str", min: 1, max: 1000 },
  claim_amount: { type: "int", min: 0, max: 100000000 },
  resolved_amount: { type: "int", min: 0, max: 100000000 },
  occurred_at: { type: "iso" },
};

// ---- Consoles (fleet) ----
async function handleAdminConsoles(request, supabase) {
  const p = new URL(request.url).searchParams;
  const r = await listTable(supabase, "consoles", CONSOLE_COLUMNS, {
    order: "unit_code", orderAsc: true,
    filters: { status: p.get("status") }, guards: { status: CONSOLE_STATUSES },
  });
  if (r.badInput) return json({ error: "invalid_input" }, 400);
  if (r.failed) return json({ error: "database_request_failed" }, 503);
  return json({ ok: true, items: r.data });
}
async function handleAdminConsoleCreate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body) return json({ error: "invalid_input" }, 400);
  const parsed = collectFields(body, CONSOLE_SPEC);
  if (parsed.error) return json({ error: "invalid_input" }, 400);
  const f = parsed.fields;
  if (!hasRequired(f, ["unit_code", "model", "status", "condition_grade"])) return json({ error: "invalid_input" }, 400);
  if (!/^[A-Za-z0-9][A-Za-z0-9\- ]{1,31}$/.test(f.unit_code)) return json({ error: "invalid_input" }, 400);
  const row = {
    id: crypto.randomUUID(),
    unit_code: f.unit_code, model: f.model, serial_number: f.serial_number ?? null,
    status: f.status, condition_grade: f.condition_grade, current_renter: f.current_renter ?? null,
    rentals_count: Number.isInteger(f.rentals_count) ? f.rentals_count : 0,
    last_audit_at: f.last_audit_at ?? null, purchased_at: f.purchased_at ?? null, notes: f.notes ?? null,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("consoles").insert(row).select(CONSOLE_COLUMNS).single();
  if (error) return json({ error: error.code === "23505" ? "duplicate_unit_code" : "database_request_failed" }, error.code === "23505" ? 409 : 503);
  return json({ ok: true, item: data });
}
async function handleAdminConsoleUpdate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.id !== "string" || !UUID_RE.test(body.id)) return json({ error: "invalid_input" }, 400);
  const parsed = collectFields(body, CONSOLE_SPEC);
  if (parsed.error) return json({ error: "invalid_input" }, 400);
  const fields = parsed.fields;
  delete fields.unit_code; // unit code is immutable once issued
  if (Object.keys(fields).length === 0) return json({ error: "invalid_input" }, 400);
  const { data, error } = await supabase.from("consoles").update(fields).eq("id", body.id).select(CONSOLE_COLUMNS).maybeSingle();
  if (error) return json({ error: "database_request_failed" }, 503);
  if (!data) return json({ error: "not_found" }, 404);
  return json({ ok: true, item: data });
}

// ---- Maintenance / repair registry ----
async function handleAdminMaintenance(request, supabase) {
  const p = new URL(request.url).searchParams;
  const consoleId = p.get("console_id");
  if (consoleId && !UUID_RE.test(consoleId)) return json({ error: "invalid_input" }, 400);
  const r = await listTable(supabase, "maintenance", MAINT_COLUMNS, {
    order: "opened_at", orderAsc: false, limit: 500,
    filters: { status: p.get("status"), console_id: consoleId }, guards: { status: MAINT_STATUSES },
  });
  if (r.badInput) return json({ error: "invalid_input" }, 400);
  if (r.failed) return json({ error: "database_request_failed" }, 503);
  return json({ ok: true, items: r.data });
}
async function handleAdminMaintenanceCreate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.console_id !== "string" || !UUID_RE.test(body.console_id)) return json({ error: "invalid_input" }, 400);
  const parsed = collectFields(body, MAINT_SPEC);
  if (parsed.error) return json({ error: "invalid_input" }, 400);
  const f = parsed.fields;
  if (!hasRequired(f, ["issue", "status", "priority"])) return json({ error: "invalid_input" }, 400);
  const { data: con, error: conErr } = await supabase.from("consoles").select("id,unit_code").eq("id", body.console_id).maybeSingle();
  if (conErr) return json({ error: "database_request_failed" }, 503);
  if (!con) return json({ error: "console_not_found" }, 400);
  const row = {
    id: crypto.randomUUID(), console_id: body.console_id, unit_code: con.unit_code,
    issue: f.issue, status: f.status, priority: f.priority, engineer: f.engineer ?? null,
    cost: Number.isInteger(f.cost) ? f.cost : null, notes: f.notes ?? null,
    opened_at: f.opened_at ?? new Date().toISOString(), resolved_at: f.resolved_at ?? null,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("maintenance").insert(row).select(MAINT_COLUMNS).single();
  if (error) return json({ error: "database_request_failed" }, 503);
  return json({ ok: true, item: data });
}
async function handleAdminMaintenanceUpdate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.id !== "string" || !UUID_RE.test(body.id)) return json({ error: "invalid_input" }, 400);
  const parsed = collectFields(body, MAINT_SPEC);
  if (parsed.error) return json({ error: "invalid_input" }, 400);
  const fields = parsed.fields;
  if (Object.keys(fields).length === 0) return json({ error: "invalid_input" }, 400);
  const { data, error } = await supabase.from("maintenance").update(fields).eq("id", body.id).select(MAINT_COLUMNS).maybeSingle();
  if (error) return json({ error: "database_request_failed" }, 503);
  if (!data) return json({ error: "not_found" }, 404);
  return json({ ok: true, item: data });
}

// ---- Games catalog ----
async function handleAdminGames(request, supabase) {
  const p = new URL(request.url).searchParams;
  const r = await listTable(supabase, "games", GAME_COLUMNS, {
    order: "title", orderAsc: true, limit: 500,
    filters: { platform: p.get("platform"), status: p.get("status") },
    guards: { platform: GAME_PLATFORMS, status: GAME_STATUSES },
  });
  if (r.badInput) return json({ error: "invalid_input" }, 400);
  if (r.failed) return json({ error: "database_request_failed" }, 503);
  return json({ ok: true, items: r.data });
}
async function handleAdminGameCreate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body) return json({ error: "invalid_input" }, 400);
  const parsed = collectFields(body, GAME_SPEC);
  if (parsed.error) return json({ error: "invalid_input" }, 400);
  const f = parsed.fields;
  if (!hasRequired(f, ["title", "platform"])) return json({ error: "invalid_input" }, 400);
  if (f.cover_url && !/^https?:\/\/[^\s]+$/i.test(f.cover_url)) return json({ error: "invalid_input" }, 400);
  const row = {
    id: crypto.randomUUID(), title: f.title, platform: f.platform, genre: f.genre ?? null,
    media_format: f.media_format ?? null, cover_url: f.cover_url ?? null,
    status: f.status ?? "available", created_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("games").insert(row).select(GAME_COLUMNS).single();
  if (error) return json({ error: "database_request_failed" }, 503);
  return json({ ok: true, item: data });
}
async function handleAdminGameUpdate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.id !== "string" || !UUID_RE.test(body.id)) return json({ error: "invalid_input" }, 400);
  const parsed = collectFields(body, GAME_SPEC);
  if (parsed.error) return json({ error: "invalid_input" }, 400);
  const fields = parsed.fields;
  if (fields.cover_url && !/^https?:\/\/[^\s]+$/i.test(fields.cover_url)) return json({ error: "invalid_input" }, 400);
  if (Object.keys(fields).length === 0) return json({ error: "invalid_input" }, 400);
  const { data, error } = await supabase.from("games").update(fields).eq("id", body.id).select(GAME_COLUMNS).maybeSingle();
  if (error) return json({ error: "database_request_failed" }, 503);
  if (!data) return json({ error: "not_found" }, 404);
  return json({ ok: true, item: data });
}

// ---- Transactions (payments ledger) ----
async function handleAdminTransactions(request, supabase) {
  const p = new URL(request.url).searchParams;
  const r = await listTable(supabase, "transactions", TXN_COLUMNS, {
    order: "occurred_at", orderAsc: false, limit: 500,
    filters: { status: p.get("status"), kind: p.get("kind"), method: p.get("method") },
    guards: { status: TXN_STATUSES, kind: TXN_KINDS, method: TXN_METHODS },
  });
  if (r.badInput) return json({ error: "invalid_input" }, 400);
  if (r.failed) return json({ error: "database_request_failed" }, 503);
  return json({ ok: true, items: r.data });
}
async function handleAdminTransactionCreate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body) return json({ error: "invalid_input" }, 400);
  const bk = optUuid(body.booking_id);
  if (bk.invalid) return json({ error: "invalid_input" }, 400);
  const parsed = collectFields(body, TXN_SPEC);
  if (parsed.error) return json({ error: "invalid_input" }, 400);
  const f = parsed.fields;
  if (!hasRequired(f, ["customer_name", "amount", "method", "kind", "status"])) return json({ error: "invalid_input" }, 400);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = {
      id: crypto.randomUUID(), ref: makeCode("TXN-"), booking_id: bk.value, booking_ref: f.booking_ref ?? null,
      customer_name: f.customer_name, customer_phone: f.customer_phone ?? null, amount: f.amount,
      method: f.method, kind: f.kind, status: f.status, notes: f.notes ?? null,
      occurred_at: f.occurred_at ?? new Date().toISOString(), created_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from("transactions").insert(row).select(TXN_COLUMNS).single();
    if (!error && data) return json({ ok: true, item: data });
    if (!error || error.code !== "23505") return json({ error: "database_request_failed" }, 503);
  }
  return json({ error: "database_request_failed" }, 503);
}
async function handleAdminTransactionUpdate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.id !== "string" || !UUID_RE.test(body.id)) return json({ error: "invalid_input" }, 400);
  const parsed = collectFields(body, TXN_SPEC);
  if (parsed.error) return json({ error: "invalid_input" }, 400);
  const fields = parsed.fields;
  delete fields.customer_name; // ledger keeps the original payer name
  if (Object.keys(fields).length === 0) return json({ error: "invalid_input" }, 400);
  const { data, error } = await supabase.from("transactions").update(fields).eq("id", body.id).select(TXN_COLUMNS).maybeSingle();
  if (error) return json({ error: "database_request_failed" }, 503);
  if (!data) return json({ error: "not_found" }, 404);
  return json({ ok: true, item: data });
}

// ---- Incidents & damage claims ----
async function handleAdminIncidents(request, supabase) {
  const p = new URL(request.url).searchParams;
  const r = await listTable(supabase, "incidents", INCIDENT_COLUMNS, {
    order: "occurred_at", orderAsc: false, limit: 500,
    filters: { status: p.get("status"), severity: p.get("severity"), kind: p.get("kind") },
    guards: { status: INCIDENT_STATUSES, severity: INCIDENT_SEVERITIES, kind: INCIDENT_KINDS },
  });
  if (r.badInput) return json({ error: "invalid_input" }, 400);
  if (r.failed) return json({ error: "database_request_failed" }, 503);
  return json({ ok: true, items: r.data });
}
async function handleAdminIncidentCreate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body) return json({ error: "invalid_input" }, 400);
  const bk = optUuid(body.booking_id);
  if (bk.invalid) return json({ error: "invalid_input" }, 400);
  const con = optUuid(body.console_id);
  if (con.invalid) return json({ error: "invalid_input" }, 400);
  const parsed = collectFields(body, INCIDENT_SPEC);
  if (parsed.error) return json({ error: "invalid_input" }, 400);
  const f = parsed.fields;
  if (!hasRequired(f, ["customer_name", "kind", "severity", "status"])) return json({ error: "invalid_input" }, 400);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = {
      id: crypto.randomUUID(), ref: makeCode("INC-"), booking_id: bk.value, booking_ref: f.booking_ref ?? null,
      console_id: con.value, unit_code: f.unit_code ?? null, customer_name: f.customer_name,
      customer_phone: f.customer_phone ?? null, kind: f.kind, severity: f.severity, status: f.status,
      description: f.description ?? null,
      claim_amount: Number.isInteger(f.claim_amount) ? f.claim_amount : null,
      resolved_amount: Number.isInteger(f.resolved_amount) ? f.resolved_amount : null,
      occurred_at: f.occurred_at ?? new Date().toISOString(), created_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from("incidents").insert(row).select(INCIDENT_COLUMNS).single();
    if (!error && data) return json({ ok: true, item: data });
    if (!error || error.code !== "23505") return json({ error: "database_request_failed" }, 503);
  }
  return json({ error: "database_request_failed" }, 503);
}
async function handleAdminIncidentUpdate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.id !== "string" || !UUID_RE.test(body.id)) return json({ error: "invalid_input" }, 400);
  const parsed = collectFields(body, INCIDENT_SPEC);
  if (parsed.error) return json({ error: "invalid_input" }, 400);
  const fields = parsed.fields;
  if (Object.keys(fields).length === 0) return json({ error: "invalid_input" }, 400);
  const { data, error } = await supabase.from("incidents").update(fields).eq("id", body.id).select(INCIDENT_COLUMNS).maybeSingle();
  if (error) return json({ error: "database_request_failed" }, 503);
  if (!data) return json({ error: "not_found" }, 404);
  return json({ ok: true, item: data });
}

export async function handleApi({ request, supabase, env }) {
  const action = new URL(request.url).searchParams.get("action");
  try {
    if (action === "create_booking") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      return await handleCreateBooking(request, supabase);
    }
    if (action === "my_bookings") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      return await handleMyBookings(request, supabase);
    }
    if (action === "admin_login") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      return await handleAdminLogin(request, env);
    }
    if (typeof action === "string" && action.startsWith("admin_")) {
      const denied = await requireAdmin(request, env);
      if (denied) return denied;
      if (action === "admin_bookings") {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
        return await handleAdminBookings(request, supabase);
      }
      if (action === "admin_booking_update") {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        return await handleAdminBookingUpdate(request, supabase);
      }
      if (action === "admin_stats") {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
        return await handleAdminStats(supabase);
      }
      if (action === "admin_customers") {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
        return await handleAdminCustomers(supabase);
      }
      const getRoutes = {
        admin_consoles: handleAdminConsoles,
        admin_maintenance: handleAdminMaintenance,
        admin_games: handleAdminGames,
        admin_transactions: handleAdminTransactions,
        admin_incidents: handleAdminIncidents,
      };
      const postRoutes = {
        admin_console_create: handleAdminConsoleCreate,
        admin_console_update: handleAdminConsoleUpdate,
        admin_maintenance_create: handleAdminMaintenanceCreate,
        admin_maintenance_update: handleAdminMaintenanceUpdate,
        admin_game_create: handleAdminGameCreate,
        admin_game_update: handleAdminGameUpdate,
        admin_transaction_create: handleAdminTransactionCreate,
        admin_transaction_update: handleAdminTransactionUpdate,
        admin_incident_create: handleAdminIncidentCreate,
        admin_incident_update: handleAdminIncidentUpdate,
      };
      if (Object.hasOwn(getRoutes, action)) {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
        return await getRoutes[action](request, supabase);
      }
      if (Object.hasOwn(postRoutes, action)) {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        return await postRoutes[action](request, supabase);
      }
    }
    return json({ error: "not_found" }, 404);
  } catch {
    return json({ error: "database_request_failed" }, 503);
  }
}
