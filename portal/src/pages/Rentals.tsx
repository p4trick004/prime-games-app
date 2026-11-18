import { Link } from "react-router-dom";
import { useMyRentals, RENTAL_STATUS_LABEL, RENTAL_STATUS_TONE, type Rental } from "../lib/rentals";
import { PACKAGE_META } from "../lib/pricing";
import { fmtTZS } from "../lib/format";
import { fmtStamp } from "../lib/adminLabels";
import { Badge, StatCard, Spinner, Empty } from "../components/ui";

const pkgName = (r: Rental) =>
  r.package_key && r.package_key in PACKAGE_META ? PACKAGE_META[r.package_key as keyof typeof PACKAGE_META].name : "Rental";

export function Rentals() {
  const { rentals, error } = useMyRentals();
  if (!rentals) return <Spinner />;

  const counted = rentals.filter((r) => r.status !== "cancelled");
  const returned = counted.filter((r) => r.status === "returned");
  const totalDays = counted.reduce((s, r) => s + (r.package_key === "weekend" ? 3 : (r.days ?? 0)), 0);
  const lateFees = counted.reduce((s, r) => s + (r.late_fee ?? 0), 0);
  const fav = (() => {
    const tally = new Map<string, number>();
    for (const r of counted) if (r.package_key) tally.set(r.package_key, (tally.get(r.package_key) ?? 0) + 1);
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && top[0] in PACKAGE_META ? PACKAGE_META[top[0] as keyof typeof PACKAGE_META].name : "—";
  })();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My rentals</h1>
          <p>Your console handovers and returns — every unit, date and condition on record.</p>
        </div>
        <Link to="/browse" className="btn btn-primary btn-sm">Rent again</Link>
      </div>

      {error ? <div className="banner warn"><span className="ico">!</span><p className="grow">Couldn't load rentals ({error}).</p></div> : null}

      <div className="grid stats">
        <StatCard label="Total rentals" value={counted.length} sub={`${returned.length} returned`} />
        <StatCard label="Days played" value={totalDays} sub="Weekends count as 3 days" />
        <StatCard label="Late fees" value={fmtTZS(lateFees)} tone={lateFees > 0 ? "gold" : "green"} sub="Charged on late returns" />
        <StatCard label="Favourite plan" value={<span style={{ fontSize: "1.05rem" }}>{fav}</span>} tone="green" />
      </div>

      <h3 style={{ font: "600 10px var(--font-mono)", letterSpacing: ".18em", color: "var(--dim)", margin: "26px 0 12px" }}>RENTAL HISTORY</h3>
      {rentals.length === 0 ? (
        <Empty title="No rentals yet">
          <p style={{ margin: "0 0 14px" }}>Rentals appear here once a console is handed over for your booking.</p>
          <Link to="/browse" className="btn btn-primary btn-sm">Browse PS5s</Link>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Booking</th><th>Package</th><th>Unit</th><th>Out</th><th>Due back</th><th>Returned</th><th>Late fee</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rentals.map((r) => (
                <tr key={r.id}>
                  <td className="mono cyan">{r.booking_ref ?? "—"}</td>
                  <td>{pkgName(r)}</td>
                  <td className="mono">{r.unit_code ?? "—"}</td>
                  <td className="mono">{fmtStamp(r.start_at)}</td>
                  <td className="mono gold">{fmtStamp(r.expected_return_at)}</td>
                  <td className="mono">{fmtStamp(r.actual_return_at)}</td>
                  <td className="mono">{r.late_fee ? fmtTZS(r.late_fee) : "—"}</td>
                  <td><Badge tone={RENTAL_STATUS_TONE[r.status]}>{RENTAL_STATUS_LABEL[r.status]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ color: "var(--dim)", fontSize: ".82rem", marginTop: 14 }}>
        Condition is recorded at handover and return. Late returns may incur a fee agreed with the team.
      </p>
    </>
  );
}