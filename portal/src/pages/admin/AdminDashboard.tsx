import { useMemo } from "react";
import { adminApi } from "../../lib/adminApi";
import type { AdminStats, Booking, Incident, MaintenanceRecord, Transaction } from "../../lib/adminTypes";
import { relTime, titleCase } from "../../lib/adminLabels";
import { Badge, StatCard } from "../../components/ui";
import { useAsync } from "../../components/admin/AdminUi";
import { addDays, eatToday, fmtTZS } from "../../lib/format";
import type { Tone } from "../../lib/adminLabels";

interface DashData {
  stats: AdminStats;
  bookings: Booking[];
  txns: Transaction[];
  maint: MaintenanceRecord[];
  incidents: Incident[];
}

function lastMonths(n: number): { key: string; label: string }[] {
  const now = new Date();
  const out: { key: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ key: m.toISOString().slice(0, 7), label: m.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) });
  }
  return out;
}

const ageDays = (iso: string) => Math.max(0, (Date.now() - new Date(iso).getTime()) / 86400000);

function RevenueChart({ series }: { series: { label: string; value: number }[] }) {
  const max = Math.max(1, ...series.map((s) => s.value));
  const W = 600, H = 200, padX = 26, padTop = 16, padBottom = 30;
  const stepX = (W - padX * 2) / Math.max(1, series.length - 1);
  const y = (v: number) => padTop + (1 - v / max) * (H - padTop - padBottom);
  const pts = series.map((s, i) => ({ x: padX + i * stepX, y: y(s.value) }));
  const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <div className="dash-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue over the last six months">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={padX} x2={W - padX} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" strokeWidth="1" />
        ))}
        <polyline points={poly} fill="none" stroke="var(--cyan)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="4" fill="var(--cyan)" />)}
        {series.map((s, i) => (
          <text key={s.label} x={padX + i * stepX} y={H - 8} textAnchor="middle" fill="var(--dim)" fontSize="11" fontFamily="var(--font-mono)">{s.label}</text>
        ))}
      </svg>
    </div>
  );
}

export function AdminDashboard() {
  const dash = useAsync<DashData>(async () => {
    const [stats, bookings, txns, maint, incidents] = await Promise.all([
      adminApi<{ stats: AdminStats }>("admin_stats").then((r) => r.stats),
      adminApi<{ items: Booking[] }>("admin_bookings").then((r) => r.items),
      adminApi<{ items: Transaction[] }>("admin_transactions").then((r) => r.items),
      adminApi<{ items: MaintenanceRecord[] }>("admin_maintenance").then((r) => r.items),
      adminApi<{ items: Incident[] }>("admin_incidents").then((r) => r.items),
    ]);
    return { stats, bookings, txns, maint, incidents };
  }, []);

  const d = dash.data;

  const derived = useMemo(() => {
    if (!d) return null;
    const months = lastMonths(6);
    const revenueByMonth = months.map((m) => ({
      label: m.label,
      value: d.bookings.reduce((sum, b) =>
        b.payment_status === "paid" && b.status !== "cancelled" && (b.created_at || "").slice(0, 7) === m.key ? sum + b.total : sum, 0),
    }));

    const buckets = { current: 0, overdue: 0, critical: 0 };
    for (const b of d.bookings) {
      if (b.payment_status !== "unpaid") continue;
      const a = ageDays(b.created_at);
      if (a <= 7) buckets.current += b.total;
      else if (a <= 30) buckets.overdue += b.total;
      else buckets.critical += b.total;
    }

    const today = eatToday();
    const pickups = d.bookings.filter((b) => b.status === "confirmed" && b.start_date === today).length;
    const returns = d.bookings.filter((b) => b.status === "delivered" && addDays(b.start_date, b.days) === today).length;
    const approvals = d.stats.pending;

    const byCustomer = new Map<string, { sum: number; maxAge: number }>();
    for (const b of d.bookings) {
      if (b.payment_status !== "unpaid") continue;
      const cur = byCustomer.get(b.customer_name) ?? { sum: 0, maxAge: 0 };
      cur.sum += b.total;
      cur.maxAge = Math.max(cur.maxAge, ageDays(b.created_at));
      byCustomer.set(b.customer_name, cur);
    }
    const risk: { name: string; reason: string; state: string; tone: Tone }[] = [];
    for (const [name, v] of byCustomer) {
      risk.push({ name, reason: `Unpaid bookings: ${fmtTZS(v.sum)}`, state: v.maxAge > 7 ? "HIGH" : "MEDIUM", tone: v.maxAge > 7 ? "red" : "gold" });
    }
    for (const inc of d.incidents) {
      if (inc.status === "resolved" || inc.status === "waived") continue;
      risk.push({ name: inc.customer_name, reason: `${titleCase(inc.kind)} incident`, state: inc.severity.toUpperCase(), tone: inc.severity === "critical" || inc.severity === "high" ? "red" : inc.severity === "medium" ? "gold" : "cyan" });
    }
    risk.sort((a, b) => (a.tone === "red" ? -1 : 1) - (b.tone === "red" ? -1 : 1));

    const feed = [
      ...d.bookings.map((b) => ({ at: b.created_at, title: `New Booking ${b.ref}`, sub: `${b.customer_name} · ${fmtTZS(b.total)}`, tone: "cyan" as Tone })),
      ...d.txns.map((t) => ({ at: t.occurred_at, title: `Payment ${t.status}`, sub: `${t.customer_name} · ${fmtTZS(t.amount)}`, tone: t.status === "settled" ? ("green" as Tone) : t.status === "failed" ? ("red" as Tone) : ("gold" as Tone) })),
      ...d.maint.map((m) => ({ at: m.opened_at, title: `Maintenance ${m.unit_code}`, sub: m.issue, tone: "gold" as Tone })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 6);

    return { revenueByMonth, buckets, pickups, returns, approvals, risk: risk.slice(0, 5), feed };
  }, [d]);

  if (dash.loading) return <div className="spinner" />;
  if (dash.error || !d || !derived) return <p className="form-error">{dash.error ?? "Could not load dashboard."}</p>;

  const s = d.stats;
  const bucketMax = Math.max(1, derived.buckets.current, derived.buckets.overdue, derived.buckets.critical);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Operational Command</h1>
          <p>Real-time console rentals, verification state, and local DSM cashflows.</p>
        </div>
      </div>

      <div className="grid stats">
        <StatCard label="Total bookings" value={s.total_bookings} sub="All-time orders" />
        <StatCard label="Pending bookings" value={s.pending} sub="Awaiting confirmation" tone="gold" alert />
        <StatCard label="Active rentals" value={s.active} sub="Confirmed + delivered" tone="cyan" />
        <StatCard label="Revenue" value={fmtTZS(s.revenue)} sub={`${fmtTZS(s.revenue_today)} today`} tone="green" />
      </div>
      <div className="grid stats" style={{ marginTop: 16 }}>
        <StatCard label="Available PS5s" value={`${s.consoles_available} / ${s.consoles_total}`} sub="Ready for dispatch" tone="green" />
        <StatCard label="PS5s rented" value={s.consoles_rented} sub="Generating revenue" tone="cyan" />
        <StatCard label="In maintenance" value={s.consoles_maintenance} sub="Awaiting clearance" tone="gold" alert />
        <StatCard label="Outstanding debt" value={fmtTZS(s.outstanding)} sub="Model C — incurred obligations" tone={s.outstanding > 0 ? "red" : "green"} />
      </div>

      <div className="dash-grid">
        <div className="card">
          <div className="adm-section" style={{ margin: "0 0 12px" }}>
            <div><h2>Revenue Trajectory (Last 6 Months)</h2><span className="hint">Settled payments, represented in TSh</span></div>
          </div>
          <RevenueChart series={derived.revenueByMonth} />
        </div>

        <div className="card">
          <div className="adm-section" style={{ margin: "0 0 12px" }}>
            <div><h2>Unpaid Bookings (Commitments)</h2><span className="hint">Future bookings by age — not debt until incurred</span></div>
          </div>
          <div style={{ font: "700 1.6rem var(--font-mono)", color: "var(--gold)", marginBottom: 4 }}>{fmtTZS(s.outstanding)}</div>
          <div className="aging" style={{ marginTop: 14 }}>
            {([["Current (1-7 days)", derived.buckets.current, "var(--cyan)"], ["Overdue (8-30 days)", derived.buckets.overdue, "var(--gold)"], ["Critical (31+ days)", derived.buckets.critical, "var(--red)"]] as const).map(([label, amt, color]) => (
              <div className="row" key={label}>
                <span>{label}</span>
                <span className="bar"><i style={{ width: `${(amt / bucketMax) * 100}%`, background: color }} /></span>
                <span className="amt" style={{ color }}>{fmtTZS(amt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="card">
          <div className="adm-section" style={{ margin: "0 0 12px" }}>
            <div><h2>Customer Risk Registry</h2><span className="hint">Unpaid booking commitments and open incidents</span></div>
          </div>
          {derived.risk.length === 0 ? (
            <div className="empty"><strong>No active risk</strong>No unpaid bookings or open incidents right now.</div>
          ) : (
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="data" style={{ minWidth: 0 }}>
                <thead><tr><th>Customer</th><th>Primary reason</th><th>Risk state</th></tr></thead>
                <tbody>
                  {derived.risk.map((r, i) => (
                    <tr key={`${r.name}-${i}`}>
                      <td><strong>{r.name}</strong></td>
                      <td>{r.reason}</td>
                      <td><Badge tone={r.tone}>{r.state}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="adm-section" style={{ margin: "0 0 12px" }}><div><h2>Today's Dispatch Schedule</h2></div></div>
            <div className="dispatch">
              <div><div className="num" style={{ color: "var(--cyan)" }}>{derived.pickups}</div><div className="cap">Upcoming Pickups</div></div>
              <div><div className="num" style={{ color: "var(--green)" }}>{derived.returns}</div><div className="cap">Expected Returns</div></div>
              <div><div className="num" style={{ color: "var(--gold)" }}>{derived.approvals}</div><div className="cap">Pending Approvals</div></div>
            </div>
          </div>

          <div className="card">
            <div className="adm-section" style={{ margin: "0 0 12px" }}><div><h2>System Activity</h2></div></div>
            <div className="feed">
              {derived.feed.map((f, i) => (
                <div className="update" key={i}>
                  <span className={`ico ${f.tone === "green" ? "green" : f.tone === "gold" ? "gold" : "cyan"}`}>•</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{f.title}</strong>
                    <span>{f.sub}</span>
                  </span>
                  <span style={{ color: "var(--dim)", fontSize: ".78rem", whiteSpace: "nowrap" }}>{relTime(f.at)}</span>
                </div>
              ))}
              {derived.feed.length === 0 ? <div className="empty"><strong>No recent activity</strong>Events will appear here as they happen.</div> : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
