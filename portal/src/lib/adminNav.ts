import type { Icon } from "../components/ui";

export interface AdminNavItem {
  to: string;
  label: string;
  icon: keyof typeof Icon;
  title: string;
  end?: boolean;
  tab?: string;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { to: "/admin", label: "Dashboard", icon: "grid", title: "Operational Command", end: true, tab: "Home" },
  { to: "/admin/bookings", label: "Bookings & Rentals", icon: "calendar", title: "Bookings & Rentals Control", tab: "Bookings" },
  { to: "/admin/customers", label: "Customers & KYC", icon: "user", title: "Members & KYC", tab: "Customers" },
  { to: "/admin/inventory", label: "Inventory", icon: "box", title: "Inventory & Maintenance", tab: "Inventory" },
  { to: "/admin/games", label: "Games Catalog", icon: "gamepad", title: "Games Catalog", tab: "Games" },
  { to: "/admin/payments", label: "Payments", icon: "card", title: "Cashflows, Returns & Claims", tab: "Payments" },
];

// Bottom tab bar on small screens: the four busiest screens, rest behind "More".
export const MOBILE_TABS: AdminNavItem[] = [ADMIN_NAV[0], ADMIN_NAV[2], ADMIN_NAV[1], ADMIN_NAV[3]];
