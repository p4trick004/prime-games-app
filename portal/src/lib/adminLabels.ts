import type {
  BookingStatus, ConsoleStatus, ConditionGrade, GameStatus, IncidentSeverity,
  IncidentStatus, MaintPriority, MaintStatus, PaymentStatus, TxnStatus,
} from "./adminTypes";

export type Tone = "gold" | "cyan" | "green" | "red" | "gray";

export const titleCase = (s: string): string =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const CONSOLE_STATUS_LABEL: Record<ConsoleStatus, string> = {
  available: "Available", rented: "Rented", maintenance: "Maintenance", retired: "Retired",
};
export const CONSOLE_STATUS_TONE: Record<ConsoleStatus, Tone> = {
  available: "green", rented: "cyan", maintenance: "gold", retired: "gray",
};
export const CONDITION_LABEL: Record<ConditionGrade, string> = {
  excellent: "Excellent", good: "Good", fair: "Fair", poor: "Poor",
};
export const CONDITION_TONE: Record<ConditionGrade, Tone> = {
  excellent: "green", good: "cyan", fair: "gold", poor: "red",
};
export const MAINT_STATUS_TONE: Record<MaintStatus, Tone> = {
  open: "gold", in_progress: "cyan", resolved: "green",
};
export const PRIORITY_TONE: Record<MaintPriority | IncidentSeverity, Tone> = {
  low: "gray", medium: "cyan", high: "gold", critical: "red",
};
export const GAME_STATUS_TONE: Record<GameStatus, Tone> = {
  available: "green", rented: "cyan", retired: "gray",
};
export const TXN_STATUS_TONE: Record<TxnStatus, Tone> = {
  settled: "green", pending: "gold", failed: "red", refunded: "gray",
};
export const INCIDENT_STATUS_TONE: Record<IncidentStatus, Tone> = {
  open: "gold", investigating: "cyan", resolved: "green", waived: "gray",
};
export const BOOKING_STATUS_TONE: Record<BookingStatus, Tone> = {
  pending: "gold", confirmed: "cyan", delivered: "green", completed: "gray", cancelled: "red",
};
export const PAYMENT_STATUS_TONE: Record<PaymentStatus, Tone> = {
  paid: "green", unpaid: "gold",
};

export const PACKAGE_LABEL: Record<string, string> = {
  starter: "Starter", weekend: "Weekend", night: "Night",
};
export const ZONE_LABEL: Record<string, string> = {
  goba: "Goba", sinza: "Sinza", mbezi: "Mbezi", kigamboni: "Kigamboni",
  magomeni: "Magomeni", oyster: "Oysterbay", other: "Other",
};
export const METHOD_LABEL: Record<string, string> = {
  mpesa: "M-Pesa", cod: "Cash on delivery", cash: "Cash", bank: "Bank",
};

// Timestamp (timestamptz) helpers — distinct from the date-only helpers in format.ts.
export function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, Date.now() - t);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
