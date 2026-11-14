import { useMyBookings } from "../lib/bookings";
import { PACKAGE_META } from "../lib/pricing";
import { fmtTZS, fmtDate, fmtDateShort } from "../lib/format";
import { WHATSAPP_NUMBER } from "../config";
import { Badge, Spinner, Empty } from "../components/ui";

const waPay = (ref: string, total: number) =>
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
    `Hello Prime Games! I'd like to pay for booking ${ref} (${fmtTZS(total)}) via M-Pesa. Please send me the payment number.`,
  )}`;

export function Payments() {
  const { bookings, error } = useMyBookings();
  if (!bookings) return <Spinner />;

  const live = bookings.filter((b) => b.status !== "cancelled");
  const unpaid = live.filter((b) => b.payment_status === "unpaid");
  const paid = live.filter((b) => b.payment_status === "paid");
  const outstanding = unpaid.reduce((s, b) => s + b.total, 0);
  const paidTotal = paid.reduce((s, b) => s + b.total, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payments</h1>
          <p>Settle open balances via M-Pesa or cash on delivery. We mark payments after confirmation.</p>
        </div>
      </div>

      {error ? <div className="banner warn"><span className="ico">!</span><p className="grow">Couldn't load payments ({error}).</p></div> : null}

      <div className="grid stats" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <div className={`stat-card${outstanding > 0 ? " alert" : ""}`}>
          <div className="label">Outstanding balance</div>
          <div className={`value ${outstanding > 0 ? "gold" : "green"}`}>{fmtTZS(outstanding)}</div>
          <div className="sub">{unpaid.length} unpaid booking(s)</div>
        </div>
        <div className="stat-card">
          <div className="label">Total paid</div>
          <div className="value green">{fmtTZS(paidTotal)}</div>
          <div className="sub">{paid.length} settled booking(s)</div>
        </div>
      </div>

      <h3 style={{ font: "600 10px var(--font-mono)", letterSpacing: ".18em", color: "var(--dim)", margin: "26px 0 12px" }}>DUE NOW</h3>
      {unpaid.length === 0 ? (
        <Empty title="Nothing due">You're all settled — asante!</Empty>
      ) : (
        <div className="grid" style={{ gap: 12 }}>
          {unpaid.map((b) => (
            <div className="card" key={b.id} style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", borderColor: "rgba(245,166,35,.45)" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <h3 style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  {PACKAGE_META[b.package_key].name} <Badge tone="gray">UNPAID</Badge>
                  {b.payment_method === "cod" ? <Badge tone="cyan">CASH ON DELIVERY</Badge> : <Badge tone="gold">M-PESA</Badge>}
                </h3>
                <p style={{ color: "var(--dim)", fontSize: ".86rem", margin: "6px 0 0" }}>
                  <span className="mono cyan">{b.ref}</span> · starts {fmtDate(b.start_date)}
                </p>
              </div>
              <div className="mono gold" style={{ fontSize: "1.15rem", fontWeight: 700 }}>{fmtTZS(b.total)}</div>
              <a className="btn btn-primary btn-sm" href={waPay(b.ref, b.total)} target="_blank" rel="noopener">
                {b.payment_method === "cod" ? "Confirm cash plan" : "Pay with M-Pesa"}
              </a>
            </div>
          ))}
        </div>
      )}

      <div className="banner gold" style={{ marginTop: 22 }}>
        <span className="ico">📱</span>
        <p className="grow">
          <strong>M-Pesa:</strong> message us on WhatsApp with your booking ref and we'll send the till number and confirm your payment within minutes (8:00–22:00 EAT).
        </p>
      </div>

      <h3 style={{ font: "600 10px var(--font-mono)", letterSpacing: ".18em", color: "var(--dim)", margin: "26px 0 12px" }}>PAYMENT HISTORY</h3>
      {paid.length === 0 ? (
        <Empty title="No payments yet">Settled bookings will appear here with receipts.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Date</th><th>Booking</th><th>Method</th><th>Amount</th><th>Status</th></tr>
            </thead>
            <tbody>
              {[...paid].sort((a, b) => b.start_date.localeCompare(a.start_date)).map((b) => (
                <tr key={b.id}>
                  <td>{fmtDateShort(b.start_date)}</td>
                  <td><span className="mono cyan">{b.ref}</span> · {PACKAGE_META[b.package_key].name}</td>
                  <td>{b.payment_method === "mpesa" ? "M-Pesa" : "Cash"}</td>
                  <td className="mono">{fmtTZS(b.total)}</td>
                  <td><Badge tone="green">PAID</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
