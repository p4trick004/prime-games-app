import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { fmtTZS } from "../lib/format";
import { WHATSAPP_NUMBER } from "../config";
import { Badge, Ic } from "../components/ui";

const PREMIUM_BENEFITS = [
  ["Higher credit limit", `Rent now, pay later up to ${fmtTZS(200000)}`],
  ["Free deliveries & discounts", "Occasional free delivery and member pricing"],
  ["Priority rental extension", "Keep the console longer — extensions confirmed first"],
  ["Prime Games premium card", "Physical gold member card"],
  ["Multiple active rentals", "More than one console out at a time"],
  ["Higher loyalty earnings", "Earn loyalty points faster on every rental"],
] as const;

export function Profile() {
  const { profile, session, signOut, updateProfile } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [address, setAddress] = useState(profile?.address ?? "");
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [kycType, setKycType] = useState(profile?.kyc_id_type ?? "nida");
  const [kycNumber, setKycNumber] = useState("");
  const [kycBusy, setKycBusy] = useState(false);

  async function save() {
    setBusy(true); setSaved(false); setSaveErr(null);
    const err = await updateProfile({ full_name: name.trim(), phone: phone.trim(), address: address.trim() });
    setBusy(false);
    if (err) setSaveErr(err);
    else setSaved(true);
  }

  async function submitKyc() {
    if (kycNumber.trim().length < 4) { setSaveErr("Enter your full ID number."); return; }
    setKycBusy(true);
    const masked = `••••${kycNumber.trim().slice(-4)}`;
    const err = await updateProfile({ kyc_status: "pending", kyc_id_type: kycType, kyc_id_masked: masked });
    setKycBusy(false);
    if (err) { setSaveErr(err); return; }
    const wa = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
      `Hello Prime Games! I'm ${name || profile?.full_name} — I've submitted my ${kycType.toUpperCase()} (ending ${masked.slice(-4)}) for KYC verification on my account.`,
    )}`;
    window.open(wa, "_blank", "noopener");
  }

  const premium = profile?.tier === "premium";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Profile {premium ? <Badge tone="gold">★ PREMIUM MEMBER</Badge> : <Badge tone="cyan">STANDARD</Badge>}</h1>
          <p>{session?.user.email}</p>
        </div>
        <button className="btn btn-ghost btn-sm" type="button" onClick={async () => { await signOut(); navigate("/app/login"); }}>
          <Ic name="logout" size={14} /> Sign out
        </button>
      </div>

      {!premium ? (
        <div className="banner gold">
          <span className="ico">★</span>
          <p className="grow">
            <strong>Upgrade to Premium.</strong> Higher credit limit, free deliveries, priority extensions, the gold Prime Games card and faster loyalty points.
          </p>
          <a className="btn btn-gold btn-sm" href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hello Prime Games! I'd like to upgrade my account to PREMIUM membership.")}`} target="_blank" rel="noopener">Upgrade</a>
        </div>
      ) : null}

      <div className="grid two">
        <div className="grid" style={{ gap: 16 }}>
          <div className="card">
            <h3>Personal information</h3>
            <div style={{ marginTop: 14 }}>
              <label className="field"><span>Full name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
              <div className="field-row">
                <label className="field"><span>Phone (WhatsApp)</span><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></label>
                <label className="field"><span>Email</span><input value={session?.user.email ?? ""} disabled /></label>
              </div>
              <label className="field"><span>Default delivery address</span><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Zone + street / landmark" /></label>
              {saveErr ? <p className="form-error" role="alert">{saveErr}</p> : null}
              {saved ? <p style={{ color: "var(--green)", fontSize: ".85rem", margin: "0 0 10px" }}>✓ Saved.</p> : null}
              <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</button>
            </div>
          </div>

          <div className="card">
            <h3 style={{ display: "flex", gap: 10, alignItems: "center" }}>
              KYC verification{" "}
              {profile?.kyc_status === "verified" ? <Badge tone="green">VERIFIED</Badge>
                : profile?.kyc_status === "pending" ? <Badge tone="gold">PENDING REVIEW</Badge>
                : <Badge tone="gray">NOT SUBMITTED</Badge>}
            </h3>
            <p style={{ color: "var(--dim)", fontSize: ".88rem" }}>
              No deposit — we verify a government ID instead. Verified members get faster approvals.
            </p>
            {profile?.kyc_status === "verified" ? (
              <p style={{ fontSize: ".9rem", margin: 0 }}>
                {profile.kyc_id_type?.toUpperCase()} on file · <span className="mono">{profile.kyc_id_masked}</span>
              </p>
            ) : (
              <div style={{ marginTop: 12 }}>
                <div className="field-row">
                  <label className="field">
                    <span>ID type</span>
                    <select value={kycType} onChange={(e) => setKycType(e.target.value)} disabled={profile?.kyc_status === "pending"}>
                      <option value="nida">NIDA ID</option>
                      <option value="licence">Driver's licence</option>
                      <option value="passport">Passport</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>ID number</span>
                    <input value={profile?.kyc_status === "pending" ? (profile.kyc_id_masked ?? "") : kycNumber} onChange={(e) => setKycNumber(e.target.value)} disabled={profile?.kyc_status === "pending"} />
                  </label>
                </div>
                {profile?.kyc_status === "pending" ? (
                  <p style={{ color: "var(--gold)", fontSize: ".85rem", margin: 0 }}>We're reviewing your ID — we'll confirm on WhatsApp within a day.</p>
                ) : (
                  <button className="btn btn-primary btn-sm" type="button" disabled={kycBusy} onClick={() => void submitKyc()}>
                    {kycBusy ? "Submitting…" : "Submit for verification"}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Notifications</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={profile?.sms_confirmations ?? false}
                  onChange={(e) => void updateProfile({ sms_confirmations: e.target.checked })}
                />
                <span className="track" />
              </label>
              <span style={{ fontSize: ".9rem" }}>SMS / WhatsApp confirmations for booking updates</span>
            </div>
          </div>
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <div className="card" style={premium ? { borderColor: "rgba(245,166,35,.55)" } : undefined}>
            <h3>{premium ? "Your premium benefits" : "Premium benefits"}</h3>
            <ul className="benefit-list" style={{ marginTop: 10 }}>
              {PREMIUM_BENEFITS.map(([title, desc]) => (
                <li key={title}><span><strong style={{ color: "var(--text)", fontFamily: "var(--font-body)" }}>{title}</strong><br />{desc}</span></li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h3>Loyalty points</h3>
            <div className="mono gold" style={{ fontSize: "1.8rem", fontWeight: 700, marginTop: 8 }}>{profile?.loyalty_points ?? 0}</div>
            <p style={{ color: "var(--dim)", fontSize: ".85rem", margin: "6px 0 0" }}>
              Earn points on every completed rental{premium ? " — premium members earn faster" : " — upgrade to premium to earn faster"}.
            </p>
          </div>

          <div className="card" style={{ borderColor: "rgba(240,86,74,.4)" }}>
            <h3 style={{ color: "var(--red)" }}>Danger zone</h3>
            <p style={{ color: "var(--dim)", fontSize: ".86rem" }}>
              Want to delete your account and personal data? Message us and we'll handle it within 48 hours.
            </p>
            <a className="btn btn-ghost btn-sm" href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hello Prime Games! I'd like to request deletion of my account and personal data.")}`} target="_blank" rel="noopener">
              Request account deletion
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
