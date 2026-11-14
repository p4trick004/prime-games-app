import { useMemo, useState } from "react";
import { adminApi } from "../../lib/adminApi";
import type { AdminStats, ConsoleUnit, MaintenanceRecord } from "../../lib/adminTypes";
import {
  CONDITION_LABEL, CONDITION_TONE, CONSOLE_STATUS_LABEL, CONSOLE_STATUS_TONE,
  MAINT_STATUS_TONE, PRIORITY_TONE, fmtDay, titleCase,
} from "../../lib/adminLabels";
import { Badge, Ic, StatCard } from "../../components/ui";
import { Field, Modal, pingAlerts, useAsync, useToast } from "../../components/admin/AdminUi";

const FLEET_IMG = "/assets/ps5-hero.jpg";
const STATUS_OPTIONS = ["available", "rented", "maintenance", "retired"] as const;
const CONDITION_OPTIONS = ["excellent", "good", "fair", "poor"] as const;
const PRIORITY_OPTIONS = ["low", "medium", "high", "critical"] as const;

function TechLogsModal({ unit, onClose }: { unit: ConsoleUnit; onClose: () => void }) {
  const logs = useAsync(
    () => adminApi<{ items: MaintenanceRecord[] }>("admin_maintenance", { params: { console_id: unit.id } }).then((r) => r.items),
    [unit.id],
  );
  return (
    <Modal open title={`Tech logs — ${unit.unit_code}`} sub={unit.model} onClose={onClose}>
      {logs.loading ? <div className="spinner" /> : null}
      {!logs.loading && logs.error ? <p className="form-error">{logs.error}</p> : null}
      {!logs.loading && logs.data && logs.data.length === 0 ? (
        <div className="empty"><strong>No service history</strong>This unit has no logged repairs yet.</div>
      ) : null}
      {!logs.loading && logs.data && logs.data.length > 0 ? (
        <div className="update-list">
          {logs.data.map((m) => (
            <div className="update" key={m.id}>
              <span className={`ico ${m.status === "resolved" ? "green" : "gold"}`}>
                <Ic name="box" size={15} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{m.issue}</strong>
                <span>{titleCase(m.priority)} priority · {m.engineer ?? "unassigned"} · opened {fmtDay(m.opened_at)}</span>
              </span>
              <Badge tone={MAINT_STATUS_TONE[m.status]}>{titleCase(m.status)}</Badge>
            </div>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}

export function AdminInventory() {
  const toast = useToast();
  const [nonce, setNonce] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);
  const [logsFor, setLogsFor] = useState<ConsoleUnit | null>(null);
  const [busy, setBusy] = useState(false);

  const [unit, setUnit] = useState({ unit_code: "", model: "", serial_number: "", status: "available", condition_grade: "excellent" });
  const [sched, setSched] = useState({ console_id: "", issue: "", priority: "medium", engineer: "" });

  const reload = () => setNonce((n) => n + 1);

  const stats = useAsync(() => adminApi<{ stats: AdminStats }>("admin_stats").then((r) => r.stats), [nonce]);
  const consoles = useAsync(() => adminApi<{ items: ConsoleUnit[] }>("admin_consoles").then((r) => r.items), [nonce]);
  const maint = useAsync(() => adminApi<{ items: MaintenanceRecord[] }>("admin_maintenance").then((r) => r.items), [nonce]);

  const overdue = useMemo(
    () => (maint.data ?? []).filter((m) => m.status !== "resolved" && (m.priority === "high" || m.priority === "critical")),
    [maint.data],
  );

  async function dispatchEngineers() {
    if (busy || overdue.length === 0) return;
    setBusy(true);
    try {
      await Promise.all(overdue.map((m) => adminApi("admin_maintenance_update", { method: "POST", body: { id: m.id, status: "in_progress" } })));
      toast(`Dispatched engineers for ${overdue.length} unit${overdue.length === 1 ? "" : "s"}.`);
      reload();
      pingAlerts();
    } catch {
      toast("Could not dispatch engineers.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function submitAdd() {
    if (busy) return;
    setBusy(true);
    try {
      await adminApi("admin_console_create", {
        method: "POST",
        body: {
          unit_code: unit.unit_code, model: unit.model,
          serial_number: unit.serial_number || null,
          status: unit.status, condition_grade: unit.condition_grade,
        },
      });
      toast(`Console ${unit.unit_code} added to fleet.`);
      setAddOpen(false);
      setUnit({ unit_code: "", model: "", serial_number: "", status: "available", condition_grade: "excellent" });
      reload();
    } catch (e) {
      toast(e instanceof Error && e.message === "duplicate_unit_code" ? "That unit code already exists." : "Could not add console.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function submitSchedule() {
    if (busy || !sched.console_id) return;
    setBusy(true);
    try {
      await adminApi("admin_maintenance_create", {
        method: "POST",
        body: {
          console_id: sched.console_id, issue: sched.issue,
          priority: sched.priority, engineer: sched.engineer || null, status: "open",
        },
      });
      toast("Maintenance scheduled.");
      setSchedOpen(false);
      setSched({ console_id: "", issue: "", priority: "medium", engineer: "" });
      reload();
      pingAlerts();
    } catch {
      toast("Could not schedule maintenance.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await adminApi("admin_maintenance_update", { method: "POST", body: { id, status: "resolved", resolved_at: new Date().toISOString() } });
      toast("Repair marked resolved.");
      reload();
      pingAlerts();
    } catch {
      toast("Could not update repair.", "err");
    } finally {
      setBusy(false);
    }
  }

  const s = stats.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>PS5 Inventory &amp; Asset Command</h1>
          <p>Audit physical devices, track grade status, and dispatch scheduled hardware maintenance.</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => setAddOpen(true)}>
          <Ic name="plus" size={16} /> Add Console Unit
        </button>
      </div>

      <div className="grid stats5">
        <StatCard label="Total units" value={s?.consoles_total ?? "—"} sub="All managed assets" />
        <StatCard label="Available now" value={s?.consoles_available ?? "—"} sub="Ready for dispatch" tone="green" border="green" />
        <StatCard label="Rented out" value={s?.consoles_rented ?? "—"} sub="Generating active revenue" tone="cyan" />
        <StatCard label="In maintenance" value={s?.consoles_maintenance ?? "—"} sub="Awaiting service clearance" tone="gold" border="gold" />
        <StatCard label="Retired assets" value={s?.consoles_retired ?? "—"} sub="End-of-life catalog archive" tone="gray" />
      </div>

      {overdue.length > 0 ? (
        <div className="banner gold">
          <span className="ico">⚠️</span>
          <p className="grow">
            <strong>Overdue maintenance flag:</strong>{" "}
            {overdue.length} console unit{overdue.length === 1 ? "" : "s"} ({overdue.map((m) => m.unit_code).join(" & ")}) require critical safety review.
          </p>
          <button className="btn btn-gold btn-sm" type="button" onClick={dispatchEngineers} disabled={busy}>
            Dispatch Engineers
          </button>
        </div>
      ) : null}

      <div className="adm-section">
        <h2>Fleet Status Grid</h2>
        <span className="hint">{consoles.data?.length ?? 0} units tracked</span>
      </div>

      {consoles.loading ? <div className="spinner" /> : null}
      {!consoles.loading && consoles.error ? <p className="form-error">{consoles.error}</p> : null}
      {!consoles.loading && consoles.data && consoles.data.length === 0 ? (
        <div className="empty"><strong>No consoles yet</strong>Add your first PS5 unit to start tracking the fleet.</div>
      ) : null}

      <div className="fleet-grid">
        {(consoles.data ?? []).map((c) => (
          <div className={`fleet-card ${c.status}`} key={c.id}>
            <div className="fc-img"><img src={FLEET_IMG} alt="" loading="lazy" /></div>
            <div className="fc-top">
              <span className="unit">{c.unit_code}</span>
              <Badge tone={CONSOLE_STATUS_TONE[c.status]}>{CONSOLE_STATUS_LABEL[c.status]}</Badge>
            </div>
            <div className="meta">
              <span>Model:</span><b>{c.model}</b>
              <span>S/N:</span><b className="mono">{c.serial_number ?? "—"}</b>
            </div>
            <div className="meta">
              <span>Cond:</span><b style={{ color: `var(--${CONDITION_TONE[c.condition_grade] === "gray" ? "dim" : CONDITION_TONE[c.condition_grade]})` }}>{CONDITION_LABEL[c.condition_grade]}</b>
              <span>Last audit:</span><b>{fmtDay(c.last_audit_at)}</b>
              <span>Renter:</span><b>{c.current_renter ?? "None"}</b>
              <span>Rentals:</span><b className="mono gold">{c.rentals_count}</b>
            </div>
            <div className="fc-actions">
              <button className="btn btn-ghost btn-sm btn-block" type="button" onClick={() => setLogsFor(c)}>
                View Tech logs
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 26 }}>
        <div className="adm-section" style={{ margin: "0 0 16px" }}>
          <div>
            <h2>Active Engineering &amp; Repair Registry</h2>
            <span className="hint">Track repair cycles, fan thermal performance, and optical block replacements.</span>
          </div>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSchedOpen(true)}>
            <Ic name="plus" size={14} /> Schedule Maintenance
          </button>
        </div>

        {maint.loading ? <div className="spinner" /> : null}
        {!maint.loading && maint.data && maint.data.length === 0 ? (
          <div className="empty"><strong>No open repairs</strong>The fleet is healthy — nothing in the repair registry.</div>
        ) : null}
        {!maint.loading && maint.data && maint.data.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Unit ID</th><th>Issue description</th><th>Priority</th><th>Assigned tech</th><th>Cycle status</th><th>Opened</th><th></th></tr>
              </thead>
              <tbody>
                {maint.data.map((m) => (
                  <tr key={m.id}>
                    <td className="mono cyan">{m.unit_code}</td>
                    <td>{m.issue}</td>
                    <td><Badge tone={PRIORITY_TONE[m.priority]}>{m.priority}</Badge></td>
                    <td>{m.engineer ?? "—"}</td>
                    <td><Badge tone={MAINT_STATUS_TONE[m.status]}>{titleCase(m.status)}</Badge></td>
                    <td className="mono">{fmtDay(m.opened_at)}</td>
                    <td>
                      {m.status !== "resolved" ? (
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => resolve(m.id)} disabled={busy}>Resolve</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <Modal
        open={addOpen}
        title="Add console unit"
        sub="Register a new PS5 in the managed fleet."
        onClose={() => setAddOpen(false)}
        footer={<>
          <button className="btn btn-ghost" type="button" onClick={() => setAddOpen(false)}>Cancel</button>
          <button className="btn btn-primary" type="button" onClick={submitAdd} disabled={busy || !unit.unit_code || !unit.model}>Add unit</button>
        </>}
      >
        <div className="field-row">
          <Field label="Unit code"><input value={unit.unit_code} onChange={(e) => setUnit({ ...unit, unit_code: e.target.value })} placeholder="PS5-009" /></Field>
          <Field label="Model"><input value={unit.model} onChange={(e) => setUnit({ ...unit, model: e.target.value })} placeholder="Disc Edition" /></Field>
        </div>
        <Field label="Serial number"><input value={unit.serial_number} onChange={(e) => setUnit({ ...unit, serial_number: e.target.value })} placeholder="FC348821990" /></Field>
        <div className="field-row">
          <Field label="Status">
            <select value={unit.status} onChange={(e) => setUnit({ ...unit, status: e.target.value })}>
              {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{CONSOLE_STATUS_LABEL[o]}</option>)}
            </select>
          </Field>
          <Field label="Condition">
            <select value={unit.condition_grade} onChange={(e) => setUnit({ ...unit, condition_grade: e.target.value })}>
              {CONDITION_OPTIONS.map((o) => <option key={o} value={o}>{CONDITION_LABEL[o]}</option>)}
            </select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={schedOpen}
        title="Schedule maintenance"
        sub="Open a repair ticket against a fleet unit."
        onClose={() => setSchedOpen(false)}
        footer={<>
          <button className="btn btn-ghost" type="button" onClick={() => setSchedOpen(false)}>Cancel</button>
          <button className="btn btn-primary" type="button" onClick={submitSchedule} disabled={busy || !sched.console_id || sched.issue.trim().length < 2}>Schedule</button>
        </>}
      >
        <Field label="Console unit">
          <select value={sched.console_id} onChange={(e) => setSched({ ...sched, console_id: e.target.value })}>
            <option value="">Select a unit…</option>
            {(consoles.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.unit_code} — {c.model}</option>)}
          </select>
        </Field>
        <Field label="Issue description"><input value={sched.issue} onChange={(e) => setSched({ ...sched, issue: e.target.value })} placeholder="Controller stick drift & optical drive cleaning" /></Field>
        <div className="field-row">
          <Field label="Priority">
            <select value={sched.priority} onChange={(e) => setSched({ ...sched, priority: e.target.value })}>
              {PRIORITY_OPTIONS.map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}
            </select>
          </Field>
          <Field label="Assigned tech"><input value={sched.engineer} onChange={(e) => setSched({ ...sched, engineer: e.target.value })} placeholder="Nassor J." /></Field>
        </div>
      </Modal>

      {logsFor ? <TechLogsModal unit={logsFor} onClose={() => setLogsFor(null)} /> : null}
    </>
  );
}
