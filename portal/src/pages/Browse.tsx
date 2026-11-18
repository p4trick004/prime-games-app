import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import {
  RATES, ZONES, PACKAGE_META, GAME_LIBRARY, STARTER_PRESET,
  priceBooking, type PackageKey,
} from "../lib/pricing";
import { fmtTZS, fmtDate, fmtTime, addDays, eatToday } from "../lib/format";
import { Badge, Ic } from "../components/ui";

const PHONE_RE = /^(\+?255|0)[67]\d{8}$/;
const cleanPhone = (v: string) => v.replace(/[\s\-()]/g, "");
const DAY_CHIPS = [1, 2, 3, 4, 5, 7];
const STEPS = ["Choose plan", "Schedule & delivery", "Games", "Review & confirm"];

function StepBar({ step }: { step: number }) {
  return (
    <div className="steps" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
      {STEPS.map((label, i) => (
        <span key={label} style={{ display: "contents" }}>
          {i > 0 ? <span className="step-line" /> : null}
          <span className={`step${i === step ? " current" : i < step ? " done" : ""}`}>
            <span className="dot">{i < step ? "✓" : i + 1}</span> {label}
          </span>
        </span>
      ))}
    </div>
  );
}

function PlanStep({ pkg, setPkg }: { pkg: PackageKey | null; setPkg: (p: PackageKey) => void }) {
  return (
    <div className="plan-grid">
      {(Object.keys(RATES) as PackageKey[]).map((key) => {
        const meta = PACKAGE_META[key];
        return (
          <button
            key={key}
            type="button"
            className={`plan-card${pkg === key ? " selected" : ""}`}
            onClick={() => setPkg(key)}
            aria-pressed={pkg === key}
          >
            {key === "weekend" ? <span className="pop"><Badge tone="gold">POPULAR</Badge></span> : null}
            <h4>{meta.name}</h4>
            <div className="price">{fmtTZS(RATES[key])} <small>{meta.per}</small></div>
            <p style={{ color: "var(--dim)", fontSize: ".85rem", margin: 0 }}>{meta.blurb}</p>
            <ul>{meta.features.map((f) => <li key={f}>{f}</li>)}</ul>
          </button>
        );
      })}
    </div>
  );
}

function GamesStep({ pkg, games, toggle }: { pkg: PackageKey; games: string[]; toggle: (id: string) => void }) {
  if (pkg === "starter") {
    const preset = GAME_LIBRARY.filter((g) => STARTER_PRESET.includes(g.id));
    return (
      <>
        <p style={{ color: "var(--dim)", fontSize: ".9rem" }}>The Starter Package comes with 5 popular games pre-installed — no selection needed.</p>
        <div className="game-grid">
          {preset.map((g) => (
            <div className="game-card selected" key={g.id}>
              {g.cover
                ? <img className="cover" src={g.cover} alt="" loading="lazy" />
                : <span className="cover missing"><Ic name="gamepad" /></span>}
              <span><strong>{g.title}</strong><em>INCLUDED</em></span>
            </div>
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      <p style={{ color: "var(--dim)", fontSize: ".9rem" }}>
        Pick up to 5 games — <span className="mono cyan">{games.length}/5</span> selected. We install them before delivery.
      </p>
      <div className="game-grid">
        {GAME_LIBRARY.map((g) => {
          const on = games.includes(g.id);
          return (
            <button type="button" key={g.id} className={`game-card${on ? " selected" : ""}`} onClick={() => toggle(g.id)} aria-pressed={on}>
              {g.cover
                ? <img className="cover" src={g.cover} alt="" loading="lazy" />
                : <span className="cover missing"><Ic name="gamepad" /></span>}
              <span><strong>{g.title}</strong><em>{g.tag.toUpperCase()}</em></span>
              <span className="plus">{on ? "✓" : "+"}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

interface Success {
  ref: string;
  total: number;
}

export function Browse() {
  const { profile, accessToken } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [pkg, setPkgState] = useState<PackageKey | null>(null);
  const [days, setDays] = useState(2);
  const [startDate, setStartDate] = useState(eatToday());
  const [startTime, setStartTime] = useState("10:00");
  const [zone, setZone] = useState("goba");
  const [address, setAddress] = useState(profile?.address ?? "");
  const [games, setGames] = useState<string[]>([]);

  const [name, setName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [idType, setIdType] = useState(profile?.kyc_id_type ?? "nida");
  const [idNumber, setIdNumber] = useState("");
  const [ecName, setEcName] = useState("");
  const [ecPhone, setEcPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"mpesa" | "cod">("mpesa");
  const [agreed, setAgreed] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<Success | null>(null);

  const setPkg = (p: PackageKey) => {
    setPkgState(p);
    if (p === "weekend") { setDays(1); setStartTime("10:00"); }
    else if (p === "night") { setDays(1); setStartTime("20:00"); }
  };

  const toggleGame = (id: string) => {
    setGames((g) => (g.includes(id) ? g.filter((x) => x !== id) : g.length >= 5 ? g : [...g, id]));
  };

  const price = useMemo(
    () => (pkg ? priceBooking(pkg, days, zone) : null),
    [pkg, days, zone],
  );
  const endDate = pkg ? addDays(startDate, days) : startDate;

  if (success) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Booking received 🎮</h1>
            <p>Your reference is <span className="mono cyan">{success.ref}</span>. Keep it for any questions.</p>
          </div>
        </div>
        <div className="card" style={{ maxWidth: 560, borderColor: "rgba(47,213,117,.5)" }}>
          <Badge tone="green">PENDING APPROVAL</Badge>
          <h3 style={{ margin: "14px 0 6px" }}>Your booking is in our system</h3>
          <p style={{ color: "var(--dim)", fontSize: ".9rem" }}>
            We've received your booking and will review and confirm it within 30 minutes (8:00–22:00 EAT). No further action is needed — track its status under My bookings.
          </p>
          <div className="kv"><dt>Total to pay</dt><dd className="mono gold">{fmtTZS(success.total)}</dd></div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <button className="btn btn-primary" type="button" onClick={() => navigate("/bookings")}>View my bookings</button>
          </div>
        </div>
      </>
    );
  }

  const canNext =
    (step === 0 && pkg !== null) ||
    (step === 1 && !!pkg && startDate >= eatToday() && address.trim().length >= 3) ||
    (step === 2 && !!pkg && (pkg === "starter" || games.length > 0)) ||
    step === 3;

  async function submit() {
    if (!pkg || !price) return;
    setError(null);
    if (!PHONE_RE.test(cleanPhone(phone))) { setError("Enter a valid Tanzanian phone number (e.g. 0613138426)."); return; }
    if (!PHONE_RE.test(cleanPhone(ecPhone))) { setError("Enter a valid emergency contact phone number."); return; }
    if (idNumber.trim().length < 4) { setError("Enter your full ID number — we verify it before delivery."); return; }
    if (name.trim().length < 2) { setError("Enter your full name."); return; }
    if (ecName.trim().length < 2) { setError("Enter an emergency contact name."); return; }
    if (!agreed) { setError("Please accept the rental rules to continue."); return; }

    setBusy(true);
    try {
      const token = await accessToken();
      const gameTitles = pkg === "starter"
        ? STARTER_PRESET.map((id) => GAME_LIBRARY.find((g) => g.id === id)?.title ?? id)
        : games.map((id) => GAME_LIBRARY.find((g) => g.id === id)?.title ?? id);
      const res = await api<{ booking: { ref: string; total: number } }>("create_booking", {
        method: "POST",
        token,
        body: {
          package: pkg,
          zone,
          days,
          name: name.trim(),
          phone: cleanPhone(phone),
          address: address.trim(),
          start_date: startDate,
          start_time: startTime,
          id_type: idType,
          id_number: idNumber.trim(),
          ec_name: ecName.trim(),
          ec_phone: cleanPhone(ecPhone),
          payment_method: paymentMethod,
          notes: `Games: ${gameTitles.join("; ")}`.slice(0, 400),
        },
      });
      setSuccess({ ref: res.booking.ref, total: res.booking.total });
    } catch (e) {
      setError(e instanceof Error && e.message === "invalid_input"
        ? "Some details look off — check the highlighted fields and try again."
        : "We couldn't send your booking. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Browse PS5s</h1>
          <p>Pick a plan, choose your schedule and games — pricing is calculated live, same as our landing page.</p>
        </div>
      </div>

      <StepBar step={step} />

      {step === 0 ? <PlanStep pkg={pkg} setPkg={setPkg} /> : null}

      {step === 1 && pkg ? (
        <div className="grid two">
          <div className="card">
            <h3>Schedule</h3>
            {pkg === "weekend" ? (
              <p style={{ color: "var(--dim)", fontSize: ".9rem" }}>
                The Weekend Package runs Friday → Sunday at a fixed {fmtTZS(RATES.weekend)} with free delivery and pickup.
              </p>
            ) : pkg === "night" ? (
              <label className="field">
                <span>Nights</span>
                <input type="number" min={1} max={7} value={days} onChange={(e) => setDays(Math.min(7, Math.max(1, Number(e.target.value) || 1)))} />
              </label>
            ) : (
              <>
                <div className="field"><span>Days</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {DAY_CHIPS.map((d) => (
                      <button key={d} type="button" className={`btn btn-sm ${days === d ? "btn-primary" : "btn-ghost"}`} onClick={() => setDays(d)}>
                        {d} {d === 1 ? "day" : "days"}{d >= 2 && d <= 5 ? ` · −${fmtTZS(d >= 5 ? 10000 : d === 4 ? 7000 : d === 3 ? 5000 : 0)}` : ""}
                      </button>
                    ))}
                    <input
                      type="number" min={1} max={30} value={days} aria-label="Custom days"
                      style={{ width: 90 }}
                      onChange={(e) => setDays(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
                    />
                  </div>
                </div>
                <p style={{ color: "var(--dim)", fontSize: ".83rem", margin: "0 0 14px" }}>
                  2+ days: free delivery · 3 days −TSh 5,000 · 4 days −TSh 7,000 · 5+ days −TSh 10,000
                </p>
              </>
            )}
            <div className="field-row">
              <label className="field">
                <span>{pkg === "night" ? "Start night" : "Start date"}</span>
                <input type="date" min={eatToday()} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              <label className="field">
                <span>{pkg === "night" ? "Delivery time" : "Preferred time"}</span>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                {pkg === "night" ? <em style={{ color: "var(--dim)", fontSize: ".78rem", fontStyle: "normal" }}>Night deliveries leave at 8:00 PM; return by 10:00 AM.</em> : null}
              </label>
            </div>
          </div>

          <div className="card">
            <h3>Delivery</h3>
            <label className="field">
              <span>Zone</span>
              <select value={zone} onChange={(e) => setZone(e.target.value)}>
                {Object.entries(ZONES).map(([k, z]) => (
                  <option key={k} value={k}>{z.label}{z.fee === null ? " — fee agreed with rider" : ` — ${fmtTZS(z.fee)}`}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Street address / landmark</span>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. Goba, near Kimara Corner" />
            </label>
            {price?.freeDelivery ? <p style={{ color: "var(--green)", fontSize: ".85rem", margin: 0 }}>✓ Free delivery applies to this booking.</p> : null}
          </div>
        </div>
      ) : null}

      {step === 2 && pkg ? <GamesStep pkg={pkg} games={games} toggle={toggleGame} /> : null}

      {step === 3 && pkg && price ? (
        <div className="grid two">
          <div className="card">
            <h3>Your details</h3>
            <div className="field-row">
              <label className="field"><span>Full name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="field"><span>Phone (WhatsApp)</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0613138426" inputMode="tel" /></label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>ID type</span>
                <select value={idType} onChange={(e) => setIdType(e.target.value)}>
                  <option value="nida">NIDA ID</option>
                  <option value="licence">Driver's licence</option>
                  <option value="passport">Passport</option>
                </select>
              </label>
              <label className="field"><span>ID number</span><input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} /></label>
            </div>
            {profile?.kyc_status === "verified" ? (
              <p style={{ color: "var(--green)", fontSize: ".84rem", margin: "0 0 14px" }}>
                ✓ KYC verified on your account{profile.kyc_id_masked ? ` (${profile.kyc_id_type?.toUpperCase()} •••• ${profile.kyc_id_masked.slice(-4)})` : ""} — we still need the full number for this rental agreement.
              </p>
            ) : null}
            <div className="field-row">
              <label className="field"><span>Emergency contact</span><input value={ecName} onChange={(e) => setEcName(e.target.value)} /></label>
              <label className="field"><span>Their phone</span><input value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} inputMode="tel" /></label>
            </div>
            <div className="field">
              <span>Payment</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className={`btn btn-sm ${paymentMethod === "mpesa" ? "btn-primary" : "btn-ghost"}`} onClick={() => setPaymentMethod("mpesa")}>M-Pesa</button>
                <button type="button" className={`btn btn-sm ${paymentMethod === "cod" ? "btn-primary" : "btn-ghost"}`} onClick={() => setPaymentMethod("cod")}>Cash on delivery</button>
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Review your booking</h3>
            <dl style={{ margin: "14px 0 0" }}>
              <div className="kv"><dt>Package</dt><dd>{PACKAGE_META[pkg].name}</dd></div>
              <div className="kv"><dt>Schedule</dt><dd>{fmtDate(startDate)}{pkg === "weekend" ? " → Sun" : days > 1 ? ` → ${fmtDate(endDate)}` : ""} · {fmtTime(startTime)}</dd></div>
              <div className="kv"><dt>Games</dt><dd>{pkg === "starter" ? "5 pre-installed" : `${games.length} selected`}</dd></div>
              <div className="kv"><dt>Rental</dt><dd className="mono">{fmtTZS(price.rental + price.discount)}</dd></div>
              {price.discount > 0 ? <div className="kv"><dt>Multi-day discount</dt><dd className="mono" style={{ color: "var(--green)" }}>−{fmtTZS(price.discount)}</dd></div> : null}
              <div className="kv">
                <dt>Delivery ({ZONES[zone]?.label.split(" /")[0]})</dt>
                <dd className="mono">{price.freeDelivery ? <span style={{ color: "var(--green)" }}>FREE</span> : price.delivery === null ? "Agreed with rider" : fmtTZS(price.delivery)}</dd>
              </div>
              <div className="kv"><dt>Total</dt><dd className="mono gold" style={{ fontSize: "1.05rem" }}>{fmtTZS(price.total)}</dd></div>
            </dl>
            <ul style={{ color: "var(--dim)", fontSize: ".82rem", margin: "14px 0", paddingLeft: 18 }}>
              <li>No deposit — we verify your ID instead.</li>
              <li>Late returns are charged an extra day at the daily rate.</li>
              <li>Damage beyond normal wear is charged at repair/replacement cost.</li>
            </ul>
            <label className="check-row">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>I accept the rental rules and confirm my details are correct.</span>
            </label>
          </div>
        </div>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
        {step > 0 ? <button className="btn btn-ghost" type="button" onClick={() => setStep(step - 1)} disabled={busy}>Back</button> : null}
        {step < 3 ? (
          <button className="btn btn-primary" type="button" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</button>
        ) : (
          <button className="btn btn-primary" type="button" disabled={busy || !agreed} onClick={() => void submit()}>
            {busy ? "Sending…" : `Confirm booking · ${price ? fmtTZS(price.total) : ""}`}
          </button>
        )}
        <Link to="/" className="btn btn-ghost" style={{ marginLeft: "auto" }}>Cancel</Link>
      </div>
    </>
  );
}
