// Shared shapes returned by the admin_* endpoints. Mirrors the managed-DB columns.

export type ConsoleStatus = "available" | "rented" | "maintenance" | "retired";
export type ConditionGrade = "excellent" | "good" | "fair" | "poor";
export type MaintStatus = "open" | "in_progress" | "resolved";
export type MaintPriority = "low" | "medium" | "high" | "critical";
export type GameStatus = "available" | "rented" | "retired";
export type GamePlatform = "ps5" | "ps4";
export type TxnStatus = "settled" | "pending" | "failed" | "refunded";
export type IncidentStatus = "open" | "investigating" | "resolved" | "waived";
export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type BookingStatus = "pending" | "confirmed" | "delivered" | "completed" | "cancelled";
export type PaymentStatus = "unpaid" | "paid";

export interface ConsoleUnit {
  id: string;
  unit_code: string;
  model: string;
  serial_number: string | null;
  status: ConsoleStatus;
  condition_grade: ConditionGrade;
  current_renter: string | null;
  rentals_count: number;
  last_audit_at: string | null;
  purchased_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface MaintenanceRecord {
  id: string;
  console_id: string;
  unit_code: string;
  issue: string;
  status: MaintStatus;
  priority: MaintPriority;
  engineer: string | null;
  cost: number | null;
  notes: string | null;
  opened_at: string;
  resolved_at: string | null;
  created_at: string;
}

export interface Game {
  id: string;
  title: string;
  platform: GamePlatform;
  genre: string | null;
  media_format: string | null;
  cover_url: string | null;
  status: GameStatus;
  created_at: string;
}

export interface Transaction {
  id: string;
  ref: string;
  booking_id: string | null;
  booking_ref: string | null;
  customer_name: string;
  customer_phone: string | null;
  amount: number;
  method: string;
  kind: string;
  status: TxnStatus;
  notes: string | null;
  occurred_at: string;
  created_at: string;
}

export interface Incident {
  id: string;
  ref: string;
  booking_id: string | null;
  booking_ref: string | null;
  console_id: string | null;
  unit_code: string | null;
  customer_name: string;
  customer_phone: string | null;
  kind: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  description: string | null;
  claim_amount: number | null;
  resolved_amount: number | null;
  occurred_at: string;
  created_at: string;
}

export interface Booking {
  id: string;
  ref: string;
  customer_name: string;
  customer_phone: string;
  zone_key: string;
  address: string;
  package_key: string;
  days: number;
  start_date: string;
  start_time: string;
  id_type: string;
  id_number: string;
  ec_name: string;
  ec_phone: string;
  payment_method: string;
  rental_amount: number;
  discount: number;
  delivery_fee: number | null;
  total: number;
  status: BookingStatus;
  payment_status: PaymentStatus;
  notes: string | null;
  console_id: string | null;
  created_at: string;
}

export interface CustomerAgg {
  name: string;
  phone: string;
  zone_key: string;
  bookings: number;
  spend: number;
  open: number;
  last_at: string;
}

export interface AdminStats {
  pending: number;
  confirmed: number;
  active: number;
  unpaid: number;
  total_bookings: number;
  revenue: number;
  revenue_today: number;
  outstanding: number;
  consoles_total: number;
  consoles_available: number;
  consoles_rented: number;
  consoles_maintenance: number;
  consoles_retired: number;
  maintenance_open: number;
  games_total: number;
  games_available: number;
  incidents_open: number;
}
