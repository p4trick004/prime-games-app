import { useMemo, useState } from "react";
import { adminApi } from "../../lib/adminApi";
import type { Booking, CustomerAgg, Incident, Rental, Transaction } from "../../lib/adminTypes";
import {
  fmtDay, fmtStamp, INCIDENT_STATUS_TONE, METHOD_LABEL, PRIORITY_TONE,
  RENTAL_STATUS_LABEL, RENTAL_STATUS_TONE, titleCase, TXN_STATUS_TONE,
} from "../../lib/adminLabels";
import { Badge, StatCard } from "../../components/ui";
import { Field, Modal, pingAlerts, useAsync, useToast } from "../../components/admin/AdminUi";
import { fmtTZS } from "../../lib/format";

type Tab = "payments" | "returns" | "incidents";
const TXN_KINDS = ["rental", "deposit", "damage_fee", "late_fee", "adjustment", "other"] as const;
const TXN_METHODS = ["mpesa", "cod", "cash", "bank"] as const;
const INCIDENT_KINDS = ["damage", "loss", "theft", "late_return", "malfunction", "other"] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const INCIDENT_STATUSES = ["open", "investigating", "resolved", "waived"] as const;

function RecordPaymentModal({ customers, bookings, onClose, onDone }: {
  customers: CustomerAgg[]; bookings: Booking[]; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [customerId, setCustomerId] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<(typeof TXN_KINDS)[number]>("rental");
  const [method, setMethod] = useState<(typeof TXN_METHODS)[number]>("mpesa");
  const [status, setStatus] = useState<"settled" | "pending">("settled");
  const [extRef, setExtRef] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await adminApi("admin_transaction_create", {
        method: "POST",
        body: {
          customer_id: customerId || undefined,
          booking_id: bookingId || undefined,
          amount: Number(amount),
          kind, method, status,
          external_reference: extRef.trim() || undefined,
          notes: notes.trim() || undefined,
        },
      });
      toast("Payment recorded in the ledger.");
      onDone(); onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not record payment.");
    } finally {
      setBusy(false);
    }
  }

  const valid = (customerId || bookingId) && Number.isInteger(Number(amount)) && Number(amount) > 0;
  return (
    <Modal open title="Record payment" sub="Appends a receipt to the append-only ledger." onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" type="button" onClick={submit} disabled={busy || !valid}>{busy ? "Recording…" : "Record"}</button>
      </>}>
      <Field label="Customer">
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">Select customer…</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
        </select>
      </Field>
      <Field label="Booking (optional — links the receipt)">
        <select value={bookingId} onChange={(e) => setBookingId(e.target.value)}>
          <option value="">No booking link</option>
          {bookings.map((b) => <option key={b.id} value={b.id}>{b.ref} · {b.customer_name} · {fmtTZS(b.total)}</option>)}
        </select>
      </Field>
      <div className="field-row">
        <Field label="Amount (TSh)"><input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Type">
          <select value={kind} onChange={(e) => setKind(e.target.value as (typeof TXN_KINDS)[number])}>
            {TXN_KINDS.map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}
          </select>
        </Field>
      </div>
      <div className="field-row">
        <Field label="Method">
          <select value={method} onChange={(e) => setMethod(e.target.value as (typeof TXN_METHODS)[number])}>
            {TXN_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as "settled" | "pending")}>
            <option value="settled">Settled</option>
            <option value="pending">Pending</option>
          </select>
        </Field>
      </div>
      <Field label="External reference (M-Pesa code, optional)"><input value={extRef} onChange={(e) => setExtRef(e.target.value)} placeholder="e.g. SFJ4K2L9" /></Field>
      <Field label="Notes (optional)"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {err ? <p className="form-error" role="alert">{err}</p> : null}
    </Modal>
  );
}

function RefundModal({ customers, onClose, onDone }: { customers: CustomerAgg[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof TXN_METHODS)[number]>("mpesa");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await adminApi("admin_refund", {
        method: "POST",
        body: { customer_id: customerId, amount: Number(amount), method, notes: notes.trim() || undefined },
      });
      toast("Refund recorded (negative ledger entry).");
      onDone(); onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not record refund.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="Record refund" sub="Stored as a negative entry — the ledger is never edited." onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" type="button" onClick={submit} disabled={busy || !customerId || !(Number(amount) > 0)}>{busy ? "Recording…" : "Refund"}</button>
      </>}>
      <Field label="Customer">
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">Select customer…</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
        </select>
      </Field>
      <div className="field-row">
        <Field label="Amount (TSh)"><input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Method">
          <select value={method} onChange={(e) => setMethod(e.target.value as (typeof TXN_METHODS)[number])}>
            {TXN_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Reason"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Cancelled booking, overpayment…" /></Field>
      {err ? <p className="form-error" role="alert">{err}</p> : null}
    </Modal>
  );
}

function CorrectModal({ txn, onClose, onDone }: { txn: Transaction; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await adminApi("admin_transaction_update", {
        method: "POST",
        body: { id: txn.id, notes: notes.trim() || undefined },
      });
      toast("Reversal appended — original entry preserved.");
      onDone(); onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not append correction.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Reverse ${txn.ref}`} sub={`${txn.customer_name} · ${fmtTZS(txn.amount)} — appends a correcting entry of ${fmtTZS(-txn.amount)}.`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" type="button" onClick={submit} disabled={busy}>{busy ? "Working…" : "Append reversal"}</button>
      </>}>
      <Field label="Reason (optional)"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Duplicate receipt, wrong amount…" /></Field>
      {err ? <p className="form-error" role="alert">{err}</p> : null}
    </Modal>
  );
}

function IncidentModal({ customers, incident, onClose, onDone }: {
  customers: CustomerAgg[]; incident: Incident | null; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [customerId, setCustomerId] = useState("");
  const [kind, setKind] = useState<(typeof INCIDENT_KINDS)[number]>(incident?.kind as (typeof INCIDENT_KINDS)[number] ?? "damage");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>(incident?.severity ?? "medium");
  const [status, setStatus] = useState<(typeof INCIDENT_STATUSES)[number]>(incident?.status ?? "open");
  const [description, setDescription] = useState(incident?.description ?? "");
  const [claim, setClaim] = useState(incident?.claim_amount != null ? String(incident.claim_amount) : "");
  const [resolvedAmt, setResolvedAmt] = useState(incident?.resolved_amount != null ? String(incident.resolved_amount) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      if (incident) {
        await adminApi("admin_incident_update", {
          method: "POST",
          body: {
            id: incident.id, kind, severity, status,
            description: description.trim() || undefined,
            claim_amount: claim.trim() === "" ? null : Number(claim),
            resolved_amount: resolvedAmt.trim() === "" ? null : Number(resolvedAmt),
          },
        });
        toast("Incident updated.");
      } else {
        await adminApi("admin_incident_create", {
          method: "POST",
          body: {
            customer_id: customerId || undefined, kind, severity, status,
            description: description.trim() || undefined,
            claim_amount: claim.trim() === "" ? undefined : Number(claim),
          },
        });
        toast("Incident logged.");
      }
      onDone(); onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save incident.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={incident ? `Incident ${incident.ref}` : "Log incident"} sub={incident ? incident.customer_name : "Damage, loss, late return or malfunction."} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" type="button" onClick={submit} disabled={busy || (!incident && !customerId)}>{busy ? "Saving…" : "Save"}</button>
      </>}>
      {!incident ? (
        <Field label="Customer">
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
          </select>
        </Field>
      ) : null}
      <div className="field-row">
        <Field label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value as (typeof INCIDENT_KINDS)[number])}>
            {INCIDENT_KINDS.map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}
          </select>
        </Field>
        <Field label="Severity">
          <select value={severity} onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
        </Field>
      </div>
      <div className="field-row">
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as (typeof INCIDENT_STATUSES)[number])}>
            {INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
        </Field>
        <Field label="Claim amount (TSh)"><input type="number" min={0} value={claim} onChange={(e) => setClaim(e.target.value)} /></Field>
      </div>
      {incident ? (
        <Field label="Resolved amount (TSh)"><input type="number" min={0} value={resolvedAmt} onChange={(e) => setResolvedAmt(e.target.value)} /></Field>
      ) : null}
      <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What happened…" /></Field>
      {err ? <p className="form-error" role="alert">{err}</p> : null}
    </Modal>
  );
}

export function AdminPayments() {
  const [tab, setTab] = useState<Tab>("payments");
  const [nonce, setNonce] = useState(0);
  const [payOpen, setPayOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [correctFor, setCorrectFor] = useState<Transaction | null>(null);
  const [incidentFor, setIncidentFor] = useState<Incident | null>(null);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const reload = () => { setNonce((n) => n + 1); pingAlerts(); };

  const data = useAsync(async () => {
    const [txns, incidents, rentals, customers, bookings] = await Promise.all([
      adminApi<{ items: Transaction[] }>("admin_transactions").then((r) => r.items),
      adminApi<{ items: Incident[] }>("admin_incidents").then((r) => r.items),
      adminApi<{ items: Rental[] }>("admin_rentals").then((r) => r.items),
      adminApi<{ customers: CustomerAgg[] }>("admin_customers").then((r) => r.customers ?? []),
      adminApi<{ items: Booking[] }>("admin_bookings").then((r) => r.items ?? []),
    ]);
    return { txns, incidents, rentals, customers, bookings };
  }, [nonce]);

  const settled = useMemo(() => (data.data?.txns ?? []).filter((t) => t.status === "settled").reduce((s, t) => s + t.amount, 0), [data.data]);
  const pendingAmt = useMemo(() => (data.data?.txns ?? []).filter((t) => t.status === "pending").reduce((s, t) => s + t.amount, 0), [data.data]);
  const openReturns = useMemo(() => (data.data?.rentals ?? []).filter((r) => r.status === "active" || r.status === "overdue").length, [data.data]);
  const openIncidents = useMemo(() => (data.data?.incidents ?? []).filter((i) => i.status === "open" || i.status === "investigating").length, [data.data]);

  if (data.loading) return <div className="spinner" />;
  if (data.error) return <p className="form-error">{data.error}</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payments, Returns &amp; Incidents</h1>
          <p>Append-only ledger, console return cycles, and damage / claim handling.</p>
        </div>
        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary" type="button" onClick={() => setPayOpen(true)}>Record payment</button>
          <button className="btn btn-ghost" type="button" onClick={() => setRefundOpen(true)}>Refund</button>
        </span>
      </div>

      <div className="grid stats">
        <StatCard label="Settled (net)" value={fmtTZS(settled)} sub="Receipts minus refunds & reversals" tone="green" />
        <StatCard label="Pending" value={fmtTZS(pendingAmt)} sub="Awaiting settlement" tone="gold" alert={pendingAmt > 0} />
        <StatCard label="Open returns" value={openReturns} sub="Consoles out with customers" tone="cyan" />
        <StatCard label="Open incidents" value={openIncidents} sub="Needs review" tone={openIncidents > 0 ? "red" : "green"} />
      </div>

      <div className="adm-tabs" style={{ marginTop: 22 }}>
        {(["payments", "returns", "incidents"] as Tab[]).map((t) => (
          <button key={t} type="button" className={`adm-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>{titleCase(t)}</button>
        ))}
      </div>

      {tab === "payments" ? (
        (data.data?.txns ?? []).length === 0 ? <div className="empty"><strong>No transactions</strong>Record the first payment to start the ledger.</div> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Ref</th><th>Customer</th><th>Booking</th><th>Type</th><th>Method</th><th>Amount</th><th>Status</th><th>When</th><th></th></tr></thead>
              <tbody>
                {data.data!.txns.map((t) => (
                  <tr key={t.id}>
                    <td className="mono cyan">{t.ref}</td>
                    <td><strong>{t.customer_name}</strong></td>
                    <td className="mono">{t.booking_ref ?? "—"}</td>
                    <td>{titleCase(t.kind)}</td>
                    <td>{METHOD_LABEL[t.method] ?? titleCase(t.method)}</td>
                    <td className="mono" style={{ color: t.amount < 0 ? "var(--red)" : undefined }}>{fmtTZS(t.amount)}</td>
                    <td><Badge tone={TXN_STATUS_TONE[t.status]}>{titleCase(t.status)}</Badge></td>
                    <td className="mono">{fmtDay(t.occurred_at)}</td>
                    <td>
                      {t.amount > 0 && t.status === "settled" ? (
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setCorrectFor(t)}>Reverse</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === "returns" ? (
        (data.data?.rentals ?? []).length === 0 ? <div className="empty"><strong>No return cycles</strong>Hand a console over from Bookings &amp; Rentals to start a cycle.</div> : (
          <>
            <p className="hint" style={{ margin: "10px 0" }}>Process returns from Bookings &amp; Rentals → Rentals (condition, late fee and console release are atomic).</p>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Booking</th><th>Customer</th><th>Unit</th><th>Out since</th><th>Due back</th><th>Returned</th><th>State</th></tr></thead>
                <tbody>
                  {data.data!.rentals.map((r) => (
                    <tr key={r.id}>
                      <td className="mono cyan">{r.booking_ref ?? "—"}</td>
                      <td><strong>{r.customer_name}</strong></td>
                      <td className="mono">{r.unit_code ?? "—"}</td>
                      <td className="mono">{fmtStamp(r.start_at)}</td>
                      <td className="mono gold">{fmtStamp(r.expected_return_at)}</td>
                      <td className="mono">{fmtStamp(r.actual_return_at)}</td>
                      <td><Badge tone={RENTAL_STATUS_TONE[r.status]}>{RENTAL_STATUS_LABEL[r.status]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : null}

      {tab === "incidents" ? (
        <>
          <div className="adm-section" style={{ marginTop: 14 }}>
            <span className="hint">Claims feed Model C debt while open and unresolved.</span>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setIncidentOpen(true)}>Log incident</button>
          </div>
          {(data.data?.incidents ?? []).length === 0 ? <div className="empty"><strong>No incidents</strong>Damage and claim reports appear here.</div> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Ref</th><th>Customer</th><th>Unit</th><th>Kind</th><th>Severity</th><th>Claim</th><th>Resolved</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {data.data!.incidents.map((i) => (
                    <tr key={i.id}>
                      <td className="mono cyan">{i.ref}</td>
                      <td><strong>{i.customer_name}</strong></td>
                      <td className="mono">{i.unit_code ?? "—"}</td>
                      <td>{titleCase(i.kind)}</td>
                      <td><Badge tone={PRIORITY_TONE[i.severity]}>{titleCase(i.severity)}</Badge></td>
                      <td className="mono">{i.claim_amount != null ? fmtTZS(i.claim_amount) : "—"}</td>
                      <td className="mono">{i.resolved_amount != null ? fmtTZS(i.resolved_amount) : "—"}</td>
                      <td><Badge tone={INCIDENT_STATUS_TONE[i.status]}>{titleCase(i.status)}</Badge></td>
                      <td><button className="btn btn-ghost btn-sm" type="button" onClick={() => setIncidentFor(i)}>Update</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {payOpen ? <RecordPaymentModal customers={data.data?.customers ?? []} bookings={data.data?.bookings ?? []} onClose={() => setPayOpen(false)} onDone={reload} /> : null}
      {refundOpen ? <RefundModal customers={data.data?.customers ?? []} onClose={() => setRefundOpen(false)} onDone={reload} /> : null}
      {correctFor ? <CorrectModal txn={correctFor} onClose={() => setCorrectFor(null)} onDone={reload} /> : null}
      {incidentOpen ? <IncidentModal customers={data.data?.customers ?? []} incident={null} onClose={() => setIncidentOpen(false)} onDone={reload} /> : null}
      {incidentFor ? <IncidentModal customers={data.data?.customers ?? []} incident={incidentFor} onClose={() => setIncidentFor(null)} onDone={reload} /> : null}
    </>
  );
}