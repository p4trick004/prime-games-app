import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, demoMode, demoGet, demoSignIn, demoSignUp, demoSignOut, takeRecoveryHandoff, resetRedirectUrl, type Profile } from "./supabase";

interface AuthCtx {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  accessToken: () => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (name: string, email: string, phone: string, password: string) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<string | null>;
  refreshProfile: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<string | null>;
  adoptRecovery: () => Promise<boolean>;
  completePasswordReset: (password: string) => Promise<string | null>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside provider");
  return v;
}

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  return data as Profile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (demoMode) {
      const store = demoGet();
      setSession(store.session);
      setProfile(store.profile);
      setLoading(false);
      return;
    }
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (data.session) setProfile(await loadProfile(data.session.user.id));
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!alive) return;
      setSession(next);
      setProfile(next ? await loadProfile(next.user.id) : null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    session,
    profile,
    loading,
    accessToken: async () => {
      if (demoMode) return demoGet().session?.access_token ?? null;
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
    signIn: async (email, password) => {
      if (demoMode) {
        const r = demoSignIn(email, password);
        if (!r.error) { const s = demoGet(); setSession(s.session); setProfile(s.profile); }
        return r.error;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return error ? error.message : null;
    },
    signUp: async (name, email, phone, password) => {
      if (demoMode) {
        const r = demoSignUp(name, email);
        if (!r.error) { const s = demoGet(); setSession(s.session); setProfile(s.profile); }
        return { error: r.error, needsConfirmation: false };
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name, phone } },
      });
      if (error) return { error: error.message, needsConfirmation: false };
      // Email confirmation is on for this project: no session until the link is clicked.
      if (!data.session) return { error: null, needsConfirmation: true };
      await supabase.from("profiles").update({ full_name: name, phone }).eq("id", data.session.user.id);
      return { error: null, needsConfirmation: false };
    },
    signOut: async () => {
      if (demoMode) {
        demoSignOut();
        setSession(null);
        setProfile(null);
        return;
      }
      await supabase.auth.signOut();
    },
    updateProfile: async (patch) => {
      if (demoMode) {
        const store = demoGet();
        if (store.profile) Object.assign(store.profile, patch);
        setProfile(store.profile ? { ...store.profile } : null);
        return null;
      }
      if (!session) return "not_signed_in";
      const { error } = await supabase.from("profiles").update(patch).eq("id", session.user.id);
      if (error) return error.message;
      setProfile(await loadProfile(session.user.id));
      return null;
    },
    refreshProfile: async () => {
      if (demoMode) {
        setProfile(demoGet().profile ? { ...demoGet().profile! } : null);
        return;
      }
      if (session) setProfile(await loadProfile(session.user.id));
    },
    requestPasswordReset: async (email) => {
      if (demoMode) return null;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: resetRedirectUrl() });
      if (!error) return null;
      // Swallow "user not found" so the form can't be used to probe accounts;
      // still surface throttling so the user knows to retry later.
      const msg = error.message.toLowerCase();
      return msg.includes("rate limit") || msg.includes("security purposes") ? error.message : null;
    },
    adoptRecovery: async () => {
      if (demoMode) return true;
      const tokens = takeRecoveryHandoff();
      if (!tokens) return false;
      const { error } = await supabase.auth.setSession(tokens);
      return !error;
    },
    completePasswordReset: async (password) => {
      if (demoMode) return null;
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return error.message;
      await supabase.auth.signOut();
      return null;
    },
  }), [session, profile, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
