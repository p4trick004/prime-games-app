import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api";
import { useAuth } from "./auth";

export interface CustomerRow {
  id: string;
  auth_user_id: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  customer_tier: "basic" | "standard" | "premium";
  credit_limit: number;
  customer_status: "active" | "suspended" | "blacklisted";
  created_at: string;
}

interface AuthMe {
  ok: boolean;
  customer: CustomerRow | null;
  link_pending: boolean;
}

interface CustomerCtx {
  customer: CustomerRow | null;
  linkPending: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<CustomerCtx | null>(null);

// Ensures the signed-in member has a customers row (register_customer is
// idempotent) and exposes tier/credit/link state from the backend, never
// from browser assumptions.
export function CustomerProvider({ children }: { children: ReactNode }) {
  const { session, accessToken } = useAuth();
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [linkPending, setLinkPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setCustomer(null);
      setLinkPending(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await accessToken();
      let me = await api<AuthMe>("auth_me", { token });
      if (!me.customer && !me.link_pending) {
        const reg = await api<{ customer: CustomerRow | null; link_pending: boolean }>("register_customer", { method: "POST", token });
        if (reg.customer) me = { ok: true, customer: reg.customer, link_pending: false };
        else me = { ok: true, customer: null, link_pending: reg.link_pending };
      }
      setCustomer(me.customer);
      setLinkPending(me.link_pending);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request_failed");
    } finally {
      setLoading(false);
    }
  }, [session, accessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ customer, linkPending, loading, error, refresh }), [customer, linkPending, loading, error, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCustomer(): CustomerCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCustomer outside provider");
  return v;
}