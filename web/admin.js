"use strict";

const API = "/functions/v1/app";
const TOKEN_KEY = "pg-admin-token";

const $ = (sel) => document.querySelector(sel);
const fmtTZS = (n) => `TZS ${new Intl.NumberFormat("en-US").format(Math.round(n || 0))}`;

const STATUS_LABELS = { pending: "Pending", confirmed: "Confirmed", delivered: "On rent", completed: "Completed", cancelled: "Cancelled" };
const PAY_LABELS = { unpaid: "Unpaid", paid: "Paid" };
const PKG_LABELS = { starter: "Starter", weekend: "Weekend", night: "Night" };
const ZONE_LABELS = {
  goba: "Goba / Kimara / Ubungo", sinza: "Sinza / Mwenge / Makumbusho / Kijitonyama",
  mbezi: "Mbezi Beach / Kawe / Tegeta", kigamboni: "Kigamboni",
  magomeni: "Magomeni / Kariakoo / Kinondoni / Morocco", oyster: "Oyster Bay / Mikocheni / Masaki",
  other: "Other area",
};
const ID_LABELS = { nida: "NIDA ID", licence: "Driver's licence", passport: "Passport" };
const PAY_METHOD_LABELS = { mpesa: "M-Pesa after confirmation", cod: "Pay on delivery" };
const FILTERS = ["", "pending", "confirmed", "delivered", "completed", "cancelled"];

let currentFilter = "";
let nextOffset = null;
let bookingItems = [];
let customersLoaded = false;

async function api(action, { method = "GET", body, auth = false, params = {} } = {}) {
  const qs = new URLSearchParams({ action, ...params });
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth) headers["x-admin-token"] = sessionStorage.getItem(TOKEN_KEY) || "";
  const res = await fetch(`${API}?${qs}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON gateway response */ }
  if (!res.ok || !data) {
    const err = new Error((data && data.error) || `http_${res.status}`);
    err.code = err.message;
    err.status = res.status;
    throw err;
  }
  return data;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showLogin(message) {
  sessionStorage.removeItem(TOKEN_KEY);
  $("#appView").hidden = true;
  $("#logoutBtn").hidden = true;
  $("#loginView").hidden = false;
  $("#loginError").hidden = !message;
  if (message) $("#loginError").textContent = message;
}

function showApp() {
  $("#loginView").hidden = true;
  $("#appView").hidden = false;
  $("#logoutBtn").hidden = false;
}

function loginErrorMessage(err) {
  if (err.code === "invalid_credentials") return "Wrong password. Please try again.";
  if (err.code === "service_not_configured") return "Admin access is not configured yet — the ADMIN_PASSWORD secret still needs to be set in Sites Settings.";
  if (err.code === "unauthorized") return "Your session expired. Please sign in again.";
  return "The admin service is unavailable right now. Please try again.";
}

// ---- Stats ----
async function loadStats() {
  const data = await api("admin_stats", { auth: true });
  const s = data.stats;
  const cards = [
    ["Pending", s.pending], ["Active rentals", s.active], ["Unpaid", s.unpaid],
    ["Total bookings", s.total_bookings], ["Revenue (paid)", fmtTZS(s.revenue)], ["Paid today", fmtTZS(s.revenue_today)],
  ];
  const row = $("#statsRow");
  row.textContent = "";
  for (const [label, value] of cards) {
    const card = el("div", "admin-stat");
    card.append(el("span", "admin-stat-value", String(value)), el("span", "admin-stat-label", label));
    row.append(card);
  }
}

// ---- Bookings ----
function fieldCell(label, value) {
  const wrap = el("div", "b-field");
  wrap.append(el("span", "b-label", label), el("span", "b-value", value ?? "—"));
  return wrap;
}

function bookingCard(b) {
  const card = el("article", "booking-card");
  card.dataset.id = b.id;

  const head = el("div", "booking-head");
  head.append(el("strong", "booking-ref", b.ref));
  head.append(el("span", `badge badge-${b.status}`, STATUS_LABELS[b.status] || b.status));
  head.append(el("span", `badge badge-pay-${b.payment_status}`, PAY_LABELS[b.payment_status] || b.payment_status));
  head.append(el("span", "booking-total", fmtTZS(b.total)));

  const unit = b.package_key === "weekend" ? "Fri–Sun" : (b.package_key === "night" ? `night${b.days > 1 ? "s" : ""}` : `day${b.days > 1 ? "s" : ""}`);
  const grid = el("div", "booking-grid");
  grid.append(
    fieldCell("Customer", `${b.customer_name} · ${b.customer_phone}`),
    fieldCell("Package", `${PKG_LABELS[b.package_key] || b.package_key} · ${b.days} ${unit}`),
    fieldCell("Schedule", `${b.start_date} at ${b.start_time}`),
    fieldCell("Area", `${ZONE_LABELS[b.zone_key] || b.zone_key} — ${b.address}`),
    fieldCell("Payment method", PAY_METHOD_LABELS[b.payment_method] || b.payment_method),
    fieldCell("Delivery fee", b.delivery_fee === null ? "To agree with rider" : (b.delivery_fee === 0 ? "Free" : fmtTZS(b.delivery_fee))),
  );

  const manageBtn = el("button", "btn btn-ghost btn-sm", "Manage");
  manageBtn.type = "button";
  manageBtn.setAttribute("aria-expanded", "false");

  const details = el("div", "booking-details");
  details.hidden = true;
  const dGrid = el("div", "booking-grid");
  dGrid.append(
    fieldCell("ID (KYC)", `${ID_LABELS[b.id_type] || b.id_type} · ${b.id_number}`),
    fieldCell("Emergency contact", `${b.ec_name} · ${b.ec_phone}`),
    fieldCell("Rental", `${fmtTZS(b.rental_amount)}${b.discount ? ` (after −${fmtTZS(b.discount)} discount)` : ""}`),
    fieldCell("Created", new Date(b.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })),
  );
  const controls = el("div", "booking-controls");
  const statusSelect = el("select", "admin-select");
  for (const key of Object.keys(STATUS_LABELS)) {
    const opt = el("option", null, STATUS_LABELS[key]);
    opt.value = key;
    if (key === b.status) opt.selected = true;
    statusSelect.append(opt);
  }
  const paySelect = el("select", "admin-select");
  for (const key of Object.keys(PAY_LABELS)) {
    const opt = el("option", null, PAY_LABELS[key]);
    opt.value = key;
    if (key === b.payment_status) opt.selected = true;
    paySelect.append(opt);
  }
  const notesInput = el("textarea", "admin-textarea");
  notesInput.rows = 2;
  notesInput.placeholder = "Internal notes (delivery rider, M-Pesa reference, …)";
  notesInput.value = b.notes || "";
  const saveBtn = el("button", "btn btn-primary btn-sm", "Save changes");
  saveBtn.type = "button";
  const saveMsg = el("span", "save-msg");
  controls.append(
    el("label", "control-label", "Status"), statusSelect,
    el("label", "control-label", "Payment"), paySelect,
    el("label", "control-label", "Notes"), notesInput,
    saveBtn, saveMsg,
  );

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveMsg.textContent = "Saving…";
    saveMsg.className = "save-msg";
    try {
      const data = await api("admin_booking_update", {
        method: "POST", auth: true,
        body: { id: b.id, status: statusSelect.value, payment_status: paySelect.value, notes: notesInput.value.trim() },
      });
      Object.assign(b, data.booking);
      const idx = bookingItems.findIndex((x) => x.id === b.id);
      if (idx >= 0) bookingItems[idx] = b;
      const fresh = bookingCard(b);
      card.replaceWith(fresh);
      const freshManage = fresh.querySelector("button[aria-expanded]");
      fresh.querySelector(".booking-details").hidden = false;
      freshManage.setAttribute("aria-expanded", "true");
      freshManage.textContent = "Close";
      saveMsg.textContent = "";
      loadStats().catch(() => {});
    } catch (err) {
      if (err.code === "unauthorized") { showLogin(loginErrorMessage(err)); return; }
      saveMsg.textContent = err.code === "not_found" ? "Booking not found." : "Save failed — please try again.";
      saveMsg.className = "save-msg save-error";
    }
    saveBtn.disabled = false;
  });

  manageBtn.addEventListener("click", () => {
    details.hidden = !details.hidden;
    manageBtn.setAttribute("aria-expanded", details.hidden ? "false" : "true");
    manageBtn.textContent = details.hidden ? "Manage" : "Close";
  });

  details.append(dGrid, controls);
  card.append(head, grid, manageBtn, details);
  return card;
}

function renderFilters() {
  const wrap = $("#statusFilters");
  wrap.textContent = "";
  for (const key of FILTERS) {
    const chip = el("button", "chip admin-chip", key === "" ? "All" : STATUS_LABELS[key]);
    chip.type = "button";
    chip.classList.toggle("is-active", key === currentFilter);
    chip.addEventListener("click", () => {
      currentFilter = key;
      renderFilters();
      loadBookings(true).catch(handleFatal);
    });
    wrap.append(chip);
  }
}

async function loadBookings(reset) {
  if (reset) { bookingItems = []; nextOffset = 0; }
  const data = await api("admin_bookings", {
    auth: true,
    params: { offset: String(nextOffset ?? 0), ...(currentFilter ? { status: currentFilter } : {}) },
  });
  bookingItems = reset ? data.items : bookingItems.concat(data.items);
  nextOffset = data.hasMore ? data.nextOffset : null;
  const list = $("#bookingsList");
  list.textContent = "";
  for (const b of bookingItems) list.append(bookingCard(b));
  $("#bookingsEmpty").hidden = bookingItems.length > 0;
  $("#loadMoreBtn").hidden = !data.hasMore;
}

// ---- Customers ----
async function loadCustomers() {
  const data = await api("admin_customers", { auth: true });
  const body = $("#customersBody");
  body.textContent = "";
  for (const c of data.customers) {
    const tr = el("tr");
    for (const value of [
      c.name, c.phone, ZONE_LABELS[c.zone_key] || c.zone_key, String(c.bookings), String(c.open),
      fmtTZS(c.spend), new Date(c.last_at).toLocaleDateString("en-GB", { dateStyle: "medium" }),
    ]) tr.append(el("td", null, value));
    body.append(tr);
  }
  $("#customersEmpty").hidden = data.customers.length > 0;
  $("#customersWrap").hidden = data.customers.length === 0;
  customersLoaded = true;
}

function handleFatal(err) {
  if (err && err.code === "unauthorized") { showLogin(loginErrorMessage(err)); return; }
  const fatal = $("#adminFatal");
  fatal.hidden = false;
  fatal.textContent = "The admin service is unavailable right now. Please refresh and try again.";
}

async function refreshAll() {
  await loadStats();
  renderFilters();
  await loadBookings(true);
  if (!$("#customersPane").hidden) await loadCustomers();
}

document.addEventListener("DOMContentLoaded", () => {
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#loginBtn");
    btn.disabled = true;
    try {
      const data = await api("admin_login", { method: "POST", body: { password: $("#adminPassword").value } });
      sessionStorage.setItem(TOKEN_KEY, data.token);
      $("#adminPassword").value = "";
      showApp();
      $("#adminFatal").hidden = true;
      await refreshAll();
    } catch (err) {
      showLogin(loginErrorMessage(err));
    }
    btn.disabled = false;
  });

  $("#logoutBtn").addEventListener("click", () => showLogin());

  $("#loadMoreBtn").addEventListener("click", () => loadBookings(false).catch(handleFatal));

  $("#tabBookings").addEventListener("click", () => {
    $("#bookingsPane").hidden = false;
    $("#customersPane").hidden = true;
    $("#tabBookings").classList.add("active");
    $("#tabCustomers").classList.remove("active");
  });
  $("#tabCustomers").addEventListener("click", async () => {
    $("#bookingsPane").hidden = true;
    $("#customersPane").hidden = false;
    $("#tabCustomers").classList.add("active");
    $("#tabBookings").classList.remove("active");
    if (!customersLoaded) {
      try { await loadCustomers(); } catch (err) { handleFatal(err); }
    }
  });

  if (sessionStorage.getItem(TOKEN_KEY)) {
    showApp();
    refreshAll().catch(handleFatal);
  } else {
    showLogin();
  }
});
