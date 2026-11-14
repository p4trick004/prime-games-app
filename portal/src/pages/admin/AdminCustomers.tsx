import { useMemo, useState } from "react";
import { adminApi } from "../../lib/adminApi";
import type { Booking, CustomerAgg } from "../../lib/adminTypes";
import { fmtDay, titleCase, ZONE_LABEL } from "../../lib/adminLabels";
import { Badge, StatCard } from "../../components/ui";
import { useAsync } from "../../components/admin/AdminUi";
import { fmtTZS } from "../../lib/format";

const maskId = (n: string) => (n.length <= 4 ? n : `•••• ${n.slice(-4)}`);

export function AdminCustomers() {
  const [q, setQ] = useState("");
  const data = useAsync(async () => {
    const [customers, bookings] = await Promise.all([
      adminApi<{ customers: CustomerAgg[] }>("admin_customers").then((r) => r.customers ?? []),
      adminApi<{ items: Booking[] }>("admin_bookings").then((r) => r.items ?? []),
    ]);
    return { customers, bookings };
  }, []);

  const kycByCustomer = useMemo(() => {
    const map = new Map<string, { id_type: string; id_number: string; at: string }>();
    for (const b of data.data?.bookings ?? []) {
      const cur = map.get(b.customer_name);
      if (!cur || b.created_at > cur.at) map.set(b.customer_name, { id_type: b.id_type, id_number: b.id_number, at: b.created_at });
    }
    return map;
  }, [data.data]);

  const rows = useMemo(() => {
    const list = data.data?.customers ?? [];
    const term = q.trim().toLowerCase();
    return list
      .filter((c) => !term || c.name.toLowerCase().includes(term) || c.phone.includes(term))
      .sort((a, b) => b.spend - a.spend);
  }, [data.data, q]);

  const totals = useMemo(() => {
    const list = data.data?.customers ?? [];
    return {
      count: list.length,
      spend: list.reduce((s, c) => s + c.spend, 0),
      open: list.reduce((s, c) => s + c.open, 0),
      withOpen: list.filter((c) => c.open > 0).length,
    };
  }, [data.data]);

  if (data.loading) return <div className="spinner" />;
  if (data.error) return <p className="form-error">{data.error}</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Customers &amp; KYC</h1>
          <p>Member directory, lifetime value, and identity-verification state.</p>
        </div>
      </div>

      <div className="grid stats">
        <StatCard label="Total customers" value={totals.count} sub="Distinct members" />
        <StatCard label="Lifetime spend" value={fmtTZS(totals.spend)} sub="Across all bookings" tone="green" />
        <StatCard label="Open balances" value={fmtTZS(totals.open)} sub={`${totals.withOpen} members owing`} tone={totals.open > 0 ? "red" : "green"} />
        <StatCard label="Verified IDs" value={kycByCustomer.size} sub="With ID on file" tone="cyan" />
      </div>

      <div className="adm-section" style={{ marginTop: 22 }}>
        <div className="adm-search" style={{ width: "min(320px, 60vw)" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone…" aria-label="Search customers" />
        </div>
        <span className="hint">{rows.length} members</span>
      </div>

      {rows.length === 0 ? (
        <div className="empty"><strong>No customers yet</strong>Members appear here once they place a booking.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Customer</th><th>Zone</th><th>KYC / ID</th><th>Bookings</th><th>Lifetime spend</th><th>Open</th><th>Last seen</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const kyc = kycByCustomer.get(c.name);
                return (
                  <tr key={c.name}>
                    <td><strong>{c.name}</strong><div style={{ color: "var(--dim)", fontSize: ".78rem" }} className="mono">{c.phone}</div></td>
                    <td>{ZONE_LABEL[c.zone_key] ?? titleCase(c.zone_key)}</td>
                    <td>{kyc ? <><Badge tone="green">{titleCase(kyc.id_type)}</Badge> <span className="mono" style={{ color: "var(--dim)" }}>{maskId(kyc.id_number)}</span></> : <Badge tone="gold">Pending</Badge>}</td>
                    <td className="mono">{c.bookings}</td>
                    <td className="mono green">{fmtTZS(c.spend)}</td>
                    <td className="mono" style={{ color: c.open > 0 ? "var(--red)" : "var(--dim)" }}>{fmtTZS(c.open)}</td>
                    <td className="mono">{fmtDay(c.last_at)}</td>
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
