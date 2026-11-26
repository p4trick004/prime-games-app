import { useState } from "react";
import type { FormEvent } from "react";
import qrcode from "qrcode-generator";
import { adminTotpSetup, adminTotpStatus, adminTotpVerify } from "../../lib/adminApi";
import type { AdminTotpSetup } from "../../lib/adminApi";
import { fmtDay } from "../../lib/adminLabels";
import { Badge, Ic } from "../../components/ui";
import { useAsync, useToast } from "../../components/admin/AdminUi";

// Rendered locally (no third-party QR service, so the secret never leaves the
// page or the server).
function qrSvg(uri: string): string {
  const qr = qrcode(0, "M");
  qr.addData(uri);
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 2 });
}

const groupKey = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

export function AdminSecurity() {
  const toast = useToast();
  const status = useAsync(() => adminTotpStatus(), []);
  const [setup, setSetup] = useState<AdminTotpSetup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);

  async function beginSetup() {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      setSetup(await adminTotpSetup());
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "setup_failed");
    } finally {
      setStarting(false);
    }
  }

  function cancelSetup() {
    setSetup(null);
    setCode("");
    setError(null);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!setup || busy || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await adminTotpVerify(code);
      toast("Authenticator connected — password recovery is now enabled.");
      setSetup(null);
      setCode("");
      status.reload();
    } catch (err) {
      const text = err instanceof Error ? err.message : "";
      if (text === "invalid_code") setError("That code didn't match. Check the code in your app and try again.");
      else if (text === "rate_limited") setError("Too many attempts. Wait a few minutes and try again.");
      else if (text === "setup_required") setError("This setup expired. Start the setup again.");
      else setError("Could not verify the code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyKey() {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      toast("Secret key copied.");
    } catch {
      toast("Copy failed — select the key manually.", "err");
    }
  }

  const active = status.data?.active ?? false;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Security</h1>
          <p>Authenticator-backed password recovery for the operations console.</p>
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <div className="adm-section sec-head">
            <div>
              <h2><Ic name="shield" size={16} /> Authenticator app</h2>
              <span className="hint">
                {active
                  ? `Connected${status.data?.activated_at ? ` on ${fmtDay(status.data.activated_at)}` : ""}. “Forgot password?” accepts codes from this app.`
                  : "Not set up. “Forgot password?” stays disabled until an authenticator app is connected."}
              </span>
            </div>
            {status.loading
              ? <Badge tone="gray">CHECKING…</Badge>
              : <Badge tone={active ? "green" : "gold"}>{active ? "ACTIVE" : "NOT SET UP"}</Badge>}
          </div>

          {status.error ? <p className="form-error">{status.error}</p> : null}

          {!setup ? (
            <button className="btn btn-primary btn-sm" type="button" onClick={beginSetup} disabled={starting || status.loading}>
              {starting ? "Preparing…" : active ? "Replace authenticator" : "Set up authenticator"}
            </button>
          ) : (
            <div className="totp-setup">
              <ol className="totp-steps">
                <li>Open Google Authenticator, Authy or 1Password and scan this code.</li>
                <li>If you can’t scan, enter the secret key below manually.</li>
                <li>Enter the current 6-digit code to finish — nothing changes until it verifies.</li>
              </ol>

              <div className="totp-qr" dangerouslySetInnerHTML={{ __html: qrSvg(setup.otpauth_uri) }} />

              <div className="totp-key">
                <span>Secret key ({setup.issuer}: {setup.account})</span>
                <code>{groupKey(setup.secret)}</code>
                <button className="link-button" type="button" onClick={copyKey}>Copy key</button>
              </div>

              <form onSubmit={verify}>
                <label className="field">
                  <span>6-digit code from the app</span>
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
                  />
                </label>
                {error ? <p className="form-error">{error}</p> : null}
                <div className="totp-actions">
                  <button className="btn btn-ghost btn-sm" type="button" onClick={cancelSetup} disabled={busy}>Cancel</button>
                  <button className="btn btn-primary btn-sm" type="submit" disabled={busy || code.length !== 6}>
                    {busy ? "Verifying…" : "Verify & activate"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {!setup && error ? <p className="form-error">{error}</p> : null}
        </div>

        <div className="card">
          <div className="adm-section" style={{ margin: "0 0 12px" }}>
            <div><h2>How recovery works</h2><span className="hint">Server-side only</span></div>
          </div>
          <ul className="sec-notes">
            <li>The secret is stored on the server and is never sent back to the browser after setup.</li>
            <li>Recovery is refused until enrollment is verified, and only codes from the connected app are accepted.</li>
            <li>Replacing the authenticator invalidates the old app’s codes as soon as the new one verifies.</li>
            <li>Recovery codes are throttled per IP, and every successful recovery issues the same 12-hour admin session as a password login.</li>
            <li>If both the password and the authenticator are lost, rotate <code>ADMIN_PASSWORD</code> in Supabase secrets.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
