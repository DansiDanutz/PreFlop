import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type Me, forgetPreviousSession, signOutThenRevoke, watchIdle } from '@preflop/client';
import { api, revokeSession, session } from './api.ts';
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
  /** Retries GET /v1/me after it failed (RequireAuth's error state). */
  refetchMe: () => Promise<unknown>;
}

/** PreFlop team accounts are signed out after this long without use (the API's STAFF_IDLE_MINUTES). */
export const STAFF_IDLE_MS = 30 * 60_000;

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const token = useSyncExternalStore(session.subscribe, () => session.token);
  const me = useQuery({ queryKey: ['me', token], queryFn: api.me, enabled: !!token, staleTime: 60_000, retry: false });
  const portals = useMemo(() => (me.data ? resolvePortals(me.data) : []), [me.data]);

  // The session changed under this tab (a sign-out or another sign-in elsewhere): nothing cached
  // for the previous account may be shown.
  const previousToken = useRef(token);
  useEffect(() => {
    forgetPreviousSession(qc, previousToken.current, token);
    previousToken.current = token;
  }, [token, qc]);

  // PreFlop team accounts are signed out after STAFF_IDLE_MS without use in any console tab; the API
  // refuses their session after the same time unused (auth/players.ts STAFF_IDLE_MINUTES).
  const isStaff = !!token && !!me.data?.platform_role;
  useEffect(() => {
    if (!isStaff) return;
    return watchIdle({
      timeoutMs: STAFF_IDLE_MS,
      target: window,
      shared: { read: () => session.lastActive, write: (at) => session.markActive(at) },
      // Local first: an API that does not answer must not keep an unattended console signed in.
      onIdle: () => signOutThenRevoke(session.token, () => { session.set(null); qc.clear(); }, revokeSession),
    });
  }, [isStaff, qc]);

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
    refetchMe: () => me.refetch(),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
