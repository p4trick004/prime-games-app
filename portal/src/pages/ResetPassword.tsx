import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { GamepadMark } from "../components/ui";

type Phase = "loading" | "form" | "done" | "invalid";

function PasswordField({ label, value, onChange, autoComplete }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field-control">
        <input
          type={show ? "text" : "password"}
          required
          minLength={6}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="At least 6 characters"
        />
        <button
          type="button"
          className="field-reveal"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
        >
          {show ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );
}

export function ResetPassword() {
  const { adoptRecovery, completePasswordReset } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const errorParam = params.get("error");
  const [phase, setPhase] = useState<Phase>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (errorParam) { setPhase("invalid"); return; }
    if (started.current) return;
    started.current = true;
    adoptRecovery().then((ok) => setPhase(ok ? "form" : "invalid"));
  }, [adoptRecovery, errorParam]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) { setError("Use at least 6 characters."); return; }
    if (password !== confirm) { setError("The passwords don't match."); return; }
    setBusy(true);
    setError(null);
    const err = await completePasswordReset(password);
    setBusy(false);
    if (err) setError(err);
    else setPhase("done");
  }

  const invalidText =
    errorParam === "storage" ? "Your browser blocked the reset link. Open the email link in a normal (not private) window."
      : "This reset link is invalid or has expired. Request a new one from the sign-in screen.";

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand"><span className="mark"><GamepadMark /></span><span><strong style={{ fontFamily: "var(--font-display)" }}>PRIME GAMES</strong></span></div>
        {phase === "loading" ? (
          <>
            <h1>Set a new password</h1>
            <p className="sub">Opening your reset link…</p>
            <div className="spinner" />
          </>
        ) : phase === "invalid" ? (
          <>
            <h1>Link not valid</h1>
            <p className="sub">{invalidText}</p>
            <button className="btn btn-primary btn-block" type="button" onClick={() => navigate("/login")}>Go to sign in</button>
          </>
        ) : phase === "done" ? (
          <>
            <h1>Password updated</h1>
            <p className="sub">Your new password is active. Sign in to continue to your account.</p>
            <button className="btn btn-primary btn-block" type="button" onClick={() => navigate("/login")}>Sign in</button>
          </>
        ) : (
          <>
            <h1>Set a new password</h1>
            <p className="sub">Choose a new password for your Prime Games account.</p>
            <form onSubmit={onSubmit} noValidate>
              <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password" />
              <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
              {error ? <p className="form-error">{error}</p> : null}
              <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
            </form>
            <p className="auth-alt"><button type="button" className="link-button" onClick={() => navigate("/login")}>Back to sign in</button></p>
          </>
        )}
      </div>
    </div>
  );
}
