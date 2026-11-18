import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";

export type RentalStatus = "scheduled" | "active" | "returned" | "overdue" | "cancelled";

export interface Rental {
  id: string;
  booking_id: string;
  customer_id: string;
  console_id: string | null;
  status: RentalStatus;
  start_at: string | null;
  expected_return_at: string | null;
  actual_return_at: string | null;
  condition_out: string | null;
  condition_in: string | null;
  late_fee: number | null;
  notes: string | null;
  created_at: string;
  customer_name: string;
  customer_phone: string | null;
  booking_ref: string | null;
  package_key: string | null;
  days: number | null;
  unit_code: string | null;
}

export function useMyRentals() {
  const { accessToken } = useAuth();
  const [rentals, setRentals] = useState<Rental[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const token = await accessToken();
      if (!token) {
        setRentals([]);
        return;
      }
      const data = await api<{ items: Rental[] }>("my_rentals", { token });
      setRentals(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request_failed");
      setRentals([]);
    }
  }, [accessToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rentals, error, reload };
}

export const RENTAL_STATUS_LABEL: Record<RentalStatus, string> = {
  scheduled: "Scheduled",
  active: "Out with you",
  returned: "Returned",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

export const RENTAL_STATUS_TONE: Record<RentalStatus, "gold" | "cyan" | "green" | "red" | "gray"> = {
  scheduled: "gold", active: "cyan", returned: "green", overdue: "red", cancelled: "gray",
};