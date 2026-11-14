import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";

export interface Booking {
  id: string;
  ref: string;
  customer_name: string;
  customer_phone: string;
  zone_key: string;
  address: string;
  package_key: "starter" | "weekend" | "night";
  days: number;
  start_date: string;
  start_time: string;
  id_type: string;
  id_number: string;
  ec_name: string;
  ec_phone: string;
  payment_method: "mpesa" | "cod";
  rental_amount: number;
  discount: number;
  delivery_fee: number | null;
  total: number;
  status: "pending" | "confirmed" | "delivered" | "completed" | "cancelled";
  payment_status: "unpaid" | "paid";
  notes: string | null;
  created_at: string;
  user_id?: string | null;
}

export function useMyBookings() {
  const { accessToken } = useAuth();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const token = await accessToken();
      if (!token) {
        setBookings([]);
        return;
      }
      const data = await api<{ items: Booking[] }>("my_bookings", { token });
      setBookings(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request_failed");
      setBookings([]);
    }
  }, [accessToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { bookings, error, reload };
}

export const STATUS_LABEL: Record<Booking["status"], string> = {
  pending: "Pending approval",
  confirmed: "Confirmed",
  delivered: "Out with you",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const isOpen = (b: Booking) => ["pending", "confirmed", "delivered"].includes(b.status);
