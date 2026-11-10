import { forgetPreviousSession } from '@preflop/client';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useSyncExternalStore } from 'react';
import { Navigate, useLocation } from 'react-router';
import { getToken, onTokenChange, setToken, setUnauthorizedHandler } from './api.ts';

export function useToken(): string | null {
  return useSyncExternalStore(onTokenChange, getToken, () => null);
}

/** Clears an expired session once, wherever a 401 comes from. */
export function useSessionGuard() {
  const qc = useQueryClient();
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (getToken()) {
        setToken(null);
        qc.removeQueries({ queryKey: ['me'] });
      }
    });
    return () => {
      setUnauthorizedHandler(null);
    };
  }, [qc]);
  // The session changed under this tab (a sign-out or another sign-in in another tab): nothing
  // cached for the previous account may be shown.
  useEffect(() => {
    let previous = getToken();
    return onTokenChange(() => {
      const current = getToken();
      forgetPreviousSession(qc, previous, current);
      previous = current;
    });
  }, [qc]);
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useToken();
  const loc = useLocation();
  if (!token) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/** Only same-site relative paths are allowed as a post-login destination. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
}
