import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { adminLogin, adminRecover, clearAdminToken, getAdminToken } from "./adminApi";

interface AdminAuthCtx {
  authenticated: boolean;
  login: (password: string) => Promise<void>;
  recover: (code: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AdminAuthCtx | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean>(() => getAdminToken() !== null);

  const login = useCallback(async (password: string) => {
    await adminLogin(password);
    setAuthenticated(true);
  }, []);

  const recover = useCallback(async (code: string) => {
    await adminRecover(code);
    setAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    clearAdminToken();
    setAuthenticated(false);
  }, []);

  return <Ctx.Provider value={{ authenticated, login, recover, logout }}>{children}</Ctx.Provider>;
}

export function useAdminAuth(): AdminAuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  return ctx;
}