import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAdminAuth } from "../../lib/adminAuth";
import { GamepadMark } from "../../components/ui";

export function AdminLogin() {
  const { authenticated, login } = useAdminAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (authenticated) return <Navigate to="/admin" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(err instanceof Error && err.message === "invalid_credentials"
        ? "Incorrect admin password."
        : "Could not reach the server. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="brand">
          <span className="mark"><GamepadMark /></span>
          <span><strong style={{ fontFamily: "var(--font-display)" }}>PRIME GAMES</strong><br />
            <em style={{ font: "700 9px var(--font-mono)", fontStyle: "normal", color: "var(--gold)", letterSpacing: ".22em" }}>OPS CONSOLE</em></span>
        </div>
        <h1>Admin sign in</h1>
        <p className="sub">Restricted area. Enter the operations password to continue.</p>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy || password.length === 0}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="auth-alt"><a href="/">← Back to site</a></p>
      </form>
    </div>
  );
}
