import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAdminAuth } from "../../lib/adminAuth";
import { GamepadMark } from "../../components/ui";

type Mode = "password" | "recovery";

export function AdminLogin() {
  const { authenticated, login, recover } = useAdminAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("password");
  const [password, setPassword] = useState("");
  const [revealPassword, setRevealPassword] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (authenticated) return <Navigate to="/admin" replace />;

  function errorMessage(err: unknown): string {
    const text = err instanceof Error ? err.message : "";
    if (text === "rate_limited") return "Too many attempts. Wait a few minutes and try again.";
    if (mode === "password") {
      if (text === "invalid_credentials") return "Incorrect admin password.";
      return "Could not reach the server. Try again.";
    }
    if (text === "invalid_code") return "That code didn't match. Check the code in your authenticator app.";
    if (text === "recovery_not_configured") return "Recovery isn't configured on this server yet.";
    return "Could not reach the server. Try again.";
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setBusy(false);
    setPassword("");
    setCode("");
    setRevealPassword(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "password") await login(password);
      else await recover(code);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const disabled = busy || (mode === "password" ? password.length === 0 : code.length !== 6);

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="brand">
          <span className="mark"><GamepadMark /></span>
          <span><strong style={{ fontFamily: "var(--font-display)" }}>PRIME GAMES</strong><br />
            <em style={{ font: "700 9px var(--font-mono)", fontStyle: "normal", color: "var(--gold)", letterSpacing: ".22em" }}>OPS CONSOLE</em></span>
        </div>
        {mode === "password" ? (
          <>
            <h1>Admin sign in</h1>
            <p className="sub">Restricted area. Enter the operations password to continue.</p>
            <label className="field">
              <span>Password</span>
              <span className="field-control">
                <input
                  type={revealPassword ? "text" : "password"}
                  value={password}
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  className="field-reveal"
                  onClick={() => setRevealPassword((v) => !v)}
                  aria-label={revealPassword ? "Hide password" : "Show password"}
                  aria-pressed={revealPassword}
                >
                  {revealPassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>
          </>
        ) : (
          <>
            <h1>Recover access</h1>
            <p className="sub">Enter the 6-digit code from your authenticator app (Google Authenticator, Authy, 1Password).</p>
            <label className="field">
              <span>Authenticator code</span>
              <input
                className="otp-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                autoFocus
                required
              />
            </label>
          </>
        )}
        {error ? <p className="form-error">{error}</p> : null}
        <button className="btn btn-primary btn-block" type="submit" disabled={disabled}>
          {busy ? (mode === "password" ? "Signing in…" : "Verifying…") : (mode === "password" ? "Sign in" : "Verify code")}
        </button>
        <div className="auth-alt auth-alt-row">
          <button
            type="button"
            className="link-button"
            onClick={() => switchMode(mode === "password" ? "recovery" : "password")}
          >
            {mode === "password" ? "Forgot password?" : "Use password instead"}
          </button>
          <a href="/">← Back to site</a>
        </div>
      </form>
    </div>
  );
}