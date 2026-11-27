import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import type { MouseEvent, ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { GamepadMark, Ic } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: "grid", end: true },
  { to: "/profile", label: "Profile", icon: "user", end: false },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const initials = (profile?.full_name ?? "PG").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const premium = profile?.tier === "premium";

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Leaving for the public site ends the session so returning to the portal
  // asks for credentials again.
  function leavePortal(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    setOpen(false);
    signOut().finally(() => window.location.assign("/"));
  }

  async function logout() {
    setOpen(false);
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="shell">
      {open ? <div className="side-backdrop" onClick={() => setOpen(false)} aria-hidden="true" /> : null}

      <aside id="portal-nav" className={`sidebar${open ? " open" : ""}`}>
        <div className="side-brand">
          <span className="mark"><GamepadMark /></span>
          <span><strong>PRIME GAMES</strong><em>DAR ES SALAAM</em></span>
          <button className="menu-btn side-close" type="button" aria-label="Close menu" onClick={() => setOpen(false)}>
            <Ic name="close" size={18} />
          </button>
        </div>
        <nav className="side-nav" aria-label="Portal">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
              <Ic name={n.icon} /> {n.label}
            </NavLink>
          ))}
          <a className="nav-item" href="/" onClick={leavePortal}>
            <Ic name="gamepad" /> Back to Site
          </a>
          <button className="nav-item" type="button" onClick={() => void logout()}>
            <Ic name="logout" /> Logout
          </button>
        </nav>
        <div className="side-user">
          <span className="avatar">{initials}{premium ? <span className="p-dot">P</span> : null}</span>
          <span style={{ minWidth: 0 }}>
            <strong>{profile?.full_name ?? "Member"}</strong>
            <em>{premium ? "PREMIUM MEMBER" : "STANDARD MEMBER"}</em>
          </span>
        </div>
      </aside>

      <header className="topbar">
        <button
          className="menu-btn"
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="portal-nav"
          onClick={() => setOpen((v) => !v)}
        >
          <Ic name={open ? "close" : "menu"} size={20} />
        </button>
        <span className="brand"><span className="mark"><GamepadMark size={17} /></span><strong>PRIME</strong></span>
        {premium ? <span className="badge gold">GOLD</span> : null}
      </header>

      <main className="main">{children}</main>
    </div>
  );
}
