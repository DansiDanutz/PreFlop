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
