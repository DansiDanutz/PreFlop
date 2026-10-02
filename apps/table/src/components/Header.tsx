import { Wordmark, cx } from '@preflop/ui';
import { Clock, Settings, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import type { Live } from '../lib/hooks.ts';
import { useNow } from '../lib/hooks.ts';
import { type Role } from '../lib/keystore.ts';
import { Sheet } from './controls.tsx';

const ROLE_BADGE: Record<Role, { label: string; cls: string }> = {
  dealer: { label: 'DEALER', cls: 'bg-accent text-accent-ink' },
  floor: { label: 'FLOOR', cls: 'bg-info text-white' },
  floor_manager: { label: 'FLOOR MANAGER', cls: 'bg-warn text-black' },
};

export function Header({ live, role, personId, tableId, clockOffsetMs, onSettings }: {
  live: Live; role: Role; personId: string; tableId: string; clockOffsetMs: number; onSettings: () => void;
}) {
  const [showProblems, setShowProblems] = useState(false);
  const now = useNow(1000);
  const s = live.state;
  const age = live.lastOkAt ? (now - live.lastOkAt) / 1000 : Infinity;
  const online = !live.error && age < 5;
  const conn = online ? { label: 'Live', cls: 'text-accent', Icon: Wifi } : live.lastOkAt ? { label: `Offline ${Math.round(age)} s`, cls: 'text-danger', Icon: WifiOff } : { label: 'Connecting', cls: 'text-warn', Icon: WifiOff };
  const ready = s?.readiness.ok;
  const paused = s?.table.status === 'paused';
  const b = ROLE_BADGE[role];
  return (
    <header className="flex items-center gap-4 border-b border-line bg-surface/80 px-5 py-3 backdrop-blur">
      <Wordmark size="sm" />
      <div className="h-8 w-px bg-line" />
      <div className="min-w-0">
        <div className="truncate font-serif text-2xl leading-tight" data-testid="table-name">{s?.table.name ?? tableId}</div>
        <div className="truncate text-xs text-muted">{s?.table.kind === 'simulated' ? 'Simulated table · ' : ''}{tableId}</div>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <span className={cx('rounded-full px-3 py-1.5 text-xs font-extrabold tracking-[0.14em]', b.cls)} data-testid="role-badge">{b.label}</span>
        <span className="max-w-40 truncate text-sm font-semibold" title="Person">{personId}</span>
        {s && (
          <button type="button" onClick={() => setShowProblems(true)} data-testid="readiness"
            className={cx('inline-flex min-h-12 items-center gap-2 rounded-full border px-4 text-sm font-semibold',
              paused ? 'border-warn/60 text-warn' : ready ? 'border-accent/60 text-accent' : 'border-danger/60 text-danger')}>
            <span className={cx('h-2.5 w-2.5 rounded-full', paused ? 'bg-warn' : ready ? 'bg-accent' : 'bg-danger pf-pulse')} />
            {paused ? 'Paused' : ready ? 'Ready' : `${s.readiness.problems.length} problem${s.readiness.problems.length === 1 ? '' : 's'}`}
          </button>
        )}
        {Math.abs(clockOffsetMs) > 5000 && (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-warn" title="Tablet clock differs from the server; signed timestamps are corrected">
            <Clock className="h-4 w-4" /> Clock {clockOffsetMs > 0 ? '−' : '+'}{Math.round(Math.abs(clockOffsetMs) / 1000)} s
          </span>
        )}
        <span className={cx('inline-flex items-center gap-1.5 text-sm font-semibold', conn.cls)} data-testid="connection"><conn.Icon className="h-4 w-4" />{conn.label}</span>
        <button type="button" onClick={onSettings} className="grid h-12 w-12 place-items-center rounded-full border border-line text-muted active:text-ink" aria-label="Tablet settings">
          <Settings className="h-5 w-5" />
        </button>
      </div>
      {showProblems && s && (
        <Sheet title={ready ? 'Table is ready' : 'Table is not ready'} onClose={() => setShowProblems(false)}>
          {s.readiness.problems.length === 0 ? <p className="text-muted">Certification, heartbeat, link and stream are all OK. Betting can open.</p> : (
            <ul className="flex flex-col gap-2">
              {s.readiness.problems.map((p) => <li key={p} className="rounded-[12px] border border-danger/40 bg-danger/10 px-4 py-3 text-base">{p}</li>)}
            </ul>
          )}
          {live.error && <p className="mt-4 text-sm text-danger">Last update failed: {live.error.message}</p>}
        </Sheet>
      )}
    </header>
  );
}
