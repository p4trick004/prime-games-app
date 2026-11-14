import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ADMIN_NAV, MOBILE_TABS } from "../../lib/adminNav";
import { adminApi } from "../../lib/adminApi";
import { useAdminAuth } from "../../lib/adminAuth";
import type { AdminStats, Booking, ConsoleUnit, Game } from "../../lib/adminTypes";
import { GamepadMark, Ic } from "../ui";
import { ALERT_EVENT } from "./AdminUi";
import "../../admin.css";

function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cache, setCache] = useState<{ bookings: Booking[]; consoles: ConsoleUnit[]; games: Game[] } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2 || cache) return;
    let alive = true;
    Promise.all([
      adminApi<{ items: Booking[] }>("admin_bookings"),
      adminApi<{ items: ConsoleUnit[] }>("admin_consoles"),
      adminApi<{ items: Game[] }>("admin_games"),
    ])
      .then(([b, c, g]) => { if (alive) setCache({ bookings: b.items, consoles: c.items, games: g.items }); })
      .catch(() => { /* search is best-effort */ });
    return () => { alive = false; };
  }, [q, cache]);

  const term = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!cache || term.length < 2) return null;
    const bookings = cache.bookings
      .filter((b) => b.ref.toLowerCase().includes(term) || b.customer_name.toLowerCase().includes(term) || b.customer_phone.includes(term))
      .slice(0, 5);
    const consoles = cache.consoles
      .filter((c) => c.unit_code.toLowerCase().includes(term) || c.model.toLowerCase().includes(term) || (c.serial_number ?? "").toLowerCase().includes(term))
      .slice(0, 5);
    const games = cache.games.filter((g) => g.title.toLowerCase().includes(term)).slice(0, 5);
    return { bookings, consoles, games, total: bookings.length + consoles.length + games.length };
  }, [cache, term]);

  const go = (path: string) => { setOpen(false); setQ(""); navigate(path); };

  return (
    <div className="adm-search" ref={wrapRef}>
      <span className="s-ico"><Ic name="search" size={16} /></span>
      <input
        type="search"
        value={q}
        placeholder="Search fleet, games, bookings…"
        aria-label="Global search"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && results ? (
        <div className="results">
          {results.total === 0 ? <div className="r-empty">No matches for “{q.trim()}”</div> : null}
          {results.consoles.length ? (
            <>
              <div className="r-group">Fleet</div>
              {results.consoles.map((c) => (
                <div key={c.id} className="r-item" onClick={() => go("/admin/inventory")}>
                  <Ic name="box" size={16} /> <span><strong>{c.unit_code}</strong><span>{c.model} · {c.status}</span></span>
                </div>
              ))}
            </>
          ) : null}
          {results.games.length ? (
            <>
              <div className="r-group">Games</div>
              {results.games.map((g) => (
                <div key={g.id} className="r-item" onClick={() => go("/admin/games")}>
                  <Ic name="gamepad" size={16} /> <span><strong>{g.title}</strong><span>{g.platform.toUpperCase()}</span></span>
                </div>
              ))}
            </>
          ) : null}
          {results.bookings.length ? (
            <>
              <div className="r-group">Recent bookings</div>
              {results.bookings.map((b) => (
                <div key={b.id} className="r-item" onClick={() => go("/admin/bookings")}>
                  <Ic name="calendar" size={16} /> <span><strong>{b.ref}</strong><span>{b.customer_name} · {b.status}</span></span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { logout } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [alerts, setAlerts] = useState(0);

  const title = useMemo(() => {
    const match = [...ADMIN_NAV].reverse().find((n) =>
      n.end ? location.pathname === n.to : location.pathname.startsWith(n.to));
    return match?.title ?? "Operational Command";
  }, [location.pathname]);

  useEffect(() => { setDrawer(false); }, [location.pathname]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      adminApi<{ stats: AdminStats }>("admin_stats")
        .then((r) => { if (alive) setAlerts(r.stats.incidents_open + r.stats.maintenance_open); })
        .catch(() => { /* badge is best-effort */ });
    };
    load();
    window.addEventListener(ALERT_EVENT, load);
    return () => { alive = false; window.removeEventListener(ALERT_EVENT, load); };
  }, []);

  return (
    <div className="adm-shell">
      {drawer ? <div className="adm-backdrop" onClick={() => setDrawer(false)} /> : null}
      <aside className={`adm-sidebar${drawer ? " open" : ""}`}>
        <div className="side-brand">
          <span className="mark"><GamepadMark /></span>
          <span><strong>PRIME GAMES</strong><em>OPS CONSOLE</em></span>
        </div>
        <nav className="side-nav" aria-label="Admin">
          <div className="adm-nav-group">Operations</div>
          {ADMIN_NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
            >
              <Ic name={n.icon} /> {n.label}
            </NavLink>
          ))}
          <div className="adm-nav-group">Site</div>
          <a className="nav-item" href="/"><Ic name="logout" /> View public site</a>
        </nav>
        <div className="side-user">
          <span className="avatar">PG</span>
          <span style={{ minWidth: 0 }}>
            <strong>Admin</strong>
            <em>SYSTEM ADMIN</em>
          </span>
        </div>
      </aside>

      <div className="adm-content">
        <header className="adm-topbar">
          <button className="adm-icon-btn adm-menu-btn" type="button" aria-label="Open menu" onClick={() => setDrawer(true)}>
            <Ic name="grid" size={18} />
          </button>
          <span className="title">{title}</span>
          <span className="spacer" />
          <GlobalSearch />
          <span className="adm-chip hq"><span className="dot" /> HQ · Oysterbay</span>
          <button
            className="adm-icon-btn"
            type="button"
            aria-label={`Alerts (${alerts})`}
            title="Open incidents & maintenance"
            onClick={() => navigate("/admin/payments")}
          >
            <Ic name="bell" size={18} />
            {alerts > 0 ? <span className="pip">{alerts > 99 ? "99+" : alerts}</span> : null}
          </button>
          <button
            className="adm-icon-btn"
            type="button"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => { logout(); navigate("/admin/login"); }}
          >
            <Ic name="logout" size={18} />
          </button>
        </header>
        <main className="adm-main">{children}</main>
      </div>

      <nav className="adm-tabbar" aria-label="Admin sections">
        {MOBILE_TABS.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => `tb${isActive ? " active" : ""}`}
          >
            <Ic name={n.icon} size={19} /> <span>{n.tab}</span>
          </NavLink>
        ))}
        <button type="button" className={`tb${drawer ? " active" : ""}`} onClick={() => setDrawer(true)}>
          <Ic name="dots" size={19} /> <span>More</span>
        </button>
      </nav>
    </div>
  );
}
