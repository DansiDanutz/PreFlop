import { ApiError } from '@preflop/client';

export const nf = (n: number) => n.toLocaleString('en-US');

export const pctFromBps = (bps: number | undefined | null, digits = 2) => (bps === undefined || bps === null ? '—' : `${Number((bps / 100).toFixed(digits))}%`);

export const pctFromProb = (p: number, digits = 3) => `${(p * 100).toFixed(digits)}%`;

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return iso;
  if (s < 0) return 'in the future';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const pad3 = (n: number) => String(n).padStart(3, '0');

/** True when the endpoint is not deployed yet (404 route-not-found / 501). */
export const isNotAvailable = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 501);

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const p = e.problem as Record<string, unknown>;
    const detail = typeof p.detail === 'string' ? p.detail : typeof p.message === 'string' ? p.message : null;
    return `${e.problem.title || e.message}${detail && detail !== e.problem.title ? ` — ${detail}` : ''} (${e.status})`;
  }
  if (e instanceof TypeError) return 'Cannot reach the PreFlop API. Check your connection and that the API is running.';
  return e instanceof Error ? e.message : String(e);
}

/** Drops undefined/empty-string keys so filter objects satisfy exactOptionalPropertyTypes. */
export function defined<T extends Record<string, unknown>>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

export const ROUND_STATE_TONE: Record<string, 'accent' | 'info' | 'warn' | 'danger' | 'muted'> = {
  OPEN: 'accent', LOCKED: 'info', DEALT: 'info', REVIEW: 'warn', EVIDENCE_REJECTED: 'danger', SETTLED: 'muted', VOID: 'danger',
};

export const MODE_LABEL: Record<string, string> = {
  'real-fiat': 'Real money (EUR)', 'real-crypto': 'Real money (crypto)', play: 'Play money', 'virtual-chips': 'Virtual chips', diamonds: 'Diamonds',
};
