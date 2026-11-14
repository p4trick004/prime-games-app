import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export const Icon = {
  grid: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
  box: <><path d="M3 8l9-5 9 5v8l-9 5-9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  card: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>,
  gamepad: <><rect x="2" y="7" width="20" height="11" rx="5" /><path d="M7 11v3M5.5 12.5h3M15.5 11h.01M18 13h.01" /></>,
  bell: <><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M16 12h.01M3 10h18" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 3" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  dots: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
};

export function Ic({ name, size = 17 }: { name: keyof typeof Icon; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {Icon[name]}
    </svg>
  );
}

export function GamepadMark({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="11" rx="5" />
      <path d="M7 11v3M5.5 12.5h3M15.5 11h.01M18 13h.01" />
    </svg>
  );
}

export function StatCard({ label, value, sub, tone, alert, border }: {
  label: string; value: ReactNode; sub?: string;
  tone?: "cyan" | "gold" | "green" | "red" | "gray";
  alert?: boolean; border?: "gold" | "green" | "red";
}) {
  const borderClass = border === "green" ? " ok" : border === "red" ? " danger" : (border === "gold" || alert) ? " alert" : "";
  return (
    <div className={`stat-card${borderClass}`}>
      <div className="label">{label}</div>
      <div className={`value ${tone ?? "cyan"}`}>{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function Badge({ tone, children }: { tone: "gold" | "cyan" | "green" | "red" | "gray"; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Countdown({ to }: { to: Date }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  let diff = Math.max(0, Math.floor((to.getTime() - now) / 1000));
  const days = Math.floor(diff / 86400); diff %= 86400;
  const hours = Math.floor(diff / 3600); diff %= 3600;
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="countdown" role="timer" aria-label="Time remaining">
      <div className="unit"><span className="num">{pad(days)}</span><span className="cap">days</span></div>
      <span className="sep">:</span>
      <div className="unit"><span className="num">{pad(hours)}</span><span className="cap">hours</span></div>
      <span className="sep">:</span>
      <div className="unit"><span className="num">{pad(mins)}</span><span className="cap">minutes</span></div>
      <span className="sep">:</span>
      <div className="unit gold"><span className="num">{pad(secs)}</span><span className="cap">seconds</span></div>
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}
