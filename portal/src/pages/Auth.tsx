import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { GamepadMark } from "../components/ui";

function Brand() {
  return (
    <div className="brand"><span className="mark"><GamepadMark /></span><span><strong style={{ fontFamily: "var(--font-display)" }}>PRIME GAMES</strong></span></div>
  );
}

function PasswordField({ label, value, onChange, autoComplete, placeholder, minLength }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field-control">
        <input
          type={show ? "text" : "password"}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
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

type LoginView = "signin" | "forgot" | "sent";

export function Login() {
  const { signIn, requestPasswordReset } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<LoginView>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState("");

  async function onSignIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await signIn(email.trim(), password);
    setBusy(false);
    if (err) setError(err);
    else navigate("/");
  }

  async function onForgot(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await requestPasswordReset(email.trim());
    setBusy(false);
    if (err) { setError(err); return; }
    setSentTo(email.trim());
    setView("sent");
  }

  function go(view: LoginView) {
    setView(view);
    setError(null);
  }

  if (view === "sent") {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <Brand />
          <h1>Check your email</h1>
          <p className="sub">If an account exists for <strong>{sentTo}</strong>, we sent a link to set a new password. The link expires in about an hour.</p>
          <button className="btn btn-primary btn-block" type="button" onClick={() => go("signin")}>Back to sign in</button>
          <p className="auth-alt">Didn't get it? Check spam, then try again in a few minutes.</p>
        </div>
      </div>
    );
  }

  if (view === "forgot") {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <Brand />
          <h1>Reset your password</h1>
          <p className="sub">Enter the email you use for Prime Games and we'll send you a link to set a new password.</p>
          <form onSubmit={onForgot} noValidate>
            <label className="field"><span>Email address</span>
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
          </form>
          <p className="auth-alt"><button type="button" className="link-button" onClick={() => go("signin")}>Back to sign in</button></p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Brand />
        <h1>Sign in to your account</h1>
        <p className="sub">Track rentals, pay balances and manage your membership.</p>
        <form onSubmit={onSignIn} noValidate>
          <label className="field"><span>Email address</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" placeholder="••••••••" />
          <p className="auth-alt-row" style={{ margin: "-6px 0 16px" }}>
            <span />
            <button type="button" className="link-button" onClick={() => go("forgot")}>Forgot password?</button>
          </p>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        <p className="auth-alt">New to Prime Games? <Link to="/register">Create an account</Link> · <a href="/">Book as guest</a></p>
      </div>
    </div>
  );
}

export function Register() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!/^(\+?255|0)[67]\d{8}$/.test(form.phone.replace(/[\s\-()]/g, ""))) {
      setError("Enter a valid Tanzanian number (e.g. 0712345678).");
      return;
    }
    setBusy(true);
    setError(null);
    const email = form.email.trim();
    const { error: err, needsConfirmation } = await signUp(form.name.trim(), email, form.phone.replace(/[\s\-()]/g, ""), form.password);
    setBusy(false);
    if (err) setError(err);
    else if (needsConfirmation) setSentTo(email);
    else navigate("/");
  }

  if (sentTo) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <Brand />
          <h1>Check your email</h1>
          <p className="sub">We sent a confirmation link to <strong>{sentTo}</strong>. Open it to activate your account, then sign in.</p>
          <button className="btn btn-primary btn-block" type="button" onClick={() => navigate("/login")}>Go to sign in</button>
          <p className="auth-alt">Didn't get it? Check spam, or <a href="/">book as a guest</a> in the meantime.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Brand />
        <h1>Create your account</h1>
        <p className="sub">Standard membership is free — faster bookings, rental history and loyalty points.</p>
        <form onSubmit={onSubmit} noValidate>
          <label className="field"><span>Full name</span>
            <input type="text" required autoComplete="name" value={form.name} onChange={set("name")} placeholder="e.g. Amina Juma" />
          </label>
          <label className="field"><span>Email address</span>
            <input type="email" required autoComplete="email" value={form.email} onChange={set("email")} placeholder="you@example.com" />
          </label>
          <label className="field"><span>Phone (M-Pesa &amp; WhatsApp)</span>
            <input type="tel" required inputMode="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} placeholder="07XX XXX XXX" />
          </label>
          <PasswordField label="Password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} autoComplete="new-password" placeholder="At least 6 characters" minLength={6} />
          {error ? <p className="form-error">{error}</p> : null}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
        </form>
        <p className="auth-alt">Already a member? <Link to="/login">Sign in</Link></p>
      </div>
    </div>
  );
}
