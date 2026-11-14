import { Link } from "react-router-dom";
import { useMyBookings, STATUS_LABEL, type Booking } from "../lib/bookings";
import { PACKAGE_META, GAME_LIBRARY } from "../lib/pricing";
import { fmtTZS, fmtDateShort } from "../lib/format";
import { Badge, StatCard, Spinner, Empty } from "../components/ui";

const statusTone = (b: Booking) =>
  b.status === "cancelled" ? "red" : b.status === "completed" ? "green" : b.status === "pending" ? "gold" : "cyan";

export function Rentals() {
  const { bookings, error } = useMyBookings();
  if (!bookings) return <Spinner />;

  const counted = bookings.filter((b) => b.status !== "cancelled");
  const completed = counted.filter((b) => b.status === "completed");
  const totalDays = counted.reduce((s, b) => s + (b.package_key === "weekend" ? 3 : b.days), 0);
  const totalSpend = counted.filter((b) => b.payment_status === "paid").reduce((s, b) => s + b.total, 0);
  const fav = (() => {
    const tally = new Map<string, number>();
    for (const b of counted) tally.set(b.package_key, (tally.get(b.package_key) ?? 0) + 1);
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? PACKAGE_META[top[0] as Booking["package_key"]].name : "—";
  })();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My rentals</h1>
          <p>Your full rental history and stats — loyalty points grow with every completed rental.</p>
        </div>
        <Link to="/browse" className="btn btn-primary btn-sm">Rent again</Link>
      </div>

      {error ? <div className="banner warn"><span className="ico">!</span><p className="grow">Couldn't load history ({error}).</p></div> : null}

      <div className="grid stats">
        <StatCard label="Total rentals" value={counted.length} sub={`${completed.length} completed`} />
        <StatCard label="Days played" value={totalDays} sub="Weekends count as 3 days" />
        <StatCard label="Total spend" value={fmtTZS(totalSpend)} tone="gold" sub="Paid bookings only" />
        <StatCard label="Favourite plan" value={<span style={{ fontSize: "1.05rem" }}>{fav}</span>} tone="green" />
      </div>

      <h3 style={{ font: "600 10px var(--font-mono)", letterSpacing: ".18em", color: "var(--dim)", margin: "26px 0 12px" }}>HISTORY</h3>
      {bookings.length === 0 ? (
        <Empty title="No rentals yet">
          <p style={{ margin: "0 0 14px" }}>Your first PS5 session is a few taps away.</p>
          <Link to="/browse" className="btn btn-primary btn-sm">Browse PS5s</Link>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Ref</th><th>Package</th><th>Dates</th><th>Games</th><th>Total</th><th>Status</th></tr>
            </thead>
            <tbody>
              {[...bookings].sort((a, b) => b.start_date.localeCompare(a.start_date)).map((b) => {
                const titles = (b.notes ?? "").startsWith("Games: ")
                  ? b.notes!.slice(7).split("; ").filter(Boolean)
                  : b.package_key === "starter"
                    ? GAME_LIBRARY.filter((g) => ["fc27", "mw3", "gta6", "nba2k27", "spiderman2"].includes(g.id)).map((g) => g.title)
                    : [];
                return (
                  <tr key={b.id}>
                    <td className="mono cyan">{b.ref}</td>
                    <td>{PACKAGE_META[b.package_key].name}</td>
                    <td>{fmtDateShort(b.start_date)} · {b.package_key === "weekend" ? "Fri→Sun" : `${b.days}${b.package_key === "night" ? "n" : "d"}`}</td>
                    <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={titles.join(", ")}>
                      {titles.length ? titles.slice(0, 2).join(", ") + (titles.length > 2 ? ` +${titles.length - 2}` : "") : "—"}
                    </td>
                    <td className="mono">{fmtTZS(b.total)}</td>
                    <td><Badge tone={statusTone(b)}>{STATUS_LABEL[b.status]}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
