import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { GamepadMark } from "../components/ui";

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await signIn(email.trim(), password);
    setBusy(false);
    if (err) setError(err);
    else navigate("/");
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand"><span className="mark"><GamepadMark /></span><span><strong style={{ fontFamily: "var(--font-display)" }}>PRIME GAMES</strong></span></div>
        <h1>Sign in to your account</h1>
        <p className="sub">Track rentals, pay balances and manage your membership.</p>
        <form onSubmit={onSubmit} noValidate>
          <label className="field"><span>Email address</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label className="field"><span>Password</span>
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </label>
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
          <div className="brand"><span className="mark"><GamepadMark /></span><span><strong style={{ fontFamily: "var(--font-display)" }}>PRIME GAMES</strong></span></div>
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
        <div className="brand"><span className="mark"><GamepadMark /></span><span><strong style={{ fontFamily: "var(--font-display)" }}>PRIME GAMES</strong></span></div>
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
          <label className="field"><span>Password</span>
            <input type="password" required minLength={6} autoComplete="new-password" value={form.password} onChange={set("password")} placeholder="At least 6 characters" />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
        </form>
        <p className="auth-alt">Already a member? <Link to="/login">Sign in</Link></p>
      </div>
    </div>
  );
}
