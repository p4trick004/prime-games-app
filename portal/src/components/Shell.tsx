import { NavLink, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { GamepadMark, Ic } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: "grid", end: true },
  { to: "/browse", label: "Browse PS5s", icon: "search" },
  { to: "/bookings", label: "My Bookings", icon: "calendar" },
  { to: "/rentals", label: "My Rentals", icon: "box" },
  { to: "/payments", label: "Payments", icon: "card" },
  { to: "/profile", label: "Profile", icon: "user" },
] as const;

const TABS = [
  { to: "/", label: "Home", icon: "grid", end: true },
  { to: "/browse", label: "Browse", icon: "search" },
  { to: "/bookings", label: "Bookings", icon: "calendar" },
  { to: "/rentals", label: "History", icon: "history" },
  { to: "/profile", label: "Profile", icon: "user" },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const initials = (profile?.full_name ?? "PG").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="side-brand">
          <span className="mark"><GamepadMark /></span>
          <span><strong>PRIME GAMES</strong><em>DAR ES SALAAM</em></span>
        </div>
        <nav className="side-nav" aria-label="Portal">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={"end" in n ? n.end : false} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
              <Ic name={n.icon} /> {n.label}
            </NavLink>
          ))}
          <a className="nav-item" href="/" >
            <Ic name="logout" /> Back to site
          </a>
        </nav>
        <div className="side-user">
          <span className="avatar">{initials}{profile?.tier === "premium" ? <span className="p-dot">P</span> : null}</span>
          <span style={{ minWidth: 0 }}>
            <strong>{profile?.full_name ?? "Member"}</strong>
            <em>{profile?.tier === "premium" ? "PREMIUM MEMBER" : "STANDARD MEMBER"}</em>
          </span>
        </div>
      </aside>

      <header className="topbar">
        <span className="brand"><span className="mark"><GamepadMark size={17} /></span><strong>PRIME</strong></span>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {profile?.tier === "premium" ? <span className="badge gold">GOLD</span> : null}
          <button className="btn btn-ghost btn-sm" type="button" onClick={async () => { await signOut(); navigate("/login"); }}>
            <Ic name="logout" size={14} /> Exit
          </button>
        </span>
      </header>

      <main className="main">{children}</main>

      <nav className="tabbar" aria-label="Portal tabs">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={"end" in t ? t.end : false} className={({ isActive }) => (isActive ? "active" : "")}>
            <Ic name={t.icon} size={19} /> {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
