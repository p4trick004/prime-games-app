import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useCustomer } from "../lib/customer";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import { fmtTZS } from "../lib/format";
import { WHATSAPP_NUMBER } from "../config";
import { Badge, Ic } from "../components/ui";

const PREMIUM_BENEFITS = [
  ["Higher credit limit", "Rent now, pay later within your approved limit"],
  ["Free deliveries & discounts", "Occasional free delivery and member pricing"],
  ["Priority rental extension", "Keep the console longer — extensions confirmed first"],
  ["Prime Games premium card", "Physical gold member card"],
  ["Multiple active rentals", "More than one console out at a time"],
  ["Higher loyalty earnings", "Earn loyalty points faster on every rental"],
] as const;

const DOC_TYPES = ["nida", "licence", "passport", "selfie", "proof_of_address", "other"] as const;
const DOC_MIME = ["image/jpeg", "image/png", "application/pdf"];

export function Profile() {
  const { profile, session, signOut, updateProfile, refreshProfile, accessToken } = useAuth();
  const { customer, linkPending, refresh: refreshCustomer } = useCustomer();
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

  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]>("nida");
  const [docBusy, setDocBusy] = useState(false);
  const [docMsg, setDocMsg] = useState<string | null>(null);

  const [linkPhone, setLinkPhone] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMsg, setLinkMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true); setSaved(false); setSaveErr(null);
    const err = await updateProfile({ full_name: name.trim(), phone: phone.trim(), address: address.trim() });
    setBusy(false);
    if (err) setSaveErr(err);
    else { setSaved(true); void refreshCustomer(); }
  }

  // Masked-ID submission goes through the backend (kyc_submit), which stores
  // only the masked number and sets kyc_status=pending for admin review.
  async function submitKyc() {
    if (kycNumber.trim().length < 4) { setSaveErr("Enter your full ID number."); return; }
    setKycBusy(true); setSaveErr(null);
    try {
      const token = await accessToken();
      await api("kyc_submit", { method: "POST", token, body: { id_type: kycType, id_number: kycNumber.trim() } });
      setKycNumber("");
      await refreshProfile();
      const wa = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
        `Hello Prime Games! I'm ${name || profile?.full_name} — I've submitted my ${kycType.toUpperCase()} for KYC verification on my account.`,
      )}`;
      window.open(wa, "_blank", "noopener");
    } catch (e) {
      setSaveErr(e instanceof Error && e.message === "customer_not_found"
        ? "Your member record isn't ready yet — place a booking or try again in a moment."
        : "Could not submit your ID. Please try again.");
    } finally {
      setKycBusy(false);
    }
  }

  // Private document upload: signed URL into kyc-private/<customer_id>/…, then
  // kyc_register. Documents are never publicly readable; admins view via
  // short-lived audited signed URLs.
  async function uploadDoc(file: File | null) {
    if (!file) return;
    if (!DOC_MIME.includes(file.type)) { setDocMsg("Use a JPEG, PNG or PDF file."); return; }
    if (file.size > 10 * 1024 * 1024) { setDocMsg("File too large (max 10 MB)."); return; }
    setDocBusy(true); setDocMsg(null);
    try {
      const token = await accessToken();
      const up = await api<{ bucket: string; path: string; storage_path: string; token: string }>("kyc_upload_url", {
        method: "POST", token, body: { doc_type: docType, mime_type: file.type },
      });
      const { error } = await supabase.storage.from(up.bucket).uploadToSignedUrl(up.path, up.token, file);
      if (error) throw new Error("upload_failed");
      await api("kyc_register", {
        method: "POST", token,
        body: { storage_path: up.storage_path, doc_type: docType, mime_type: file.type, file_name: file.name, size_bytes: file.size },
      });
      await refreshProfile();
      setDocMsg("✓ Document uploaded privately — pending review.");
    } catch (e) {
      setDocMsg(e instanceof Error && e.message === "customer_not_found"
        ? "Your member record isn't ready yet — try again in a moment."
        : "Upload failed. Please try again.");
    } finally {
      setDocBusy(false);
    }
  }

  // Admin-assisted guest linking: request attaching an existing guest history
  // (by phone) to this account. Verification happens offline by the team.
  async function requestLink() {
    if (!/^(\+?255|0)[67]\d{8}$/.test(linkPhone.replace(/[\s\-()]/g, ""))) {
      setLinkMsg("Enter the Tanzanian number you used as a guest.");
      return;
    }
    setLinkBusy(true); setLinkMsg(null);
    try {
      const token = await accessToken();
      await api("link_guest", { method: "POST", token, body: { phone: linkPhone.replace(/[\s\-()]/g, "") } });
      setLinkPhone("");
      setLinkMsg("✓ Request sent — our team will verify and link your guest history.");
      await refreshCustomer();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setLinkMsg(
        msg === "guest_not_found" ? "No guest history found for that number."
        : msg === "already_linked" ? "This account already has a customer record."
        : "Could not send the request. Please try again.",
      );
    } finally {
      setLinkBusy(false);
    }
  }

  const premium = customer?.customer_tier === "premium" || (!customer && profile?.tier === "premium");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Profile {premium ? <Badge tone="gold">★ PREMIUM MEMBER</Badge> : <Badge tone="cyan">STANDARD</Badge>}</h1>
          <p>{session?.user.email}</p>
        </div>
        <button className="btn btn-ghost btn-sm" type="button" onClick={async () => { await signOut(); navigate("/login"); }}>
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
              No deposit — we verify a government ID instead. Only the last 4 digits are stored on your profile; documents stay private.
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
                <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                  <div className="field-row">
                    <label className="field">
                      <span>Document type</span>
                      <select value={docType} onChange={(e) => setDocType(e.target.value as (typeof DOC_TYPES)[number])}>
                        {DOC_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ").toUpperCase()}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Upload document (JPEG / PNG / PDF)</span>
                      <input type="file" accept={DOC_MIME.join(",")} disabled={docBusy} onChange={(e) => void uploadDoc(e.target.files?.[0] ?? null)} />
                    </label>
                  </div>
                  {docBusy ? <p style={{ color: "var(--dim)", fontSize: ".85rem", margin: 0 }}>Uploading privately…</p> : null}
                  {docMsg ? <p style={{ color: docMsg.startsWith("✓") ? "var(--green)" : "var(--gold)", fontSize: ".85rem", margin: 0 }}>{docMsg}</p> : null}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h3>Link guest history</h3>
            <p style={{ color: "var(--dim)", fontSize: ".88rem" }}>
              Booked as a guest before? Enter that phone number and our team will verify and attach your history to this account.
            </p>
            {linkPending ? (
              <p style={{ color: "var(--gold)", fontSize: ".85rem", margin: "8px 0 0" }}>A link request is pending verification.</p>
            ) : customer ? (
              <p style={{ color: "var(--green)", fontSize: ".85rem", margin: "8px 0 0" }}>Your customer record is active — guest bookings under your phone attach automatically.</p>
            ) : (
              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <input style={{ flex: 1, minWidth: 180 }} value={linkPhone} onChange={(e) => setLinkPhone(e.target.value)} placeholder="07XX XXX XXX" inputMode="tel" />
                <button className="btn btn-primary btn-sm" type="button" disabled={linkBusy} onClick={() => void requestLink()}>{linkBusy ? "Sending…" : "Request link"}</button>
              </div>
            )}
            {linkMsg ? <p style={{ color: linkMsg.startsWith("✓") ? "var(--green)" : "var(--gold)", fontSize: ".85rem", margin: "8px 0 0" }}>{linkMsg}</p> : null}
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
            {premium && customer ? (
              <p style={{ color: "var(--dim)", fontSize: ".85rem", marginTop: 10 }}>
                Approved credit limit: <span className="mono gold">{fmtTZS(customer.credit_limit)}</span>
              </p>
            ) : null}
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