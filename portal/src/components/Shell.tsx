import { NavLink, useNavigate } from "react-router-dom";
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
  const initials = (profile?.full_name ?? "PG").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const premium = profile?.tier === "premium";

  // Leaving for the public site ends the session so returning to the portal
  // asks for credentials again.
  function leavePortal(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    signOut().finally(() => window.location.assign("/"));
  }

  async function logout() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="side-brand">
          <span className="mark"><GamepadMark /></span>
          <span><strong>PRIME GAMES</strong><em>DAR ES SALAAM</em></span>
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
        <span className="brand"><span className="mark"><GamepadMark size={17} /></span><strong>PRIME</strong></span>
        {premium ? <span className="badge gold">GOLD</span> : null}
      </header>

      <main className="main">{children}</main>

      <nav className="mobile-nav" aria-label="Portal">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => `mnav-item${isActive ? " active" : ""}`}
          >
            <Ic name={n.icon} /> <span>{n.label}</span>
          </NavLink>
        ))}
        <a className="mnav-item" href="/" onClick={leavePortal}>
          <Ic name="gamepad" /> <span>Back to Site</span>
        </a>
        <button className="mnav-item" type="button" onClick={() => void logout()}>
          <Ic name="logout" /> <span>Logout</span>
        </button>
      </nav>
    </div>
  );
}
