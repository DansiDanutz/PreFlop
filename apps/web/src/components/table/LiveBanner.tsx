import { cx } from '@preflop/ui';
import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type StreamStatus, streamGate } from '../../lib/live.ts';

/**
 * "Reconnecting… bets paused" while the live stream is down. The first connection gets a short
 * grace period so a normal page load does not flash the banner; a dropped socket shows it at once.
 */
export function LiveBanner({ ws, resyncing = false, graceMs = 1200, className }: { ws: StreamStatus; resyncing?: boolean; graceMs?: number; className?: string }) {
  const gate = streamGate(ws, resyncing);
  const [shown, setShown] = useState(ws === 'closed' || graceMs <= 0 || (ws === 'open' && resyncing));
  useEffect(() => {
    if (ws === 'open') { setShown(resyncing); return; }
    if (ws === 'closed' || graceMs <= 0) { setShown(true); return; }
    const t = setTimeout(() => setShown(true), graceMs);
    return () => clearTimeout(t);
  }, [ws, resyncing, graceMs]);
  if (!gate.message || !shown) return null;
  return (
    <div role="status" aria-live="polite" data-testid="live-banner"
      className={cx('sticky top-0 z-20 flex items-center gap-2.5 rounded-[10px] border border-warn/50 bg-warn/15 px-4 py-3 text-[14px] font-semibold text-ink backdrop-blur', className)}>
      <WifiOff className="h-4 w-4 shrink-0 text-warn" aria-hidden />
      <span>{gate.message}</span>
    </div>
  );
}
