import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";

export interface PaymentItem {
  id: string;
  ref: string;
  booking_id: string | null;
  booking_ref: string | null;
  customer_name: string;
  customer_phone: string | null;
  amount: number;
  method: string;
  kind: string;
  status: "settled" | "pending" | "failed" | "refunded";
  notes: string | null;
  occurred_at: string;
  created_at: string;
}

// outstanding is the server-computed Model C debt (incurred obligations only;
// future unpaid bookings are commitments and never counted here).
export function useMyPayments() {
  const { accessToken } = useAuth();
  const [payments, setPayments] = useState<PaymentItem[] | null>(null);
  const [outstanding, setOutstanding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const token = await accessToken();
      if (!token) {
        setPayments([]);
        setOutstanding(0);
        return;
      }
      const data = await api<{ items: PaymentItem[]; outstanding: number | null }>("my_payments", { token });
      setPayments(data.items);
      setOutstanding(data.outstanding);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request_failed");
      setPayments([]);
    }
  }, [accessToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { payments, outstanding, error, reload };
}