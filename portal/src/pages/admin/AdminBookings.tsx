import { useMemo, useState } from "react";
import { adminApi } from "../../lib/adminApi";
import { ApiError } from "../../lib/api";
import type { Booking, BookingStatus, ConsoleUnit, Rental, RentalStatus } from "../../lib/adminTypes";
import {
  BOOKING_STATUS_TONE, CONDITION_LABEL, fmtDay, fmtStamp, PACKAGE_LABEL,
  PAYMENT_STATUS_TONE, RENTAL_STATUS_LABEL, RENTAL_STATUS_TONE, titleCase, ZONE_LABEL,
} from "../../lib/adminLabels";
import { Badge } from "../../components/ui";
import { Field, Modal, pingAlerts, useAsync, useToast } from "../../components/admin/AdminUi";
import { fmtTZS, returnDateTime } from "../../lib/format";

const TABS: ("all" | BookingStatus)[] = ["all", "pending", "confirmed", "delivered", "completed", "cancelled"];
const CONDITIONS = ["excellent", "good", "fair", "poor"] as const;
const RENTAL_TABS: ("all" | RentalStatus)[] = ["all", "active", "overdue", "returned", "scheduled", "cancelled"];

function handoverError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.message === "credit_limit_exceeded") return "Credit gate: this customer must settle the balance (Basic/Standard) or is over their premium credit limit. Record payment first.";
    if (e.message === "customer_not_active") return "Customer is suspended or blacklisted — handover blocked.";
    if (e.message === "console_already_rented" || e.message === "console_not_available") return "That console is no longer available — pick another unit.";
    if (e.message === "booking_not_handoverable") return "Only confirmed bookings can be handed over.";
    if (e.message === "rental_already_exists") return "This booking already has a rental.";
  }
  return e instanceof Error ? e.message : "Handover failed.";
}

function HandoverModal({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const consoles = useAsync(() => adminApi<{ items: ConsoleUnit[] }>("admin_consoles", { params: { status: "available" } }).then((r) => r.items), []);
  const [consoleId, setConsoleId] = useState("");
  const [condition, setCondition] = useState<(typeof CONDITIONS)[number]>("excellent");
  const defaultReturn = returnDateTime(booking.start_date, booking.start_time, booking.package_key === "weekend" ? 3 : booking.days, booking.package_key);
  const [returnAt, setReturnAt] = useState(defaultReturn.toISOString().slice(0, 16));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await adminApi("admin_rental_handover", {
        method: "POST",
        body: {
          booking_id: booking.id,
          console_id: consoleId,
          start_at: new Date().toISOString(),
          expected_return_at: new Date(returnAt).toISOString(),
          condition_out: condition,
          notes: notes.trim() || undefined,
        },
      });
      toast(`${booking.ref} handed over — console rented, booking delivered.`);
      onDone(); onClose();
    } catch (e) {
      setErr(handoverError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Hand over — ${booking.ref}`} sub={`${booking.customer_name} · ${PACKAGE_LABEL[booking.package_key] ?? booking.package_key} · ${fmtTZS(booking.total)} (${booking.payment_status})`}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" type="button" onClick={submit} disabled={busy || !consoleId}>{busy ? "Handing over…" : "Confirm handover"}</button>
      </>}>
      <p className="hint" style={{ margin: "0 0 10px" }}>
        The credit gate runs atomically: Basic/Standard must be fully settled; Premium must stay within their credit limit.
      </p>
      {consoles.loading ? <div className="spinner" /> : (
        <Field label="Console unit (available only)">
          <select value={consoleId} onChange={(e) => setConsoleId(e.target.value)}>
            <option value="">Select a unit…</option>
            {(consoles.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.unit_code} — {c.model} ({CONDITION_LABEL[c.condition_grade]})</option>)}
          </select>
        </Field>
      )}
      <div className="field-row">
        <Field label="Condition out">
          <select value={condition} onChange={(e) => setCondition(e.target.value as (typeof CONDITIONS)[number])}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label="Expected return">
          <input type="datetime-local" value={returnAt} onChange={(e) => setReturnAt(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes (optional)"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Accessories handed over…" /></Field>
      {err ? <p className="form-error" role="alert">{err}</p> : null}
    </Modal>
  );
}

function ReturnModal({ rental, onClose, onDone }: { rental: Rental; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [lateFee, setLateFee] = useState("0");
  const [condition, setCondition] = useState<(typeof CONDITIONS)[number]>("good");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await adminApi("admin_rental_return", {
        method: "POST",
        body: {
          rental_id: rental.id,
          actual_return_at: new Date().toISOString(),
          late_fee: Number(lateFee) || 0,
          condition_in: condition,
          notes: notes.trim() || undefined,
        },
      });
      toast(`${rental.booking_ref ?? "Rental"} returned — console freed, booking completed.`);
      onDone(); onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Return failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Return — ${rental.booking_ref ?? rental.id}`} sub={`${rental.customer_name} · unit ${rental.unit_code ?? "—"}`}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" type="button" onClick={submit} disabled={busy}>{busy ? "Processing…" : "Confirm return"}</button>
      </>}>
      <div className="field-row">
        <Field label="Condition in">
          <select value={condition} onChange={(e) => setCondition(e.target.value as (typeof CONDITIONS)[number])}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label="Late fee (TSh)">
          <input type="number" min={0} value={lateFee} onChange={(e) => setLateFee(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes (optional)"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Damage check, accessories returned…" /></Field>
      {err ? <p className="form-error" role="alert">{err}</p> : null}
    </Modal>
  );
}

export function AdminBookings() {
  const toast = useToast();
  const [tab, setTab] = useState<"all" | BookingStatus | "rentals">("all");
  const [rentalTab, setRentalTab] = useState<"all" | RentalStatus>("all");
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [handoverFor, setHandoverFor] = useState<Booking | null>(null);
  const [returnFor, setReturnFor] = useState<Rental | null>(null);
  const [offset, setOffset] = useState(0);
  const [pages, setPages] = useState<Booking[][]>([]);

  const isRentals = tab === "rentals";
  const statusParam = tab === "all" || isRentals ? undefined : tab;

  const bookings = useAsync(async () => {
    const r = await adminApi<{ items: Booking[]; hasMore: boolean; nextOffset: number }>("admin_bookings", {
      params: { status: statusParam, offset: offset || undefined },
    });
    return r;
  }, [nonce, tab, offset]);

  const rentals = useAsync(() => adminApi<{ items: Rental[] }>("admin_rentals", {
    params: { status: rentalTab === "all" ? undefined : rentalTab },
  }).then((r) => r.items), [nonce, rentalTab]);

  // Accumulate pages for the current filter; reset when the filter changes.
  const rows = useMemo(() => {
    const items = bookings.data?.items ?? [];
    if (offset === 0) return items;
    return [...pages.flat(), ...items];
  }, [bookings.data, offset, pages]);

  const reload = () => { setOffset(0); setPages([]); setNonce((n) => n + 1); pingAlerts(); };

  function loadMore() {
    if (!bookings.data?.hasMore) return;
    setPages((p) => [...p, bookings.data!.items]);
    setOffset(bookings.data!.nextOffset);
  }

  async function setStatus(b: Booking, status: BookingStatus) {
    if (busy) return;
    setBusy(b.id);
    try {
      await adminApi("admin_booking_update", { method: "POST", body: { id: b.id, status } });
      toast(`${b.ref} → ${titleCase(status)}.`);
      reload();
    } catch (e) { toast(e instanceof Error ? e.message : "Update failed.", "err"); }
    finally { setBusy(null); }
  }

  async function togglePaid(b: Booking) {
    if (busy) return;
    setBusy(b.id);
    try {
      await adminApi("admin_booking_update", { method: "POST", body: { id: b.id, payment_status: b.payment_status === "paid" ? "unpaid" : "paid" } });
      toast(`${b.ref} marked ${b.payment_status === "paid" ? "unpaid" : "paid"}.`);
      reload();
    } catch (e) { toast(e instanceof Error ? e.message : "Update failed.", "err"); }
    finally { setBusy(null); }
  }

  async function markOverdue(r: Rental) {
    if (busy) return;
    setBusy(r.id);
    try {
      await adminApi("admin_rental_overdue", { method: "POST", body: { rental_id: r.id } });
      toast(`${r.booking_ref ?? "Rental"} marked overdue.`);
      reload();
    } catch (e) { toast(e instanceof Error ? e.message : "Update failed.", "err"); }
    finally { setBusy(null); }
  }

  if (bookings.loading && offset === 0 && !isRentals) return <div className="spinner" />;
  if (bookings.error && !isRentals) return <p className="form-error">{bookings.error}</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bookings &amp; Rentals</h1>
          <p>Confirm orders, hand over consoles through the credit gate, and process returns.</p>
        </div>
      </div>

      <div className="adm-tabs" style={{ marginTop: 8 }}>
        {TABS.map((t) => (
          <button key={t} type="button" className={`adm-tab${tab === t ? " active" : ""}`} onClick={() => { setTab(t); setOffset(0); setPages([]); }}>
            {t === "all" ? "All" : titleCase(t)}
          </button>
        ))}
        <button type="button" className={`adm-tab${isRentals ? " active" : ""}`} onClick={() => setTab("rentals")}>Rentals</button>
      </div>

      {!isRentals ? (
        rows.length === 0 ? (
          <div className="empty"><strong>No bookings here</strong>Nothing matches this filter yet.</div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Ref</th><th>Customer</th><th>Package</th><th>Window</th><th>Total</th><th>Payment</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id}>
                      <td className="mono cyan">{b.ref}</td>
                      <td><strong>{b.customer_name}</strong><div style={{ color: "var(--dim)", fontSize: ".78rem" }}>{ZONE_LABEL[b.zone_key] ?? b.zone_key}</div></td>
                      <td>{PACKAGE_LABEL[b.package_key] ?? titleCase(b.package_key)} · {b.days}d</td>
                      <td className="mono">{fmtDay(b.start_date)}<div style={{ color: "var(--dim)", fontSize: ".78rem" }}>{fmtStamp(b.created_at)}</div></td>
                      <td className="mono">{fmtTZS(b.total)}</td>
                      <td><Badge tone={PAYMENT_STATUS_TONE[b.payment_status]}>{titleCase(b.payment_status)}</Badge></td>
                      <td><Badge tone={BOOKING_STATUS_TONE[b.status]}>{titleCase(b.status)}</Badge></td>
                      <td>
                        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {b.status === "pending" ? <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => setStatus(b, "confirmed")}>Confirm</button> : null}
                          {b.status === "confirmed" ? <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => setHandoverFor(b)}>Hand over</button> : null}
                          {b.status === "pending" || b.status === "confirmed" ? <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => setStatus(b, "cancelled")}>Cancel</button> : null}
                          <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => togglePaid(b)}>{b.payment_status === "paid" ? "Unpay" : "Mark paid"}</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
              {bookings.data?.hasMore ? <button className="btn btn-ghost btn-sm" type="button" onClick={loadMore} disabled={bookings.loading}>Load more</button> : null}
              <span className="hint">{rows.length} shown</span>
            </div>
          </>
        )
      ) : (
        <>
          <div className="adm-tabs" style={{ marginTop: 14 }}>
            {RENTAL_TABS.map((t) => (
              <button key={t} type="button" className={`adm-tab${rentalTab === t ? " active" : ""}`} onClick={() => setRentalTab(t)}>
                {t === "all" ? "All" : RENTAL_STATUS_LABEL[t]}
              </button>
            ))}
          </div>
          {rentals.loading ? <div className="spinner" /> : null}
          {rentals.error ? <p className="form-error">{rentals.error}</p> : null}
          {!rentals.loading && (rentals.data ?? []).length === 0 ? (
            <div className="empty"><strong>No rentals here</strong>Handovers create rentals; returns close them.</div>
          ) : null}
          {!rentals.loading && (rentals.data ?? []).length > 0 ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Booking</th><th>Customer</th><th>Unit</th><th>Out</th><th>Due back</th><th>Returned</th><th>Late fee</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {rentals.data!.map((r) => (
                    <tr key={r.id}>
                      <td className="mono cyan">{r.booking_ref ?? "—"}</td>
                      <td><strong>{r.customer_name}</strong></td>
                      <td className="mono">{r.unit_code ?? "—"}</td>
                      <td className="mono">{fmtStamp(r.start_at)}</td>
                      <td className="mono gold">{fmtStamp(r.expected_return_at)}</td>
                      <td className="mono">{fmtStamp(r.actual_return_at)}</td>
                      <td className="mono">{r.late_fee ? fmtTZS(r.late_fee) : "—"}</td>
                      <td><Badge tone={RENTAL_STATUS_TONE[r.status]}>{RENTAL_STATUS_LABEL[r.status]}</Badge></td>
                      <td>
                        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {r.status === "active" || r.status === "overdue" ? <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => setReturnFor(r)}>Return</button> : null}
                          {r.status === "active" ? <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => markOverdue(r)}>Mark overdue</button> : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}

      {handoverFor ? <HandoverModal booking={handoverFor} onClose={() => setHandoverFor(null)} onDone={reload} /> : null}
      {returnFor ? <ReturnModal rental={returnFor} onClose={() => setReturnFor(null)} onDone={reload} /> : null}
    </>
  );
}