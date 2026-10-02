import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@preflop/client';
import { api, session } from './api.ts';
import { resolvePortals, type Portal } from './portals.ts';

interface AuthState {
  token: string | null;
  me: Me | undefined;
  portals: Portal[];
  loading: boolean;
  error: unknown;
  /** Rejects with ApiError 401 mfa_required when the account needs a one-time code. */
  login: (email: string, password: string, otp?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const token = useSyncExternalStore(session.subscribe, () => session.token);
  const me = useQuery({ queryKey: ['me', token], queryFn: api.me, enabled: !!token, staleTime: 60_000, retry: false });
  const portals = useMemo(() => (me.data ? resolvePortals(me.data) : []), [me.data]);

  const value: AuthState = {
    token,
    me: me.data,
    portals,
    loading: !!token && me.isPending,
    error: me.error,
    async login(email, password, otp) {
      const r = await api.login({ email, password, ...(otp ? { otp } : {}) });
      qc.clear();
      session.set(r.token);
    },
    async logout() {
      try { await api.logout(); } catch { /* the session may already be gone */ }
      session.set(null);
      qc.clear();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
