import { useMemo, useState } from "react";
import { adminApi } from "../../lib/adminApi";
import type { Booking, BookingStatus } from "../../lib/adminTypes";
import { BOOKING_STATUS_TONE, fmtDay, fmtStamp, PACKAGE_LABEL, PAYMENT_STATUS_TONE, titleCase, ZONE_LABEL } from "../../lib/adminLabels";
import { Badge, StatCard } from "../../components/ui";
import { pingAlerts, useAsync, useToast } from "../../components/admin/AdminUi";
import { fmtTZS } from "../../lib/format";

const TABS: ("all" | BookingStatus)[] = ["all", "pending", "confirmed", "delivered", "completed", "cancelled"];

export function AdminBookings() {
  const toast = useToast();
  const [tab, setTab] = useState<"all" | BookingStatus>("all");
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const bookings = useAsync(() => adminApi<{ items: Booking[] }>("admin_bookings").then((r) => r.items), [nonce]);
  const reload = () => setNonce((n) => n + 1);

  const rows = useMemo(() => {
    const list = bookings.data ?? [];
    return list.filter((b) => tab === "all" || b.status === tab).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [bookings.data, tab]);

  const counts = useMemo(() => {
    const list = bookings.data ?? [];
    const by = (s: BookingStatus) => list.filter((b) => b.status === s).length;
    return { all: list.length, pending: by("pending"), confirmed: by("confirmed"), delivered: by("delivered"), completed: by("completed"), cancelled: by("cancelled") };
  }, [bookings.data]);

  async function setStatus(b: Booking, status: BookingStatus) {
    if (busy) return;
    setBusy(b.id);
    try {
      await adminApi("admin_booking_update", { method: "POST", body: { id: b.id, status } });
      toast(`${b.ref} → ${titleCase(status)}.`);
      reload(); pingAlerts();
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

  if (bookings.loading) return <div className="spinner" />;
  if (bookings.error) return <p className="form-error">{bookings.error}</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bookings &amp; Rentals</h1>
          <p>Track orders from request through delivery, return and settlement.</p>
        </div>
      </div>

      <div className="grid stats">
        <StatCard label="All bookings" value={counts.all} sub="Lifetime orders" />
        <StatCard label="Pending" value={counts.pending} sub="Awaiting confirmation" tone="gold" alert={counts.pending > 0} />
        <StatCard label="Active rentals" value={counts.confirmed + counts.delivered} sub="Confirmed + out" tone="cyan" />
        <StatCard label="Completed" value={counts.completed} sub="Returned & closed" tone="green" />
      </div>

      <div className="adm-tabs" style={{ marginTop: 22 }}>
        {TABS.map((t) => (
          <button key={t} type="button" className={`adm-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t === "all" ? "All" : titleCase(t)} ({t === "all" ? counts.all : counts[t]})
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="empty"><strong>No bookings here</strong>Nothing matches this filter yet.</div>
      ) : (
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
                      {b.status === "confirmed" ? <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => setStatus(b, "delivered")}>Deliver</button> : null}
                      {b.status === "delivered" ? <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => setStatus(b, "completed")}>Complete</button> : null}
                      {b.status === "pending" || b.status === "confirmed" ? <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => setStatus(b, "cancelled")}>Cancel</button> : null}
                      <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => togglePaid(b)}>{b.payment_status === "paid" ? "Unpay" : "Mark paid"}</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
