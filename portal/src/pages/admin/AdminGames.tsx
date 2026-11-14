import { useMemo, useState } from "react";
import { adminApi } from "../../lib/adminApi";
import type { Game, GamePlatform, GameStatus } from "../../lib/adminTypes";
import { GAME_STATUS_TONE, titleCase } from "../../lib/adminLabels";
import { Badge, Ic, StatCard } from "../../components/ui";
import { Field, Modal, useAsync, useToast } from "../../components/admin/AdminUi";

const PLATFORMS: GamePlatform[] = ["ps5", "ps4"];
const FORMATS = ["disc", "digital"] as const;
const STATUSES: GameStatus[] = ["available", "rented", "retired"];

const BLANK = { title: "", platform: "ps5" as GamePlatform, genre: "", media_format: "disc" as string, cover_url: "", status: "available" as GameStatus };

export function AdminGames() {
  const toast = useToast();
  const [nonce, setNonce] = useState(0);
  const [filter, setFilter] = useState<"all" | GameStatus>("all");
  const [editing, setEditing] = useState<Game | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);

  const reload = () => setNonce((n) => n + 1);
  const games = useAsync(() => adminApi<{ items: Game[] }>("admin_games").then((r) => r.items), [nonce]);

  const counts = useMemo(() => {
    const list = games.data ?? [];
    return {
      total: list.length,
      available: list.filter((g) => g.status === "available").length,
      rented: list.filter((g) => g.status === "rented").length,
      retired: list.filter((g) => g.status === "retired").length,
    };
  }, [games.data]);

  const rows = useMemo(() => (games.data ?? []).filter((g) => filter === "all" || g.status === filter), [games.data, filter]);

  function openAdd() { setForm({ ...BLANK }); setEditing(null); setAddOpen(true); }
  function openEdit(g: Game) {
    setForm({ title: g.title, platform: g.platform, genre: g.genre ?? "", media_format: g.media_format ?? "disc", cover_url: g.cover_url ?? "", status: g.status });
    setEditing(g); setAddOpen(true);
  }

  async function submit() {
    if (busy || !form.title.trim()) return;
    setBusy(true);
    try {
      const body = {
        title: form.title.trim(), platform: form.platform, genre: form.genre.trim() || undefined,
        media_format: form.media_format, cover_url: form.cover_url.trim() || undefined, status: form.status,
      };
      if (editing) {
        await adminApi("admin_game_update", { method: "POST", body: { id: editing.id, ...body } });
        toast(`Updated ${form.title}.`);
      } else {
        await adminApi("admin_game_create", { method: "POST", body });
        toast(`Added ${form.title} to catalog.`);
      }
      setAddOpen(false); setEditing(null); reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save game.", "err");
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Games Catalog</h1>
          <p>Manage the playable library available across the PS5 fleet.</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={openAdd}><Ic name="plus" size={16} /> Add Game</button>
      </div>

      <div className="grid stats">
        <StatCard label="Total titles" value={counts.total} sub="Whole library" />
        <StatCard label="Available" value={counts.available} sub="Ready to play" tone="green" />
        <StatCard label="Rented out" value={counts.rented} sub="With active rentals" tone="cyan" />
        <StatCard label="Retired" value={counts.retired} sub="Removed from rotation" tone="gray" />
      </div>

      <div className="adm-section" style={{ marginTop: 22 }}>
        <div className="chip-row">
          {(["all", ...STATUSES] as const).map((s) => (
            <button key={s} type="button" className={`chip${filter === s ? " active" : ""}`} onClick={() => setFilter(s)}>{s === "all" ? "All" : titleCase(s)}</button>
          ))}
        </div>
        <span className="hint">{rows.length} shown</span>
      </div>

      {games.loading ? <div className="spinner" /> : null}
      {!games.loading && games.error ? <p className="form-error">{games.error}</p> : null}
      {!games.loading && !games.error && rows.length === 0 ? (
        <div className="empty"><strong>No games yet</strong>Add your first title to start the catalog.</div>
      ) : null}

      {!games.loading && rows.length > 0 ? (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Title</th><th>Platform</th><th>Genre</th><th>Format</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {g.cover_url
                        ? <img src={g.cover_url} alt="" style={{ width: 34, height: 44, objectFit: "cover", borderRadius: 5, background: "var(--panel-2)" }} />
                        : <span style={{ width: 34, height: 44, borderRadius: 5, background: "var(--panel-2)", display: "grid", placeItems: "center", font: "700 14px var(--font-mono)", color: "var(--dim)" }}>{g.title.slice(0, 1).toUpperCase()}</span>}
                      <strong>{g.title}</strong>
                    </span>
                  </td>
                  <td className="mono cyan">{g.platform.toUpperCase()}</td>
                  <td>{g.genre ?? "—"}</td>
                  <td>{g.media_format ? titleCase(g.media_format) : "—"}</td>
                  <td><Badge tone={GAME_STATUS_TONE[g.status]}>{titleCase(g.status)}</Badge></td>
                  <td><button className="btn btn-ghost btn-sm" type="button" onClick={() => openEdit(g)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Modal
        open={addOpen}
        title={editing ? `Edit ${editing.title}` : "Add game"}
        sub={editing ? "Update catalog details." : "Register a title in the playable library."}
        onClose={() => { setAddOpen(false); setEditing(null); }}
        footer={<>
          <button className="btn btn-ghost" type="button" onClick={() => { setAddOpen(false); setEditing(null); }}>Cancel</button>
          <button className="btn btn-primary" type="button" onClick={submit} disabled={busy || !form.title.trim()}>Save</button>
        </>}
      >
        <Field label="Title"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="EA FC 26" /></Field>
        <div className="field-row">
          <Field label="Platform">
            <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as GamePlatform })}>
              {PLATFORMS.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
            </select>
          </Field>
          <Field label="Format">
            <select value={form.media_format} onChange={(e) => setForm({ ...form, media_format: e.target.value })}>
              {FORMATS.map((f) => <option key={f} value={f}>{titleCase(f)}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Genre"><input value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })} placeholder="Sports" /></Field>
        <Field label="Cover URL"><input value={form.cover_url} onChange={(e) => setForm({ ...form, cover_url: e.target.value })} placeholder="https://…" /></Field>
        <Field label="Status">
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as GameStatus })}>
            {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
        </Field>
      </Modal>
    </>
  );
}
