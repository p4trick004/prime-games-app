import { Link } from "react-router-dom";
import { useMyBookings, isOpen, STATUS_LABEL, type Booking } from "../lib/bookings";
import { PACKAGE_META, ZONES } from "../lib/pricing";
import { fmtTZS, fmtDate, fmtTime, returnDateTime } from "../lib/format";
import { WHATSAPP_NUMBER } from "../config";
import { Badge, Spinner, Empty } from "../components/ui";

const STATUS_TONE: Record<Booking["status"], "gold" | "cyan" | "green" | "red" | "gray"> = {
  pending: "gold",
  confirmed: "cyan",
  delivered: "cyan",
  completed: "green",
  cancelled: "red",
};

export function Bookings() {
  const { bookings, error, reload } = useMyBookings();
  if (!bookings) return <Spinner />;

  const open = bookings.filter(isOpen);
  const past = bookings.filter((b) => !isOpen(b));

  const row = (b: Booking) => {
    const returns = returnDateTime(b.start_date, b.start_time, b.days, b.package_key);
    const waText = encodeURIComponent(`Hello Prime Games! About my booking ${b.ref} (${PACKAGE_META[b.package_key].name}, ${fmtDate(b.start_date)}) —`);
    return (
      <div className="card" key={b.id} style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h3 style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {PACKAGE_META[b.package_key].name}
            <Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge>
            {b.payment_status === "paid" ? <Badge tone="green">PAID</Badge> : b.status !== "cancelled" ? <Badge tone="gray">UNPAID</Badge> : null}
          </h3>
          <p style={{ color: "var(--dim)", fontSize: ".87rem", margin: "8px 0 0" }}>
            <span className="mono cyan">{b.ref}</span> · {fmtDate(b.start_date)} at {fmtTime(b.start_time)} ·{" "}
            {b.package_key === "weekend" ? "Fri → Sun" : `${b.days} ${b.package_key === "night" ? "night(s)" : "day(s)"}`} ·{" "}
            {ZONES[b.zone_key]?.label ?? b.zone_key}
          </p>
          <p style={{ color: "var(--dim)", fontSize: ".82rem", margin: "4px 0 0" }}>
            {isOpen(b) && returns.getTime() > Date.now()
              ? `Return by ${fmtDate(returns.toISOString().slice(0, 10))} ${fmtTime(b.package_key === "night" ? "10:00" : b.start_time)}`
              : b.notes ?? "—"}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="mono gold" style={{ fontSize: "1.15rem", fontWeight: 700 }}>{fmtTZS(b.total)}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {(b.status === "pending" || b.status === "confirmed") ? (
              <a className="btn btn-ghost btn-sm" href={`https://wa.me/${WHATSAPP_NUMBER}?text=${waText}%20I%20need%20to%20cancel.`} target="_blank" rel="noopener">Request cancel</a>
            ) : null}
            {b.payment_status === "unpaid" && b.status !== "cancelled" ? (
              <Link className="btn btn-primary btn-sm" to="/payments">Pay</Link>
            ) : null}
            <a className="btn btn-gold btn-sm" href={`https://wa.me/${WHATSAPP_NUMBER}?text=${waText}`} target="_blank" rel="noopener">WhatsApp</a>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My bookings</h1>
          <p>Every request you've made, live status and totals.</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void reload()}>Refresh</button>
          <Link to="/browse" className="btn btn-primary btn-sm">New booking</Link>
        </div>
      </div>

      {error ? <div className="banner warn"><span className="ico">!</span><p className="grow">Couldn't load bookings ({error}).</p></div> : null}

      <h3 style={{ font: "600 10px var(--font-mono)", letterSpacing: ".18em", color: "var(--dim)", margin: "6px 0 12px" }}>ACTIVE & UPCOMING</h3>
      {open.length === 0
        ? <Empty title="Nothing active">When you book a console it will show up here.</Empty>
        : <div className="grid" style={{ gap: 12 }}>{open.map(row)}</div>}

      {past.length > 0 ? (
        <>
          <h3 style={{ font: "600 10px var(--font-mono)", letterSpacing: ".18em", color: "var(--dim)", margin: "26px 0 12px" }}>PAST</h3>
          <div className="grid" style={{ gap: 12 }}>{past.map(row)}</div>
        </>
      ) : null}
    </>
  );
}
