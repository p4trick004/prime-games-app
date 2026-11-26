// Prime Games API — Supabase Edge Function handler (Phase 3 customer-centred schema).
// Runtime-agnostic: takes { request, supabase, env }. The Deno entry (index.ts)
// supplies a service_role client; the Node harness supplies an in-memory fake.
// Routes are selected with the `action` query parameter. Never trust browser money.
import {
  json, preflight, readJsonBody, str, normalizePhone, eatToday, corsOriginHeaders, rpcFailure,
  RATES, ZONE_FEES, ID_TYPES, PAYMENT_METHODS, STATUSES, PAYMENT_STATUSES,
  CONSOLE_STATUSES, CONSOLE_CONDITIONS, MAINT_STATUSES, MAINT_PRIORITIES,
  GAME_STATUSES, GAME_PLATFORMS, GAME_FORMATS, TXN_METHODS, TXN_KINDS, TXN_STATUSES,
  INCIDENT_KINDS, INCIDENT_SEVERITIES, INCIDENT_STATUSES,
  CUSTOMER_TIERS, CUSTOMER_STATUSES, RENTAL_STATUSES, KYC_DOC_STATUSES,
  UUID_RE, DATE_RE, TIME_RE, ID_NUMBER_RE,
  optStr, optInt, optIso, optEnum, optUuid, collectFields, hasRequired,
} from "./lib/core.mjs";
import { priceBooking, makeRef, makeIncidentRef } from "./lib/pricing.mjs";
import { currentUser, requireAdmin, hmacSign, safeEqual, issueAdminToken } from "./lib/auth.mjs";
import { verifyTotp, base32Encode, TOTP_DIGITS, TOTP_PERIOD } from "./lib/totp.mjs";
import { clientKey, throttleStatus, recordFailure, clearThrottle } from "./lib/throttle.mjs";
import { mapBookings, mapConsoles, mapMaintenance, mapTransactions, mapIncidents } from "./lib/mapping.mjs";
import {
  resolveGuestCustomer, resolveMemberCustomer, getCustomerByAuth, getProfile,
  registerCustomer, requestGuestLink, approveLink, rejectLink, findGuestByPhone,
} from "./lib/customers.mjs";
import { appendPayment, aggregateOutstanding, revenueStats } from "./lib/ledger.mjs";
import { handoverRental, returnRental, markOverdue, mapRentals } from "./lib/rentals.mjs";
import {
  submitKyc, createKycUploadUrl, registerKycDocument, adminVerifyKyc, adminKycDownloadUrl, listKycDocuments,
} from "./lib/kyc.mjs";

const BOOKING_PAGE = 25;
const LOGIN_MAX_FAILURES = 10;
const RECOVER_MAX_FAILURES = 5;
const TOTP_MAX_FAILURES = 5;
const TOTP_SETTINGS_ID = "totp";
const TOTP_ISSUER = "Prime Games";
const TOTP_ACCOUNT = "admin";

// ---- generic list helper (filters + guards) ----
async function listRows(supabase, table, opts) {
  const { order, orderAsc = false, filters = {}, guards = {}, limit = 500 } = opts;
  let query = supabase.from(table).select("*");
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

const bad = (error = "invalid_input", status = 400) => json({ error }, status);
const failed = () => json({ error: "database_request_failed" }, 503);

// ============================ CUSTOMER-FACING ============================

async function handleCreateBooking(request, supabase) {
  const body = await readJsonBody(request);
  if (!body) return bad();
  const packageKey = typeof body.package === "string" && Object.hasOwn(RATES, body.package) ? body.package : null;
  if (!packageKey) return bad();
  const zoneKey = typeof body.zone === "string" && Object.hasOwn(ZONE_FEES, body.zone) ? body.zone : null;
  if (!zoneKey) return bad();
  const days = Number(body.days);
  if (!Number.isInteger(days) || days < 1 || days > 30) return bad();
  if (packageKey === "weekend" && days !== 1) return bad();

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
  if (!name || !phone || !address || !startDate || !startTime || !idType || !idNumber || !ecName || !ecPhone || !paymentMethod) return bad();
  if (!ID_NUMBER_RE.test(idNumber)) return bad();

  const price = priceBooking(packageKey, days, zoneKey);
  const rawNotes = typeof body.notes === "string" ? body.notes.trim().slice(0, 400) : "";
  const notes = rawNotes === "" ? null : rawNotes;

  // Resolve the permanent customer: member by auth_user_id, guest by normalized phone.
  const user = await currentUser(request);
  let customer;
  try {
    customer = user
      ? await resolveMemberCustomer(supabase, user, { name, phone })
      : await resolveGuestCustomer(supabase, { phone, name });
  } catch {
    return failed();
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ref = makeRef();
    const { data, error } = await supabase.from("bookings").insert({
      id: crypto.randomUUID(),
      ref,
      customer_id: customer.id,
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
    }).select("id,ref,rental_amount,discount,delivery_fee,total,status,payment_status").single();
    if (!error && data) {
      await attachBookingGames(supabase, data.id, body.game_ids);
      return json({ ok: true, booking: data });
    }
    if (!error || error.code !== "23505") return failed();
  }
  return failed();
}

async function attachBookingGames(supabase, bookingId, gameIds) {
  if (!Array.isArray(gameIds) || gameIds.length === 0) return;
  const ids = [...new Set(gameIds.filter((g) => typeof g === "string" && UUID_RE.test(g)))].slice(0, 5);
  for (const gameId of ids) {
    await supabase.from("booking_games").insert({ booking_id: bookingId, game_id: gameId });
  }
}

async function handleMyBookings(request, supabase) {
  const user = await currentUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const customer = await getCustomerByAuth(supabase, user.sub);
  if (!customer) return json({ items: [] });
  const { data, error } = await supabase.from("bookings").select("*")
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200);
  if (error || !Array.isArray(data)) return failed();
  return json({ items: await mapBookings(supabase, data) });
}

async function handleAuthMe(request, supabase) {
  const user = await currentUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const customer = await getCustomerByAuth(supabase, user.sub);
  const profile = await getProfile(supabase, user.sub);
  const { data: links } = await supabase.from("customer_links").select("*").eq("auth_user_id", user.sub).eq("status", "pending");
  return json({ ok: true, customer, profile, link_pending: (links ?? []).length > 0 });
}

async function handleRegisterCustomer(request, supabase) {
  const user = await currentUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  try {
    const result = await registerCustomer(supabase, user);
    return json({ ok: true, ...result });
  } catch {
    return failed();
  }
}

async function handleMyRentals(request, supabase) {
  const user = await currentUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const customer = await getCustomerByAuth(supabase, user.sub);
  if (!customer) return json({ items: [] });
  const { data, error } = await supabase.from("rentals").select("*")
    .eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(200);
  if (error || !Array.isArray(data)) return failed();
  return json({ items: await mapRentals(supabase, data) });
}

async function handleMyPayments(request, supabase) {
  const user = await currentUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const customer = await getCustomerByAuth(supabase, user.sub);
  if (!customer) return json({ items: [], outstanding: 0 });
  const { data, error } = await supabase.from("payments").select("*")
    .eq("customer_id", customer.id).order("occurred_at", { ascending: false }).limit(200);
  if (error || !Array.isArray(data)) return failed();
  const { data: outstanding, error: oErr } = await supabase.rpc("customer_outstanding", { p_customer_id: customer.id });
  return json({ items: await mapTransactions(supabase, data), outstanding: oErr ? null : outstanding });
}

async function handleLinkGuest(request, supabase) {
  const user = await currentUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const body = await readJsonBody(request);
  if (!body) return bad();
  const res = await requestGuestLink(supabase, user, body.phone);
  if (res.error) return json({ error: res.error }, res.status);
  return json(res);
}

async function handleSubmitKyc(request, supabase) {
  const user = await currentUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const body = await readJsonBody(request);
  if (!body) return bad();
  const res = await submitKyc(supabase, user, body);
  return res.error ? json({ error: res.error }, res.status) : json(res);
}

async function handleKycUploadUrl(request, supabase) {
  const user = await currentUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const body = await readJsonBody(request);
  if (!body) return bad();
  const res = await createKycUploadUrl(supabase, user, body);
  return res.error ? json({ error: res.error }, res.status) : json(res);
}

async function handleKycRegister(request, supabase) {
  const user = await currentUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const body = await readJsonBody(request);
  if (!body) return bad();
  const res = await registerKycDocument(supabase, user, body);
  return res.error ? json({ error: res.error }, res.status) : json(res);
}

// ============================ ADMIN: auth ============================

function tooManyAttempts(retryAfterSec) {
  const res = json({ error: "rate_limited" }, 429);
  res.headers.set("retry-after", String(retryAfterSec));
  return res;
}

async function handleAdminLogin(request, env) {
  const password = env("ADMIN_PASSWORD");
  if (!password) return json({ error: "service_not_configured" }, 503);
  const limitKey = clientKey(request, "admin_login");
  const gate = throttleStatus(limitKey, LOGIN_MAX_FAILURES);
  if (gate.blocked) return tooManyAttempts(gate.retryAfterSec);
  const body = await readJsonBody(request);
  if (!body || typeof body.password !== "string" || body.password.length > 512) return bad();
  const a = await hmacSign(password, `login-check:${body.password}`);
  const b = await hmacSign(password, `login-check:${password}`);
  if (!safeEqual(a, b)) {
    recordFailure(limitKey);
    return json({ error: "invalid_credentials" }, 401);
  }
  clearThrottle(limitKey);
  const { token, expires_at } = await issueAdminToken(password);
  return json({ ok: true, token, expires_at });
}

// ---- authenticator (TOTP) enrollment --------------------------------------
// The secret lives in admin_settings (service_role only, migration 0014).
// Enrollment is two-step: admin_totp_setup stores a pending secret and returns
// it once for the QR/manual key; admin_totp_verify activates it only after a
// code from the connected app matches. The active secret is never returned.

async function readTotpSettings(supabase) {
  const { data, error } = await supabase.from("admin_settings").select("*")
    .eq("id", TOTP_SETTINGS_ID).maybeSingle();
  if (error) return { failed: true };
  return { row: data ?? null };
}

async function writeTotpSettings(supabase, fields) {
  const existing = await readTotpSettings(supabase);
  if (existing.failed) return false;
  const patch = { ...fields, updated_at: new Date().toISOString() };
  const { error } = existing.row
    ? await supabase.from("admin_settings").update(patch).eq("id", TOTP_SETTINGS_ID)
    : await supabase.from("admin_settings").insert({ id: TOTP_SETTINGS_ID, ...patch });
  return !error;
}

function otpauthUri(secret) {
  const label = `${encodeURIComponent(TOTP_ISSUER)}:${encodeURIComponent(TOTP_ACCOUNT)}`;
  return `otpauth://totp/${label}?secret=${secret}`
    + `&issuer=${encodeURIComponent(TOTP_ISSUER)}&algorithm=SHA1`
    + `&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}

async function handleAdminTotpStatus(_request, supabase) {
  const { row, failed: dbFailed } = await readTotpSettings(supabase);
  if (dbFailed) return failed();
  return json({
    active: Boolean(row?.totp_secret),
    activated_at: row?.totp_activated_at ?? null,
    pending: Boolean(row?.totp_pending_secret),
  });
}

async function handleAdminTotpSetup(_request, supabase) {
  const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
  const ok = await writeTotpSettings(supabase, {
    totp_pending_secret: secret,
    totp_pending_issued_at: new Date().toISOString(),
  });
  if (!ok) return failed();
  return json({
    secret,
    otpauth_uri: otpauthUri(secret),
    issuer: TOTP_ISSUER,
    account: TOTP_ACCOUNT,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
  });
}

async function handleAdminTotpVerify(request, supabase) {
  const { row, failed: dbFailed } = await readTotpSettings(supabase);
  if (dbFailed) return failed();
  if (!row?.totp_pending_secret) return json({ error: "setup_required" }, 400);
  const limitKey = clientKey(request, "admin_totp_verify");
  const gate = throttleStatus(limitKey, TOTP_MAX_FAILURES);
  if (gate.blocked) return tooManyAttempts(gate.retryAfterSec);
  const body = await readJsonBody(request);
  if (!body || typeof body.code !== "string" || body.code.length > 16) return bad();
  if (!(await verifyTotp(row.totp_pending_secret, body.code))) {
    recordFailure(limitKey);
    return json({ error: "invalid_code" }, 401);
  }
  clearThrottle(limitKey);
  const activatedAt = new Date().toISOString();
  const ok = await writeTotpSettings(supabase, {
    totp_secret: row.totp_pending_secret,
    totp_activated_at: activatedAt,
    totp_pending_secret: null,
    totp_pending_issued_at: null,
  });
  if (!ok) return failed();
  return json({ ok: true, active: true, activated_at: activatedAt });
}

// Password recovery via the enrolled authenticator app. Fails closed until an
// admin completes enrollment; issues the same admin session token as login.
async function handleAdminRecover(request, env, supabase) {
  const password = env("ADMIN_PASSWORD");
  if (!password) return json({ error: "service_not_configured" }, 503);
  const { row, failed: dbFailed } = await readTotpSettings(supabase);
  if (dbFailed) return failed();
  if (!row?.totp_secret || !row.totp_activated_at) return json({ error: "recovery_not_configured" }, 503);
  const limitKey = clientKey(request, "admin_recover");
  const gate = throttleStatus(limitKey, RECOVER_MAX_FAILURES);
  if (gate.blocked) return tooManyAttempts(gate.retryAfterSec);
  const body = await readJsonBody(request);
  if (!body || typeof body.code !== "string" || body.code.length > 16) return bad();
  if (!(await verifyTotp(row.totp_secret, body.code))) {
    recordFailure(limitKey);
    return json({ error: "invalid_code" }, 401);
  }
  clearThrottle(limitKey);
  const { token, expires_at } = await issueAdminToken(password);
  return json({ ok: true, token, expires_at });
}

// ============================ ADMIN: bookings ============================

async function handleAdminBookings(request, supabase) {
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  if (status !== null && status !== "" && !STATUSES.includes(status)) return bad();
  const rawOffset = params.get("offset") ?? "0";
  if (!/^(0|[1-9][0-9]{0,5})$/.test(rawOffset)) return bad();
  const offset = Number(rawOffset);
  let query = supabase.from("bookings").select("*")
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(offset, offset + BOOKING_PAGE);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) return failed();
  const hasMore = data.length > BOOKING_PAGE;
  const items = await mapBookings(supabase, data.slice(0, BOOKING_PAGE));
  return json({ items, hasMore, nextOffset: hasMore ? offset + BOOKING_PAGE : null });
}

async function handleAdminBookingUpdate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.id !== "string" || !UUID_RE.test(body.id)) return bad();
  if (body.status !== undefined && !STATUSES.includes(body.status)) return bad();
  if (body.payment_status !== undefined && !PAYMENT_STATUSES.includes(body.payment_status)) return bad();
  let notes = null;
  let clearNotes = false;
  if (body.notes !== undefined) {
    if (body.notes === null) clearNotes = true;
    else {
      const parsed = optStr(body.notes, 0, 1000);
      if (parsed.invalid) return bad();
      if (parsed.value === null) clearNotes = true;
      else notes = parsed.value;
    }
  }
  if (body.status === undefined && body.payment_status === undefined && body.notes === undefined) return bad();

  // One transaction: payment-flag changes mirror into the append-only ledger
  // inside the RPC, so the flag and the ledger can never diverge.
  const { data, error } = await supabase.rpc("admin_update_booking", {
    p_booking_id: body.id,
    p_status: body.status ?? null,
    p_payment_status: body.payment_status ?? null,
    p_notes: notes,
    p_clear_notes: clearNotes,
    p_actor: "admin",
  });
  if (error) {
    if (String(error.message ?? "").includes("booking_not_found")) return json({ error: "not_found" }, 404);
    const f = rpcFailure(error);
    return json({ error: f.error }, f.status);
  }
  if (!data) return json({ error: "not_found" }, 404);
  const [booking] = await mapBookings(supabase, [data]);
  return json({ ok: true, booking });
}

// ============================ ADMIN: stats ============================

async function handleAdminStats(request, supabase) {
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
      outstandingMap, revenue,
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
      aggregateOutstanding(supabase),
      revenueStats(supabase),
    ]);
    let outstanding = 0;
    for (const v of outstandingMap.values()) if (v > 0) outstanding += v;
    return json({
      ok: true,
      stats: {
        pending, confirmed, active: confirmed + delivered, unpaid,
        total_bookings: totalBookings, revenue: revenue.revenue, revenue_today: revenue.revenueToday, outstanding,
        consoles_total: consolesTotal, consoles_available: consolesAvailable,
        consoles_rented: consolesRented, consoles_maintenance: consolesMaint, consoles_retired: consolesRetired,
        maintenance_open: maintOpen + maintProgress,
        games_total: gamesTotal, games_available: gamesAvailable,
        incidents_open: incidentsOpen,
      },
    });
  } catch {
    return failed();
  }
}

// ============================ ADMIN: customers ============================

async function handleAdminCustomers(request, supabase) {
  const { data: customers, error } = await supabase.from("customers").select("*")
    .order("created_at", { ascending: false }).limit(500);
  if (error || !Array.isArray(customers)) return failed();

  // Aggregates are computed in SQL (0013): complete at any row count, and
  // outstanding uses the same Model C function as the credit gate.
  let summaries;
  let outstandingMap;
  try {
    const { data, error: sErr } = await supabase.rpc("customer_summaries");
    if (sErr || !Array.isArray(data)) return failed();
    summaries = new Map(data.map((s) => [s.customer_id, s]));
    outstandingMap = await aggregateOutstanding(supabase);
  } catch { return failed(); }

  const rows = customers.map((c) => {
    const s = summaries.get(c.id);
    return {
      id: c.id,
      name: c.full_name,
      phone: c.phone ?? "",
      zone_key: s?.zone_key ?? "other",
      bookings: Number(s?.bookings ?? 0),
      spend: Number(s?.spend ?? 0),
      open: Number(s?.open ?? 0),
      last_at: s?.last_at ?? c.created_at,
      email: c.email ?? null,
      customer_tier: c.customer_tier,
      credit_limit: c.credit_limit,
      customer_status: c.customer_status,
      auth_user_id: c.auth_user_id,
      outstanding: outstandingMap.get(c.id) ?? 0,
    };
  }).sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)));
  return json({ ok: true, customers: rows });
}

const CUSTOMER_UPDATE_SPEC = {
  customer_tier: { type: "enum", allowed: CUSTOMER_TIERS },
  credit_limit: { type: "int", min: 0, max: 100000000 },
  customer_status: { type: "enum", allowed: CUSTOMER_STATUSES },
  notes: { type: "str", min: 0, max: 1000 },
};

async function handleAdminCustomerUpdate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.id !== "string" || !UUID_RE.test(body.id)) return bad();
  const parsed = collectFields(body, CUSTOMER_UPDATE_SPEC);
  if (parsed.error) return bad();
  const fields = parsed.fields;
  if (Object.keys(fields).length === 0) return bad();

  // The RPC enforces the non-premium-no-credit rule, syncs the legacy profile
  // tier and sets app.actor so the audit triggers record the real actor.
  const { data, error } = await supabase.rpc("admin_update_customer", {
    p_customer_id: body.id,
    p_customer_tier: fields.customer_tier ?? null,
    p_credit_limit: fields.credit_limit ?? null,
    p_customer_status: fields.customer_status ?? null,
    p_notes: fields.notes ?? null,
    p_clear_notes: Object.hasOwn(fields, "notes") && fields.notes === null,
    p_actor: "admin",
  });
  if (error) {
    if (String(error.message ?? "").includes("customer_not_found")) return json({ error: "not_found" }, 404);
    const f = rpcFailure(error);
    return json({ error: f.error }, f.status);
  }
  if (!data) return json({ error: "not_found" }, 404);
  return json({ ok: true, customer: data });
}

async function handleAdminCreditEvents(request, supabase) {
  const p = new URL(request.url).searchParams;
  const customerId = p.get("customer_id");
  if (customerId && !UUID_RE.test(customerId)) return bad();
  const r = await listRows(supabase, "customer_credit_events", { order: "created_at", filters: { customer_id: customerId }, limit: 500 });
  if (r.badInput) return bad();
  if (r.failed) return failed();
  return json({ ok: true, items: r.data });
}

// ============================ ADMIN: linking ============================

async function handleAdminLinks(request, supabase) {
  const p = new URL(request.url).searchParams;
  const status = p.get("status");
  const r = await listRows(supabase, "customer_links", {
    order: "created_at", filters: { status: status || "pending" },
    guards: { status: ["pending", "linked", "rejected", "conflict"] }, limit: 500,
  });
  if (r.badInput) return bad();
  if (r.failed) return failed();
  const { mapById } = await import("./lib/mapping.mjs");
  const customers = await mapById(supabase, "customers", r.data.map((l) => l.customer_id), "id,full_name,phone");
  const items = r.data.map((l) => ({ ...l, customer_name: customers.get(l.customer_id)?.full_name ?? "", customer_phone: customers.get(l.customer_id)?.phone ?? null }));
  return json({ ok: true, items });
}

async function handleAdminLinkApprove(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.link_id !== "string" || !UUID_RE.test(body.link_id)) return bad();
  try {
    const res = await approveLink(supabase, body.link_id, body.evidence);
    return res.error ? json({ error: res.error }, res.status) : json(res);
  } catch {
    return failed();
  }
}

async function handleAdminLinkReject(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.link_id !== "string" || !UUID_RE.test(body.link_id)) return bad();
  try {
    const res = await rejectLink(supabase, body.link_id, body.reason);
    return res.error ? json({ error: res.error }, res.status) : json(res);
  } catch {
    return failed();
  }
}

// ============================ ADMIN: rentals ============================

async function handleAdminRentals(request, supabase) {
  const p = new URL(request.url).searchParams;
  const status = p.get("status");
  if (status && !RENTAL_STATUSES.includes(status)) return bad();
  const customerId = p.get("customer_id");
  if (customerId && !UUID_RE.test(customerId)) return bad();
  const bookingId = p.get("booking_id");
  if (bookingId && !UUID_RE.test(bookingId)) return bad();
  const r = await listRows(supabase, "rentals", {
    order: "created_at", filters: { status, customer_id: customerId, booking_id: bookingId }, limit: 500,
  });
  if (r.badInput) return bad();
  if (r.failed) return failed();
  return json({ ok: true, items: await mapRentals(supabase, r.data) });
}

async function handleAdminRentalHandover(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || !UUID_RE.test(String(body.booking_id)) || !UUID_RE.test(String(body.console_id))) return bad();
  try {
    const res = await handoverRental(supabase, body);
    return res.error ? json({ error: res.error }, res.status) : json(res);
  } catch {
    return failed();
  }
}

async function handleAdminRentalReturn(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || !UUID_RE.test(String(body.rental_id))) return bad();
  if (body.late_fee !== undefined && (!Number.isInteger(body.late_fee) || body.late_fee < 0)) return bad();
  try {
    const res = await returnRental(supabase, body);
    return res.error ? json({ error: res.error }, res.status) : json(res);
  } catch {
    return failed();
  }
}

async function handleAdminRentalOverdue(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || !UUID_RE.test(String(body.rental_id))) return bad();
  try {
    const res = await markOverdue(supabase, body.rental_id);
    return res.error ? json({ error: res.error }, res.status) : json(res);
  } catch {
    return failed();
  }
}

// ============================ ADMIN: entity specs ============================

const CONSOLE_SPEC = {
  unit_code: { type: "str", min: 2, max: 32 },
  model: { type: "str", min: 2, max: 64 },
  serial_number: { type: "str", min: 2, max: 64 },
  status: { type: "enum", allowed: CONSOLE_STATUSES },
  condition_grade: { type: "enum", allowed: CONSOLE_CONDITIONS },
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
const INCIDENT_SPEC = {
  kind: { type: "enum", allowed: INCIDENT_KINDS },
  severity: { type: "enum", allowed: INCIDENT_SEVERITIES },
  status: { type: "enum", allowed: INCIDENT_STATUSES },
  description: { type: "str", min: 1, max: 1000 },
  claim_amount: { type: "int", min: 0, max: 100000000 },
  resolved_amount: { type: "int", min: 0, max: 100000000 },
  occurred_at: { type: "iso" },
};

// ---- Consoles ----
async function handleAdminConsoles(request, supabase) {
  const p = new URL(request.url).searchParams;
  const r = await listRows(supabase, "consoles", { order: "unit_code", orderAsc: true, filters: { status: p.get("status") }, guards: { status: CONSOLE_STATUSES } });
  if (r.badInput) return bad();
  if (r.failed) return failed();
  return json({ ok: true, items: await mapConsoles(supabase, r.data) });
}
async function handleAdminConsoleCreate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body) return bad();
  const parsed = collectFields(body, CONSOLE_SPEC);
  if (parsed.error) return bad();
  const f = parsed.fields;
  if (!hasRequired(f, ["unit_code", "model", "status", "condition_grade"])) return bad();
  if (!/^[A-Za-z0-9][A-Za-z0-9\- ]{1,31}$/.test(f.unit_code)) return bad();
  const row = {
    id: crypto.randomUUID(), unit_code: f.unit_code, model: f.model, serial_number: f.serial_number ?? null,
    status: f.status, condition_grade: f.condition_grade,
    last_audit_at: f.last_audit_at ?? null, purchased_at: f.purchased_at ?? null, notes: f.notes ?? null,
  };
  const { data, error } = await supabase.from("consoles").insert(row).select("*").single();
  if (error) return json({ error: error.code === "23505" ? "duplicate_unit_code" : "database_request_failed" }, error.code === "23505" ? 409 : 503);
  const [item] = await mapConsoles(supabase, [data]);
  return json({ ok: true, item });
}
async function handleAdminConsoleUpdate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.id !== "string" || !UUID_RE.test(body.id)) return bad();
  const parsed = collectFields(body, CONSOLE_SPEC);
  if (parsed.error) return bad();
  const fields = parsed.fields;
  delete fields.unit_code; // immutable once issued
  if (Object.keys(fields).length === 0) return bad();
  const { data, error } = await supabase.from("consoles").update(fields).eq("id", body.id).select("*").maybeSingle();
  if (error) return failed();
  if (!data) return json({ error: "not_found" }, 404);
  const [item] = await mapConsoles(supabase, [data]);
  return json({ ok: true, item });
}

// ---- Maintenance ----
async function handleAdminMaintenance(request, supabase) {
  const p = new URL(request.url).searchParams;
  const consoleId = p.get("console_id");
  if (consoleId && !UUID_RE.test(consoleId)) return bad();
  const r = await listRows(supabase, "maintenance", { order: "opened_at", filters: { status: p.get("status"), console_id: consoleId }, guards: { status: MAINT_STATUSES } });
  if (r.badInput) return bad();
  if (r.failed) return failed();
  return json({ ok: true, items: await mapMaintenance(supabase, r.data) });
}
async function handleAdminMaintenanceCreate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.console_id !== "string" || !UUID_RE.test(body.console_id)) return bad();
  const parsed = collectFields(body, MAINT_SPEC);
  if (parsed.error) return bad();
  const f = parsed.fields;
  if (!hasRequired(f, ["issue", "status", "priority"])) return bad();
  const { data: con, error: conErr } = await supabase.from("consoles").select("id,unit_code").eq("id", body.console_id).maybeSingle();
  if (conErr) return failed();
  if (!con) return json({ error: "console_not_found" }, 400);
  const row = {
    id: crypto.randomUUID(), console_id: body.console_id, issue: f.issue, status: f.status, priority: f.priority,
    engineer: f.engineer ?? null, cost: Number.isInteger(f.cost) ? f.cost : null, notes: f.notes ?? null,
    opened_at: f.opened_at ?? new Date().toISOString(), resolved_at: f.resolved_at ?? null,
  };
  const { data, error } = await supabase.from("maintenance").insert(row).select("*").single();
  if (error) return failed();
  const [item] = await mapMaintenance(supabase, [data]);
  return json({ ok: true, item });
}
async function handleAdminMaintenanceUpdate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.id !== "string" || !UUID_RE.test(body.id)) return bad();
  const parsed = collectFields(body, MAINT_SPEC);
  if (parsed.error) return bad();
  const fields = parsed.fields;
  if (Object.keys(fields).length === 0) return bad();
  const { data, error } = await supabase.from("maintenance").update(fields).eq("id", body.id).select("*").maybeSingle();
  if (error) return failed();
  if (!data) return json({ error: "not_found" }, 404);
  const [item] = await mapMaintenance(supabase, [data]);
  return json({ ok: true, item });
}

// ---- Games ----
async function handleAdminGames(request, supabase) {
  const p = new URL(request.url).searchParams;
  const r = await listRows(supabase, "games", { order: "title", orderAsc: true, filters: { platform: p.get("platform"), status: p.get("status") }, guards: { platform: GAME_PLATFORMS, status: GAME_STATUSES } });
  if (r.badInput) return bad();
  if (r.failed) return failed();
  return json({ ok: true, items: r.data });
}
async function handleAdminGameCreate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body) return bad();
  const parsed = collectFields(body, GAME_SPEC);
  if (parsed.error) return bad();
  const f = parsed.fields;
  if (!hasRequired(f, ["title", "platform"])) return bad();
  if (f.cover_url && !/^https?:\/\/[^\s]+$/i.test(f.cover_url)) return bad();
  const row = {
    id: crypto.randomUUID(), title: f.title, platform: f.platform, genre: f.genre ?? null,
    media_format: f.media_format ?? null, cover_url: f.cover_url ?? null, status: f.status ?? "available",
  };
  const { data, error } = await supabase.from("games").insert(row).select("*").single();
  if (error) return failed();
  return json({ ok: true, item: data });
}
async function handleAdminGameUpdate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.id !== "string" || !UUID_RE.test(body.id)) return bad();
  const parsed = collectFields(body, GAME_SPEC);
  if (parsed.error) return bad();
  const fields = parsed.fields;
  if (fields.cover_url && !/^https?:\/\/[^\s]+$/i.test(fields.cover_url)) return bad();
  if (Object.keys(fields).length === 0) return bad();
  const { data, error } = await supabase.from("games").update(fields).eq("id", body.id).select("*").maybeSingle();
  if (error) return failed();
  if (!data) return json({ error: "not_found" }, 404);
  return json({ ok: true, item: data });
}

// ---- Transactions (append-only payments ledger) ----
async function handleAdminTransactions(request, supabase) {
  const p = new URL(request.url).searchParams;
  const r = await listRows(supabase, "payments", {
    order: "occurred_at", filters: { status: p.get("status"), kind: p.get("kind"), method: p.get("method") },
    guards: { status: TXN_STATUSES, kind: TXN_KINDS, method: TXN_METHODS },
  });
  if (r.badInput) return bad();
  if (r.failed) return failed();
  return json({ ok: true, items: await mapTransactions(supabase, r.data) });
}

// Resolve the customer for a ledger/incident entry from explicit id, booking, or phone.
async function resolveCustomerId(supabase, body) {
  if (typeof body.customer_id === "string" && UUID_RE.test(body.customer_id)) return body.customer_id;
  if (typeof body.booking_id === "string" && UUID_RE.test(body.booking_id)) {
    const { data } = await supabase.from("bookings").select("customer_id").eq("id", body.booking_id).maybeSingle();
    if (data?.customer_id) return data.customer_id;
  }
  const phone = normalizePhone(body.customer_phone);
  if (phone) {
    const { data } = await supabase.from("customers").select("id,auth_user_id").eq("phone", phone).order("created_at", { ascending: true });
    const hit = (data ?? [])[0];
    if (hit) return hit.id;
  }
  return null;
}

async function handleAdminTransactionCreate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body) return bad();
  const customerId = await resolveCustomerId(supabase, body);
  if (!customerId) return json({ error: "customer_required", status: 400 });
  const bk = optUuid(body.booking_id);
  if (bk.invalid) return bad();
  const rl = optUuid(body.rental_id);
  if (rl.invalid) return bad();
  const occurred = optIso(body.occurred_at);
  if (occurred.invalid) return bad();
  const res = await appendPayment(supabase, {
    customer_id: customerId,
    booking_id: bk.value,
    rental_id: rl.value,
    amount: body.amount,
    kind: body.kind,
    method: body.method,
    status: body.status ?? "settled",
    external_reference: typeof body.external_reference === "string" ? body.external_reference.slice(0, 200) : null,
    notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : null,
    occurred_at: occurred.value ?? undefined,
    recorded_by: "admin",
  });
  if (res.error) return json({ error: res.error }, res.status);
  const [item] = await mapTransactions(supabase, [res.row]);
  return json({ ok: true, item });
}

// CONTRACT CHANGE (README §7.3): payments is append-only, so an "update" appends a
// correcting/reversing entry instead of editing the original row.
async function handleAdminTransactionUpdate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.id !== "string" || !UUID_RE.test(body.id)) return bad();
  const { data: original, error } = await supabase.from("payments").select("*").eq("id", body.id).maybeSingle();
  if (error) return failed();
  if (!original) return json({ error: "not_found" }, 404);
  const amount = body.amount !== undefined ? Number(body.amount) : -original.amount;
  const kind = body.kind ?? (amount < 0 ? "refund" : "adjustment");
  const occurred = optIso(body.occurred_at);
  if (occurred.invalid) return bad();
  const res = await appendPayment(supabase, {
    customer_id: original.customer_id,
    booking_id: original.booking_id,
    rental_id: original.rental_id,
    amount,
    kind,
    method: body.method ?? original.method,
    status: body.status ?? "settled",
    external_reference: original.ref,
    notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : `Correction of ${original.ref}`,
    occurred_at: occurred.value ?? undefined,
    recorded_by: "admin",
  });
  if (res.error) return json({ error: res.error }, res.status);
  const [item] = await mapTransactions(supabase, [res.row]);
  return json({ ok: true, item, reversed_ref: original.ref, appended: true });
}

async function handleAdminRefund(request, supabase) {
  const body = await readJsonBody(request);
  if (!body) return bad();
  const customerId = await resolveCustomerId(supabase, body);
  if (!customerId) return json({ error: "customer_required", status: 400 });
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0) return bad(); // refund given as positive magnitude
  const bk = optUuid(body.booking_id);
  if (bk.invalid) return bad();
  const res = await appendPayment(supabase, {
    customer_id: customerId, booking_id: bk.value, rental_id: optUuid(body.rental_id).value,
    amount: -amount, kind: "refund", method: body.method ?? "mpesa", status: "settled",
    notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : null, recorded_by: "admin",
  });
  if (res.error) return json({ error: res.error }, res.status);
  const [item] = await mapTransactions(supabase, [res.row]);
  return json({ ok: true, item });
}

// ---- Incidents ----
async function handleAdminIncidents(request, supabase) {
  const p = new URL(request.url).searchParams;
  const r = await listRows(supabase, "incidents", {
    order: "occurred_at", filters: { status: p.get("status"), severity: p.get("severity"), kind: p.get("kind") },
    guards: { status: INCIDENT_STATUSES, severity: INCIDENT_SEVERITIES, kind: INCIDENT_KINDS },
  });
  if (r.badInput) return bad();
  if (r.failed) return failed();
  return json({ ok: true, items: await mapIncidents(supabase, r.data) });
}
async function handleAdminIncidentCreate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body) return bad();
  const bk = optUuid(body.booking_id);
  if (bk.invalid) return bad();
  const con = optUuid(body.console_id);
  if (con.invalid) return bad();
  const rl = optUuid(body.rental_id);
  if (rl.invalid) return bad();
  const parsed = collectFields(body, INCIDENT_SPEC);
  if (parsed.error) return bad();
  const f = parsed.fields;
  if (!hasRequired(f, ["kind", "severity", "status"])) return bad();
  const customerId = await resolveCustomerId(supabase, body);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = {
      id: crypto.randomUUID(), ref: makeIncidentRef(), customer_id: customerId,
      booking_id: bk.value, rental_id: rl.value, console_id: con.value,
      kind: f.kind, severity: f.severity, status: f.status, description: f.description ?? null,
      claim_amount: Number.isInteger(f.claim_amount) ? f.claim_amount : null,
      resolved_amount: Number.isInteger(f.resolved_amount) ? f.resolved_amount : null,
      occurred_at: f.occurred_at ?? new Date().toISOString(),
    };
    const { data, error } = await supabase.from("incidents").insert(row).select("*").single();
    if (!error && data) {
      const [item] = await mapIncidents(supabase, [data]);
      return json({ ok: true, item });
    }
    if (!error || error.code !== "23505") return failed();
  }
  return failed();
}
async function handleAdminIncidentUpdate(request, supabase) {
  const body = await readJsonBody(request);
  if (!body || typeof body.id !== "string" || !UUID_RE.test(body.id)) return bad();
  const parsed = collectFields(body, INCIDENT_SPEC);
  if (parsed.error) return bad();
  const fields = parsed.fields;
  const bk = optUuid(body.booking_id);
  if (bk.invalid) return bad();
  if (body.booking_id !== undefined) fields.booking_id = bk.value;
  const con = optUuid(body.console_id);
  if (con.invalid) return bad();
  if (body.console_id !== undefined) fields.console_id = con.value;
  const rl = optUuid(body.rental_id);
  if (rl.invalid) return bad();
  if (body.rental_id !== undefined) fields.rental_id = rl.value;
  if (body.customer_id !== undefined) {
    const cu = optUuid(body.customer_id);
    if (cu.invalid) return bad();
    fields.customer_id = cu.value;
  }
  if (Object.keys(fields).length === 0) return bad();
  const { data, error } = await supabase.from("incidents").update(fields).eq("id", body.id).select("*").maybeSingle();
  if (error) return failed();
  if (!data) return json({ error: "not_found" }, 404);
  const [item] = await mapIncidents(supabase, [data]);
  return json({ ok: true, item });
}

// ============================ ADMIN: KYC ============================

async function handleAdminKyc(request, supabase) {
  const p = new URL(request.url).searchParams;
  const status = p.get("status");
  if (status && !KYC_DOC_STATUSES.includes(status)) return bad();
  const customerId = p.get("customer_id");
  if (customerId && !UUID_RE.test(customerId)) return bad();
  const r = await listRows(supabase, "kyc_documents", { order: "created_at", filters: { verification_status: status, customer_id: customerId }, limit: 500 });
  if (r.badInput) return bad();
  if (r.failed) return failed();
  return json({ ok: true, items: await listKycDocuments(supabase, r.data) });
}
async function handleAdminKycVerify(request, supabase) {
  const body = await readJsonBody(request);
  if (!body) return bad();
  try {
    const res = await adminVerifyKyc(supabase, { ...body, verified_by: "admin" });
    return res.error ? json({ error: res.error }, res.status) : json(res);
  } catch {
    return failed();
  }
}
async function handleAdminKycUrl(request, supabase) {
  const p = new URL(request.url).searchParams;
  const documentId = p.get("document_id");
  if (!documentId || !UUID_RE.test(documentId)) return bad();
  try {
    const res = await adminKycDownloadUrl(supabase, documentId);
    return res.error ? json({ error: res.error }, res.status) : json(res);
  } catch {
    return failed();
  }
}

// ============================ ROUTER ============================

const CUSTOMER_GET = {
  my_bookings: handleMyBookings,
  auth_me: handleAuthMe,
  my_rentals: handleMyRentals,
  my_payments: handleMyPayments,
};
const CUSTOMER_POST = {
  create_booking: handleCreateBooking,
  register_customer: handleRegisterCustomer,
  link_guest: handleLinkGuest,
  kyc_submit: handleSubmitKyc,
  kyc_upload_url: handleKycUploadUrl,
  kyc_register: handleKycRegister,
};
const ADMIN_GET = {
  admin_bookings: handleAdminBookings,
  admin_stats: handleAdminStats,
  admin_customers: handleAdminCustomers,
  admin_credit_events: handleAdminCreditEvents,
  admin_links: handleAdminLinks,
  admin_rentals: handleAdminRentals,
  admin_consoles: handleAdminConsoles,
  admin_maintenance: handleAdminMaintenance,
  admin_games: handleAdminGames,
  admin_transactions: handleAdminTransactions,
  admin_incidents: handleAdminIncidents,
  admin_kyc: handleAdminKyc,
  admin_kyc_url: handleAdminKycUrl,
  admin_totp_status: handleAdminTotpStatus,
};
const ADMIN_POST = {
  admin_booking_update: handleAdminBookingUpdate,
  admin_customer_update: handleAdminCustomerUpdate,
  admin_link_approve: handleAdminLinkApprove,
  admin_link_reject: handleAdminLinkReject,
  admin_rental_handover: handleAdminRentalHandover,
  admin_rental_return: handleAdminRentalReturn,
  admin_rental_overdue: handleAdminRentalOverdue,
  admin_console_create: handleAdminConsoleCreate,
  admin_console_update: handleAdminConsoleUpdate,
  admin_maintenance_create: handleAdminMaintenanceCreate,
  admin_maintenance_update: handleAdminMaintenanceUpdate,
  admin_game_create: handleAdminGameCreate,
  admin_game_update: handleAdminGameUpdate,
  admin_transaction_create: handleAdminTransactionCreate,
  admin_transaction_update: handleAdminTransactionUpdate,
  admin_refund: handleAdminRefund,
  admin_incident_create: handleAdminIncidentCreate,
  admin_incident_update: handleAdminIncidentUpdate,
  admin_kyc_verify: handleAdminKycVerify,
  admin_totp_setup: handleAdminTotpSetup,
  admin_totp_verify: handleAdminTotpVerify,
};

async function dispatch({ request, supabase, env }) {
  if (request.method === "OPTIONS") return preflight();
  const action = new URL(request.url).searchParams.get("action");
  try {
    if (Object.hasOwn(CUSTOMER_GET, action)) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      return await CUSTOMER_GET[action](request, supabase);
    }
    if (Object.hasOwn(CUSTOMER_POST, action)) {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      return await CUSTOMER_POST[action](request, supabase);
    }
    if (action === "admin_login") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      return await handleAdminLogin(request, env);
    }
    if (action === "admin_recover") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      return await handleAdminRecover(request, env, supabase);
    }
    if (typeof action === "string" && action.startsWith("admin_")) {
      const denied = await requireAdmin(request, env);
      if (denied) return denied;
      if (Object.hasOwn(ADMIN_GET, action)) {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
        return await ADMIN_GET[action](request, supabase);
      }
      if (Object.hasOwn(ADMIN_POST, action)) {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        return await ADMIN_POST[action](request, supabase);
      }
    }
    return json({ error: "not_found" }, 404);
  } catch {
    return failed();
  }
}

export async function handleApi(ctx) {
  const response = await dispatch(ctx);
  for (const [name, value] of Object.entries(corsOriginHeaders(ctx.request, ctx.env))) {
    response.headers.set(name, value);
  }
  return response;
}