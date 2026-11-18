import { useMyBookings } from "../lib/bookings";
import { useMyPayments } from "../lib/payments";
import { useCustomer } from "../lib/customer";
import { PACKAGE_META } from "../lib/pricing";
import { fmtTZS, fmtDate } from "../lib/format";
import { fmtStamp, METHOD_LABEL, TXN_STATUS_TONE, titleCase } from "../lib/adminLabels";
import { WHATSAPP_NUMBER } from "../config";
import { Badge, Spinner, Empty } from "../components/ui";

const waPay = (text: string) => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;

export function Payments() {
  const { bookings, error: bErr } = useMyBookings();
  const { payments, outstanding, error: pErr } = useMyPayments();
  const { customer } = useCustomer();
  if (!bookings || !payments) return <Spinner />;

  const debt = outstanding ?? 0;
  const paidTotal = payments.filter((p) => p.status === "settled" && p.amount > 0).reduce((s, p) => s + p.amount, 0);
  // Model C: unpaid future bookings are commitments, not debt. They never block
  // handovers and are shown separately from the incurred balance.
  const commitments = bookings.filter((b) =>
    b.payment_status === "unpaid" && (b.status === "pending" || b.status === "confirmed"),
  );
  const premium = customer?.customer_tier === "premium";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payments</h1>
          <p>Settle balances via M-Pesa or cash on delivery. We record payments after confirmation.</p>
        </div>
      </div>

      {bErr || pErr ? <div className="banner warn"><span className="ico">!</span><p className="grow">Couldn't load payments ({bErr ?? pErr}).</p></div> : null}

      <div className="grid stats" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <div className={`stat-card${debt > 0 ? " alert" : ""}`}>
          <div className="label">Outstanding balance</div>
          <div className={`value ${debt > 0 ? "gold" : "green"}`}>{fmtTZS(debt)}</div>
          <div className="sub">Incurred debt — rentals, fees and claims minus payments</div>
        </div>
        <div className="stat-card">
          <div className="label">Total paid</div>
          <div className="value green">{fmtTZS(paidTotal)}</div>
          <div className="sub">{payments.filter((p) => p.status === "settled" && p.amount > 0).length} settled receipt(s)</div>
        </div>
      </div>

      {premium ? (
        <div className="banner gold" style={{ marginTop: 16 }}>
          <span className="ico">★</span>
          <p className="grow">
            <strong>Premium credit:</strong> pay at pickup within your approved limit of <span className="mono">{fmtTZS(customer?.credit_limit ?? 0)}</span>.
            Current exposure: <span className="mono">{fmtTZS(debt)}</span> — {debt > (customer?.credit_limit ?? 0)
              ? <>you are above your limit; settle <span className="mono">{fmtTZS(debt - (customer?.credit_limit ?? 0))}</span> or more before your next handover.</>
              : "handovers stay available while you remain under the limit."}
          </p>
        </div>
      ) : debt > 0 ? (
        <div className="banner warn" style={{ marginTop: 16 }}>
          <span className="ico">!</span>
          <p className="grow">
            <strong>Settle before handover.</strong> Standard membership requires the balance to be fully paid before a console is released.
          </p>
          <a className="btn btn-primary btn-sm" href={waPay(`Hello Prime Games! I'd like to settle my outstanding balance of ${fmtTZS(debt)} via M-Pesa. Please send me the payment number.`)} target="_blank" rel="noopener">Pay via M-Pesa</a>
        </div>
      ) : null}

      <h3 style={{ font: "600 10px var(--font-mono)", letterSpacing: ".18em", color: "var(--dim)", margin: "26px 0 12px" }}>UPCOMING BOOKINGS (COMMITMENTS)</h3>
      {commitments.length === 0 ? (
        <Empty title="Nothing scheduled">Unpaid future bookings appear here — they are commitments, not debt.</Empty>
      ) : (
        <div className="grid" style={{ gap: 12 }}>
          {commitments.map((b) => (
            <div className="card" key={b.id} style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
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
              <a className="btn btn-primary btn-sm" href={waPay(`Hello Prime Games! I'd like to pay for booking ${b.ref} (${fmtTZS(b.total)}) via M-Pesa. Please send me the payment number.`)} target="_blank" rel="noopener">
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
      {payments.length === 0 ? (
        <Empty title="No payments yet">Recorded receipts, refunds and fees will appear here.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Receipt</th><th>Date</th><th>Booking</th><th>Type</th><th>Method</th><th>Amount</th><th>Status</th></tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="mono cyan">{p.ref}</td>
                  <td className="mono">{fmtStamp(p.occurred_at)}</td>
                  <td className="mono">{p.booking_ref ?? "—"}</td>
                  <td>{titleCase(p.kind)}</td>
                  <td>{METHOD_LABEL[p.method] ?? titleCase(p.method)}</td>
                  <td className="mono" style={{ color: p.amount < 0 ? "var(--red)" : undefined }}>{fmtTZS(p.amount)}</td>
                  <td><Badge tone={TXN_STATUS_TONE[p.status]}>{titleCase(p.status)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}