import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useCustomer } from "../lib/customer";
import { useMyBookings, STATUS_LABEL } from "../lib/bookings";
import { useMyRentals } from "../lib/rentals";
import { useMyPayments } from "../lib/payments";
import { PACKAGE_META } from "../lib/pricing";
import { fmtTZS, fmtDateShort, fmtTime } from "../lib/format";
import { fmtStamp } from "../lib/adminLabels";
import { WHATSAPP_NUMBER } from "../config";
import { StatCard, Badge, Countdown, Spinner, Empty, Ic } from "../components/ui";

export function Dashboard() {
  const { profile } = useAuth();
  const { customer, linkPending } = useCustomer();
  const { bookings, error } = useMyBookings();
  const { rentals } = useMyRentals();
  const { outstanding } = useMyPayments();

  if (!bookings || !rentals) return <Spinner />;

  const active = rentals.find((r) => r.status === "active" || r.status === "overdue") ?? null;
  const next = bookings
    .filter((b) => b.status === "pending" || b.status === "confirmed")
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0] ?? null;
  const debt = outstanding ?? 0;
  const updates = [...bookings].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 4);
  const firstName = (profile?.full_name ?? "Member").split(/\s+/)[0];
  const premium = customer?.customer_tier === "premium";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Welcome back, {firstName} {premium ? <Badge tone="gold">★ PREMIUM MEMBER</Badge> : <Badge tone="cyan">STANDARD</Badge>}</h1>
          <p>Here's a breakdown of your membership status and current active rentals.</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link to="/browse" className="btn btn-primary"><Ic name="plus" size={15} /> Rent Now</Link>
        </div>
      </div>

      {error ? <div className="banner warn"><span className="ico">!</span><p className="grow">We couldn't load your bookings ({error}). <button className="btn btn-ghost btn-sm" type="button" onClick={() => window.location.reload()}>Retry</button></p></div> : null}

      {linkPending ? (
        <div className="banner gold">
          <span className="ico">🔗</span>
          <p className="grow"><strong>Guest history link pending.</strong> We found bookings under your phone number — our team will verify and attach them to your account shortly.</p>
        </div>
      ) : null}

      <div className="grid two">
        <div className="card" style={active ? { borderColor: "rgba(34,217,238,.55)" } : undefined}>
          {active ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <h3>{active.unit_code ?? "PS5"} <Badge tone={active.status === "overdue" ? "red" : "cyan"}>{active.status === "overdue" ? "OVERDUE" : "ACTIVE"}</Badge></h3>
                  <p style={{ color: "var(--dim)", margin: "6px 0 0", fontSize: ".88rem" }}>
                    {active.booking_ref} · out since {fmtStamp(active.start_at)}
                  </p>
                </div>
                <Link to="/rentals" className="btn btn-primary btn-sm">Return info</Link>
              </div>
              {active.expected_return_at ? (
                <>
                  <p style={{ font: "600 10px var(--font-mono)", letterSpacing: ".18em", color: "var(--dim)", margin: "20px 0 10px" }}>TIME REMAINING TO RETURN</p>
                  <Countdown to={new Date(active.expected_return_at)} />
                </>
              ) : null}
            </>
          ) : (
            <Empty title="No active rental right now">
              <p style={{ margin: "0 0 14px" }}>Browse consoles and packages to start your next session.</p>
              <Link to="/browse" className="btn btn-primary btn-sm">Browse PS5s</Link>
            </Empty>
          )}
        </div>

        <div className="grid" style={{ gap: 12 }}>
          <StatCard label="Next booking" value={next ? fmtDateShort(next.start_date) : "—"} sub={next ? `${PACKAGE_META[next.package_key].name} · ${fmtTime(next.start_time)}` : "Nothing scheduled"} />
          {debt > 0
            ? <StatCard label="Balance due" value={fmtTZS(debt)} tone="gold" sub="Incurred debt — settle via M-Pesa or on delivery" alert />
            : <StatCard label="Balance due" value={fmtTZS(0)} tone="green" sub="All settled — asante!" />}
          {premium
            ? <StatCard label="Premium credit limit" value={fmtTZS(customer?.credit_limit ?? 0)} sub="Interest-free rental credit active" />
            : <StatCard label="Membership" value="STANDARD" sub="Full payment before handover · upgrade for credit" />}
        </div>
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Recent updates</h3>
          <div className="update-list" style={{ marginTop: 14 }}>
            {updates.length === 0 ? <Empty title="No bookings yet">Your rental updates will appear here.</Empty> : updates.map((b) => (
              <div className="update" key={b.id}>
                <span className={`ico ${b.status === "cancelled" ? "gold" : b.payment_status === "paid" ? "green" : "cyan"}`}>
                  {b.status === "cancelled" ? "!" : b.payment_status === "paid" ? "✓" : "•"}
                </span>
                <span className="grow" style={{ flex: 1 }}>
                  <strong>{STATUS_LABEL[b.status]} — {PACKAGE_META[b.package_key].name}</strong>
                  <span>{b.ref} · {fmtDateShort(b.start_date)} · {fmtTZS(b.total)}</span>
                </span>
                <Badge tone={b.status === "cancelled" ? "red" : b.status === "completed" ? "green" : b.status === "pending" ? "gold" : "cyan"}>{b.status}</Badge>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Need a hand?</h3>
          <p style={{ color: "var(--dim)", fontSize: ".9rem" }}>Extensions, swaps or support — we reply within 30 minutes (8:00–22:00 EAT).</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <a className="btn btn-gold btn-sm" href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener">WhatsApp us</a>
            <Link to="/profile" className="btn btn-ghost btn-sm">My profile</Link>
          </div>
        </div>
      </div>
    </>
  );
}