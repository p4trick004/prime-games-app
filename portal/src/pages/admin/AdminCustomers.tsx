import { useMemo, useState } from "react";
import { adminApi } from "../../lib/adminApi";
import type { CustomerAgg, CustomerLink, KycDocument } from "../../lib/adminTypes";
import {
  CUSTOMER_STATUS_TONE, KYC_STATUS_TONE, LINK_STATUS_TONE, TIER_LABEL, TIER_TONE,
  fmtDay, fmtStamp, titleCase,
} from "../../lib/adminLabels";
import { Badge, StatCard } from "../../components/ui";
import { Field, Modal, pingAlerts, useAsync, useToast } from "../../components/admin/AdminUi";
import { fmtTZS } from "../../lib/format";

type Tab = "members" | "links" | "kyc";
const LINK_TABS = ["pending", "linked", "rejected", "conflict"] as const;

function EditCustomerModal({ customer, onClose, onSaved }: { customer: CustomerAgg; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [tier, setTier] = useState(customer.customer_tier);
  const [credit, setCredit] = useState(String(customer.credit_limit));
  const [status, setStatus] = useState(customer.customer_status);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { id: customer.id, customer_tier: tier, customer_status: status };
      // The backend forbids credit on non-premium tiers; only send a limit for premium.
      if (tier === "premium") body.credit_limit = Number(credit) || 0;
      if (notes.trim()) body.notes = notes.trim();
      await adminApi("admin_customer_update", { method: "POST", body });
      toast(`${customer.name} updated.`);
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Update failed.", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Edit — ${customer.name}`} sub="Tier, credit and standing. Changes are audited." onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" type="button" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      </>}>
      <div className="field-row">
        <Field label="Tier">
          <select value={tier} onChange={(e) => setTier(e.target.value as CustomerAgg["customer_tier"])}>
            <option value="basic">Basic (guest)</option>
            <option value="standard">Standard</option>
            <option value="premium">Premium</option>
          </select>
        </Field>
        <Field label="Standing">
          <select value={status} onChange={(e) => setStatus(e.target.value as CustomerAgg["customer_status"])}>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="blacklisted">Blacklisted</option>
          </select>
        </Field>
      </div>
      <Field label="Credit limit (TSh) — premium only">
        <input type="number" min={0} value={tier === "premium" ? credit : "0"} disabled={tier !== "premium"}
          onChange={(e) => setCredit(e.target.value)} />
      </Field>
      {tier !== "premium" ? <p className="hint" style={{ margin: "4px 0 10px" }}>Basic/Standard must settle in full before handover — no credit allowed.</p> : null}
      <Field label="Notes (optional, audited)">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason for the change…" />
      </Field>
    </Modal>
  );
}

function LinkDecisionModal({ link, decision, onClose, onDone }: { link: CustomerLink; decision: "approve" | "reject"; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      if (decision === "approve") {
        await adminApi("admin_link_approve", { method: "POST", body: { link_id: link.id, evidence: text.trim() } });
        toast(`Linked ${link.customer_name}'s guest history to their account.`);
      } else {
        await adminApi("admin_link_reject", { method: "POST", body: { link_id: link.id, reason: text.trim() || undefined } });
        toast("Link request rejected.");
      }
      onDone();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action failed.", "err");
    } finally {
      setBusy(false);
    }
  }

  const valid = decision === "reject" || text.trim().length >= 3;
  return (
    <Modal open title={decision === "approve" ? "Approve guest link" : "Reject link request"}
      sub={`${link.customer_name} · ${link.customer_phone ?? "no phone"}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
        <button className={`btn ${decision === "approve" ? "btn-primary" : "btn-ghost"}`} type="button" onClick={submit} disabled={busy || !valid}>
          {busy ? "Working…" : decision === "approve" ? "Verify & link" : "Reject"}
        </button>
      </>}>
      {decision === "approve" ? (
        <>
          <p className="hint" style={{ margin: "0 0 10px" }}>
            Only approve after verifying identity in person / on a call. The guest customer keeps all history and becomes the member customer.
          </p>
          <Field label="Verification evidence (required, min 3 chars)">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Verified NIDA in person at shop, 18 Nov" />
          </Field>
        </>
      ) : (
        <Field label="Reason (optional)">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Could not verify identity" />
        </Field>
      )}
    </Modal>
  );
}

function KycRejectModal({ doc, onClose, onDone }: { doc: KycDocument; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await adminApi("admin_kyc_verify", { method: "POST", body: { decision: "rejected", document_id: doc.id, reason: reason.trim() || undefined } });
      toast("Document rejected.");
      onDone(); onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action failed.", "err");
    } finally { setBusy(false); }
  }
  return (
    <Modal open title="Reject KYC document" sub={`${doc.customer_name} · ${titleCase(doc.doc_type)}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn btn-ghost" type="button" onClick={submit} disabled={busy}>{busy ? "Working…" : "Reject"}</button>
      </>}>
      <Field label="Reason (optional)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Blurry image, mismatched name…" /></Field>
    </Modal>
  );
}

export function AdminCustomers() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("members");
  const [q, setQ] = useState("");
  const [linkStatus, setLinkStatus] = useState<(typeof LINK_TABS)[number]>("pending");
  const [nonce, setNonce] = useState(0);
  const [editFor, setEditFor] = useState<CustomerAgg | null>(null);
  const [decision, setDecision] = useState<{ link: CustomerLink; kind: "approve" | "reject" } | null>(null);
  const [rejectDoc, setRejectDoc] = useState<KycDocument | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const reload = () => { setNonce((n) => n + 1); pingAlerts(); };

  const data = useAsync(async () => {
    const [customers, links, kyc] = await Promise.all([
      adminApi<{ customers: CustomerAgg[] }>("admin_customers").then((r) => r.customers ?? []),
      adminApi<{ items: CustomerLink[] }>("admin_links", { params: { status: linkStatus } }).then((r) => r.items ?? []),
      adminApi<{ items: KycDocument[] }>("admin_kyc").then((r) => r.items ?? []),
    ]);
    return { customers, links, kyc };
  }, [nonce, linkStatus]);

  const rows = useMemo(() => {
    const list = data.data?.customers ?? [];
    const term = q.trim().toLowerCase();
    return list.filter((c) => !term || c.name.toLowerCase().includes(term) || c.phone.includes(term));
  }, [data.data, q]);

  const totals = useMemo(() => {
    const list = data.data?.customers ?? [];
    return {
      count: list.length,
      spend: list.reduce((s, c) => s + c.spend, 0),
      debt: list.reduce((s, c) => s + c.outstanding, 0),
      premium: list.filter((c) => c.customer_tier === "premium").length,
    };
  }, [data.data]);

  async function viewDoc(doc: KycDocument) {
    if (busyId) return;
    setBusyId(doc.id);
    try {
      const r = await adminApi<{ url: string }>("admin_kyc_url", { params: { document_id: doc.id } });
      window.open(r.url, "_blank", "noopener");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not open document.", "err");
    } finally { setBusyId(null); }
  }

  async function verifyDoc(doc: KycDocument) {
    if (busyId) return;
    setBusyId(doc.id);
    try {
      await adminApi("admin_kyc_verify", { method: "POST", body: { decision: "verified", document_id: doc.id } });
      toast(`${doc.customer_name}'s document verified.`);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Verification failed.", "err");
    } finally { setBusyId(null); }
  }

  if (data.loading) return <div className="spinner" />;
  if (data.error) return <p className="form-error">{data.error}</p>;

  const pendingKyc = (data.data?.kyc ?? []).filter((d) => d.verification_status === "pending").length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Customers &amp; KYC</h1>
          <p>Member tiers, credit, guest-history linking and private identity documents.</p>
        </div>
      </div>

      <div className="grid stats">
        <StatCard label="Total customers" value={totals.count} sub={`${totals.premium} premium`} />
        <StatCard label="Lifetime spend" value={fmtTZS(totals.spend)} sub="Across all bookings" tone="green" />
        <StatCard label="Outstanding debt" value={fmtTZS(totals.debt)} sub="Model C — incurred obligations" tone={totals.debt > 0 ? "red" : "green"} />
        <StatCard label="Pending KYC" value={pendingKyc} sub="Documents awaiting review" tone={pendingKyc > 0 ? "gold" : "green"} />
      </div>

      <div className="adm-tabs" style={{ marginTop: 22 }}>
        {(["members", "links", "kyc"] as Tab[]).map((t) => (
          <button key={t} type="button" className={`adm-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t === "members" ? "Members" : t === "links" ? "Guest link requests" : "KYC documents"}
          </button>
        ))}
      </div>

      {tab === "members" ? (
        <>
          <div className="adm-section" style={{ marginTop: 14 }}>
            <div className="adm-search" style={{ width: "min(320px, 60vw)" }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone…" aria-label="Search customers" />
            </div>
            <span className="hint">{rows.length} customers · debt = incurred obligations; open = unpaid future bookings</span>
          </div>
          {rows.length === 0 ? (
            <div className="empty"><strong>No customers yet</strong>Customers appear here once they place a booking.</div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Customer</th><th>Tier</th><th>Standing</th><th>Credit limit</th><th>Bookings</th><th>Spend</th><th>Debt</th><th>Open</th><th></th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td><strong>{c.name}</strong><div style={{ color: "var(--dim)", fontSize: ".78rem" }} className="mono">{c.phone || "—"}</div></td>
                      <td><Badge tone={TIER_TONE[c.customer_tier]}>{TIER_LABEL[c.customer_tier]}</Badge></td>
                      <td><Badge tone={CUSTOMER_STATUS_TONE[c.customer_status]}>{titleCase(c.customer_status)}</Badge></td>
                      <td className="mono">{c.customer_tier === "premium" ? fmtTZS(c.credit_limit) : "—"}</td>
                      <td className="mono">{c.bookings}</td>
                      <td className="mono green">{fmtTZS(c.spend)}</td>
                      <td className="mono" style={{ color: c.outstanding > 0 ? "var(--red)" : "var(--dim)" }}>{fmtTZS(c.outstanding)}</td>
                      <td className="mono" style={{ color: "var(--dim)" }}>{c.open}</td>
                      <td><button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditFor(c)}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {tab === "links" ? (
        <>
          <div className="adm-tabs" style={{ marginTop: 14 }}>
            {LINK_TABS.map((s) => (
              <button key={s} type="button" className={`adm-tab${linkStatus === s ? " active" : ""}`} onClick={() => setLinkStatus(s)}>{titleCase(s)}</button>
            ))}
          </div>
          {(data.data?.links ?? []).length === 0 ? (
            <div className="empty"><strong>No {linkStatus} link requests</strong>Guest-history link requests appear here for verification.</div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Guest customer</th><th>Phone</th><th>Method</th><th>Evidence</th><th>Requested</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {data.data!.links.map((l) => (
                    <tr key={l.id}>
                      <td><strong>{l.customer_name}</strong></td>
                      <td className="mono">{l.customer_phone ?? "—"}</td>
                      <td>{titleCase(l.link_method)}</td>
                      <td style={{ maxWidth: 260 }}>{l.evidence ?? "—"}</td>
                      <td className="mono">{fmtStamp(l.created_at)}</td>
                      <td><Badge tone={LINK_STATUS_TONE[l.status]}>{titleCase(l.status)}</Badge></td>
                      <td>
                        {l.status === "pending" ? (
                          <span style={{ display: "flex", gap: 6 }}>
                            <button className="btn btn-primary btn-sm" type="button" onClick={() => setDecision({ link: l, kind: "approve" })}>Approve</button>
                            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setDecision({ link: l, kind: "reject" })}>Reject</button>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {tab === "kyc" ? (
        (data.data?.kyc ?? []).length === 0 ? (
          <div className="empty"><strong>No KYC documents</strong>Private uploads appear here. ID numbers are stored masked only.</div>
        ) : (
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table className="data">
              <thead><tr><th>Customer</th><th>Document</th><th>ID (masked)</th><th>Uploaded</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {data.data!.kyc.map((d) => (
                  <tr key={d.id}>
                    <td><strong>{d.customer_name}</strong><div style={{ color: "var(--dim)", fontSize: ".78rem" }} className="mono">{d.customer_phone ?? ""}</div></td>
                    <td>{titleCase(d.doc_type)}{d.file_name ? <div style={{ color: "var(--dim)", fontSize: ".78rem" }}>{d.file_name}</div> : null}</td>
                    <td className="mono">{d.id_number_masked ?? "—"}</td>
                    <td className="mono">{fmtDay(d.created_at)}</td>
                    <td><Badge tone={KYC_STATUS_TONE[d.verification_status]}>{titleCase(d.verification_status)}</Badge></td>
                    <td>
                      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn btn-ghost btn-sm" type="button" disabled={busyId === d.id} onClick={() => void viewDoc(d)}>View</button>
                        {d.verification_status === "pending" ? (
                          <>
                            <button className="btn btn-primary btn-sm" type="button" disabled={busyId === d.id} onClick={() => void verifyDoc(d)}>Verify</button>
                            <button className="btn btn-ghost btn-sm" type="button" disabled={busyId === d.id} onClick={() => setRejectDoc(d)}>Reject</button>
                          </>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {editFor ? <EditCustomerModal customer={editFor} onClose={() => setEditFor(null)} onSaved={reload} /> : null}
      {decision ? <LinkDecisionModal link={decision.link} decision={decision.kind} onClose={() => setDecision(null)} onDone={reload} /> : null}
      {rejectDoc ? <KycRejectModal doc={rejectDoc} onClose={() => setRejectDoc(null)} onDone={reload} /> : null}
    </>
  );
}