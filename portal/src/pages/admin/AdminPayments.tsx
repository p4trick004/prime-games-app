import { useMemo, useState } from "react";
import { adminApi } from "../../lib/adminApi";
import type { Booking, Incident, Transaction } from "../../lib/adminTypes";
import { fmtDay, INCIDENT_STATUS_TONE, METHOD_LABEL, PRIORITY_TONE, titleCase, TXN_STATUS_TONE } from "../../lib/adminLabels";
import { Badge, StatCard } from "../../components/ui";
import { useAsync } from "../../components/admin/AdminUi";
import { addDays, fmtTZS } from "../../lib/format";

type Tab = "payments" | "returns" | "incidents";

export function AdminPayments() {
  const [tab, setTab] = useState<Tab>("payments");
  const data = useAsync(async () => {
    const [txns, incidents, bookings] = await Promise.all([
      adminApi<{ items: Transaction[] }>("admin_transactions").then((r) => r.items),
      adminApi<{ items: Incident[] }>("admin_incidents").then((r) => r.items),
      adminApi<{ items: Booking[] }>("admin_bookings").then((r) => r.items),
    ]);
    return { txns, incidents, bookings };
  }, []);

  const returns = useMemo(() => (data.data?.bookings ?? []).filter((b) => b.status === "delivered" || b.status === "completed"), [data.data]);
  const settled = useMemo(() => (data.data?.txns ?? []).filter((t) => t.status === "settled").reduce((s, t) => s + t.amount, 0), [data.data]);
  const pendingAmt = useMemo(() => (data.data?.txns ?? []).filter((t) => t.status === "pending").reduce((s, t) => s + t.amount, 0), [data.data]);
  const openIncidents = useMemo(() => (data.data?.incidents ?? []).filter((i) => i.status === "open" || i.status === "investigating").length, [data.data]);

  if (data.loading) return <div className="spinner" />;
  if (data.error) return <p className="form-error">{data.error}</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payments, Returns &amp; Incidents</h1>
          <p>Settlements, console return cycles, and damage / claim handling.</p>
        </div>
      </div>

      <div className="grid stats">
        <StatCard label="Settled" value={fmtTZS(settled)} sub="Completed payments" tone="green" />
        <StatCard label="Pending" value={fmtTZS(pendingAmt)} sub="Awaiting settlement" tone="gold" alert={pendingAmt > 0} />
        <StatCard label="Open returns" value={returns.filter((r) => r.status === "delivered").length} sub="Out with customers" tone="cyan" />
        <StatCard label="Open incidents" value={openIncidents} sub="Needs review" tone={openIncidents > 0 ? "red" : "green"} />
      </div>

      <div className="adm-tabs" style={{ marginTop: 22 }}>
        {(["payments", "returns", "incidents"] as Tab[]).map((t) => (
          <button key={t} type="button" className={`adm-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>{titleCase(t)}</button>
        ))}
      </div>

      {tab === "payments" ? (
        (data.data?.txns ?? []).length === 0 ? <div className="empty"><strong>No transactions</strong>Payments appear here once recorded.</div> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Ref</th><th>Customer</th><th>Booking</th><th>Method</th><th>Amount</th><th>Status</th><th>When</th></tr></thead>
              <tbody>
                {data.data!.txns.map((t) => (
                  <tr key={t.id}>
                    <td className="mono cyan">{t.ref}</td>
                    <td><strong>{t.customer_name}</strong></td>
                    <td className="mono">{t.booking_ref ?? "—"}</td>
                    <td>{METHOD_LABEL[t.method] ?? titleCase(t.method)}</td>
                    <td className="mono">{fmtTZS(t.amount)}</td>
                    <td><Badge tone={TXN_STATUS_TONE[t.status]}>{titleCase(t.status)}</Badge></td>
                    <td className="mono">{fmtDay(t.occurred_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === "returns" ? (
        returns.length === 0 ? <div className="empty"><strong>No return cycles</strong>Delivered rentals show their due date here.</div> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Ref</th><th>Customer</th><th>Out since</th><th>Days</th><th>Due back</th><th>State</th></tr></thead>
              <tbody>
                {returns.map((b) => (
                  <tr key={b.id}>
                    <td className="mono cyan">{b.ref}</td>
                    <td><strong>{b.customer_name}</strong></td>
                    <td className="mono">{fmtDay(b.start_date)}</td>
                    <td className="mono">{b.days}</td>
                    <td className="mono gold">{fmtDay(addDays(b.start_date, b.days))}</td>
                    <td><Badge tone={b.status === "delivered" ? "cyan" : "gray"}>{titleCase(b.status)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === "incidents" ? (
        (data.data?.incidents ?? []).length === 0 ? <div className="empty"><strong>No incidents</strong>Damage and claim reports appear here.</div> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Ref</th><th>Customer</th><th>Unit</th><th>Kind</th><th>Severity</th><th>Claim</th><th>Status</th></tr></thead>
              <tbody>
                {data.data!.incidents.map((i) => (
                  <tr key={i.id}>
                    <td className="mono cyan">{i.ref}</td>
                    <td><strong>{i.customer_name}</strong></td>
                    <td className="mono">{i.unit_code ?? "—"}</td>
                    <td>{titleCase(i.kind)}</td>
                    <td><Badge tone={PRIORITY_TONE[i.severity]}>{titleCase(i.severity)}</Badge></td>
                    <td className="mono">{i.claim_amount != null ? fmtTZS(i.claim_amount) : "—"}</td>
                    <td><Badge tone={INCIDENT_STATUS_TONE[i.status]}>{titleCase(i.status)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </>
  );
}
