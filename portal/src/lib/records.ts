// Builds the single consolidated customer history document from API data that
// the authenticated endpoints already scoped to the signed-in customer. Pure
// functions only (no DOM, no network) so they stay unit-testable.
import type { Booking } from "./bookings";
import type { Rental } from "./rentals";
import type { PaymentItem } from "./payments";
import { PACKAGE_META, ZONES } from "./pricing";

export type RecordKind = "account" | "bookings" | "rentals" | "payments" | "summary";
export type Cell = string | number;

export interface RecordSection {
  heading?: string;
  columns: string[];
  rows: Cell[][];
}

export interface RecordTable {
  id: RecordKind;
  title: string;
  subtitle?: string;
  sections: RecordSection[];
}

export interface AccountInfo {
  name: string;
  email: string | null;
  phone: string | null;
  tier: string;
  memberSince: string | null;
  creditLimit: number | null;
}

export interface RecordsBundle {
  customerName: string;
  generatedAt: Date;
  tables: Record<RecordKind, RecordTable>;
}

const BOOKING_STATUS: Record<Booking["status"], string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  delivered: "Out with you",
  completed: "Completed",
  cancelled: "Cancelled",
};

const RENTAL_STATUS: Record<Rental["status"], string> = {
  scheduled: "Scheduled",
  active: "Out with you",
  returned: "Returned",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

const PAYMENT_STATUS: Record<PaymentItem["status"], string> = {
  settled: "Settled",
  pending: "Pending",
  failed: "Failed",
  refunded: "Refunded",
};

const METHOD: Record<string, string> = {
  mpesa: "M-Pesa",
  cod: "Cash on delivery",
  cash: "Cash",
  bank: "Bank transfer",
};

const KIND: Record<string, string> = {
  rental: "Rental payment",
  deposit: "Deposit",
  refund: "Refund",
  late_fee: "Late fee",
  damage_fee: "Damage fee",
  adjustment: "Adjustment",
  other: "Other",
};

export const TABLE_ORDER: RecordKind[] = ["account", "bookings", "rentals", "payments", "summary"];

export function packageName(key: string | null | undefined): string {
  return key && key in PACKAGE_META ? PACKAGE_META[key as keyof typeof PACKAGE_META].name : "—";
}

export function rentalRef(id: string): string {
  return `R-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

// ISO timestamps are shown in East Africa Time (UTC+3, no DST) as YYYY-MM-DD HH:mm.
export function stamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const t = new Date(d.getTime() + 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

function durationText(pkg: string, days: number): string {
  if (pkg === "weekend") return "Weekend (Fri-Sun)";
  return `${days} ${pkg === "night" ? "night" : "day"}${days === 1 ? "" : "s"}`;
}

function rentalDuration(r: Rental): string {
  if (!r.start_at) return "—";
  const end = r.actual_return_at ?? r.expected_return_at;
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(r.start_at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return `${(ms / 86400000).toFixed(1)} days`;
}

function consoleByBooking(rentals: Rental[]): Map<string, string> {
  const rank = (r: Rental) => (r.status === "active" || r.status === "overdue" ? 2 : r.unit_code ? 1 : 0);
  const map = new Map<string, Rental>();
  for (const r of rentals) {
    const cur = map.get(r.booking_id);
    if (!cur || rank(r) > rank(cur) || (rank(r) === rank(cur) && String(r.created_at) > String(cur.created_at))) {
      map.set(r.booking_id, r);
    }
  }
  return new Map([...map].map(([id, r]) => [id, r.unit_code ?? "—"]));
}

export function buildAccountTable(account: AccountInfo): RecordTable {
  const rows: Cell[][] = [
    ["Name", account.name],
    ["Email", account.email ?? "—"],
    ["Phone", account.phone ?? "—"],
    ["Membership", account.tier === "premium" ? "Premium member" : "Standard member"],
    ["Customer since", account.memberSince ? stamp(account.memberSince).slice(0, 10) : "—"],
  ];
  if (account.tier === "premium" && account.creditLimit !== null) {
    rows.push(["Approved credit limit", account.creditLimit]);
  }
  return {
    id: "account",
    title: "Customer account",
    subtitle: "Account details held for your Prime Games membership.",
    sections: [{ columns: ["Detail", "Value"], rows }],
  };
}

export function buildBookingTable(bookings: Booking[], rentals: Rental[]): RecordTable {
  const consoles = consoleByBooking(rentals);
  const rows = bookings.map((b) => [
    b.ref,
    stamp(b.created_at),
    b.start_date,
    b.start_time,
    durationText(b.package_key, b.days),
    packageName(b.package_key),
    consoles.get(b.id) ?? "—",
    ZONES[b.zone_key]?.label ?? b.zone_key,
    BOOKING_STATUS[b.status] ?? b.status,
    b.status === "cancelled" ? "—" : b.payment_status === "paid" ? "Paid" : "Unpaid",
    b.rental_amount,
    b.discount,
    b.delivery_fee ?? "Agreed with rider",
    b.total,
  ]);
  return {
    id: "bookings",
    title: "Booking history",
    subtitle: "All booking requests on your account.",
    sections: [
      {
        columns: [
          "Booking ref", "Booked", "Start date", "Start time", "Duration", "Package",
          "Console", "Zone", "Status", "Payment", "Rental amount", "Discount", "Delivery", "Total",
        ],
        rows,
      },
    ],
  };
}

export function buildRentalTable(rentals: Rental[]): RecordTable {
  const rows = rentals.map((r) => [
    rentalRef(r.id),
    r.booking_ref ?? "—",
    r.unit_code ?? "—",
    packageName(r.package_key),
    stamp(r.start_at),
    stamp(r.expected_return_at),
    stamp(r.actual_return_at),
    rentalDuration(r),
    RENTAL_STATUS[r.status] ?? r.status,
    r.late_fee ?? 0,
  ]);
  return {
    id: "rentals",
    title: "Rental history",
    subtitle: "Console handovers and returns. Rental refs are short forms of the rental record id.",
    sections: [
      {
        columns: ["Rental ref", "Booking ref", "Unit", "Package", "Start", "Due back", "Returned", "Duration", "Status", "Late fee"],
        rows,
      },
    ],
  };
}

export function buildPaymentTable(payments: PaymentItem[]): RecordTable {
  const rows = payments.map((p) => [
    p.ref,
    stamp(p.occurred_at),
    p.amount,
    METHOD[p.method] ?? p.method,
    KIND[p.kind] ?? p.kind,
    p.booking_ref ?? "—",
    PAYMENT_STATUS[p.status] ?? p.status,
  ]);
  return {
    id: "payments",
    title: "Payment history",
    subtitle: "Receipts, refunds and adjustments recorded on your account.",
    sections: [
      {
        columns: ["Receipt", "Date", "Amount", "Method", "Type", "Booking", "Status"],
        rows,
      },
    ],
  };
}

export function buildSummaryTable(input: {
  bookings: Booking[];
  rentals: Rental[];
  payments: PaymentItem[];
  outstanding: number | null;
}): RecordTable {
  const { bookings, rentals, payments, outstanding } = input;

  const rentalSpend = bookings.filter((b) => b.status !== "cancelled").reduce((s, b) => s + b.total, 0);
  const lateFees = rentals.filter((r) => r.status !== "cancelled").reduce((s, r) => s + (r.late_fee ?? 0), 0);
  let received = 0;
  let refunded = 0;
  for (const p of payments) {
    if (p.status !== "settled") continue;
    if (p.amount >= 0) received += p.amount;
    else refunded += -p.amount;
  }

  const paidByBooking = new Map<string, number>();
  for (const p of payments) {
    if (p.status !== "settled" || !p.booking_id) continue;
    paidByBooking.set(p.booking_id, (paidByBooking.get(p.booking_id) ?? 0) + p.amount);
  }

  const breakdown = bookings.map((b) => {
    const paid = paidByBooking.get(b.id) ?? 0;
    const balance = b.status === "cancelled" ? 0 : Math.max(0, b.total - paid);
    return [b.ref, b.start_date, packageName(b.package_key), b.total, paid, balance, BOOKING_STATUS[b.status] ?? b.status];
  });

  return {
    id: "summary",
    title: "Customer spending summary",
    subtitle: "Complete account history. The outstanding balance is the current ledger balance.",
    sections: [
      {
        heading: "Totals",
        columns: ["Item", "Value"],
        rows: [
          ["Rental expenditure (all bookings)", rentalSpend],
          ["Late fees", lateFees],
          ["Payments received", received],
          ["Refunds & adjustments", refunded],
          ["Net paid", received - refunded],
          ["Outstanding balance (current)", outstanding ?? "—"],
        ],
      },
      {
        heading: "Breakdown by booking",
        columns: ["Booking ref", "Start", "Package", "Total", "Paid", "Balance", "Status"],
        rows: breakdown,
      },
    ],
  };
}

export function buildRecordsBundle(input: {
  account: AccountInfo;
  bookings: Booking[];
  rentals: Rental[];
  payments: PaymentItem[];
  outstanding: number | null;
  now?: Date;
}): RecordsBundle {
  const generatedAt = input.now ?? new Date();
  const sortedPayments = [...input.payments].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  return {
    customerName: input.account.name,
    generatedAt,
    tables: {
      account: buildAccountTable(input.account),
      bookings: buildBookingTable(input.bookings, input.rentals),
      rentals: buildRentalTable(input.rentals),
      payments: buildPaymentTable(sortedPayments),
      summary: buildSummaryTable({ ...input }),
    },
  };
}

export function historyFilename(customerName: string, date = new Date()): string {
  const slug = customerName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "customer";
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  return `prime-games-complete-history-${slug}-${day}.pdf`;
}
