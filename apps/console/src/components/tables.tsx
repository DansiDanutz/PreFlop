import type { LinkSample } from '@preflop/client';
import type { CertItem } from '@preflop/client';
import { cx } from '@preflop/ui';
import { CheckCircle2, Circle, Clock } from 'lucide-react';
import { CERT_ITEMS, certSummary, expiresSoon, isExpired } from '../lib/certification.ts';
import { fmtDate, relTime } from '../lib/format.ts';
import { Toggle } from './ui.tsx';

export function CertBadge({ cert }: { cert: Record<string, CertItem> | null | undefined }) {
  const s = certSummary(cert);
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1',
      s.complete ? 'text-accent ring-accent/40' : 'text-warn ring-warn/40')}>
      {s.ok}/{s.total} certified{s.soon > 0 && <span className="text-warn"> · {s.soon} expiring</span>}
    </span>
  );
}

/** The 9-item checklist with who / when / expiry. Editable when `onToggle` is given. */
export function CertChecklist({ cert, onToggle, busyKey }: { cert: Record<string, CertItem> | null | undefined; onToggle?: (key: string, ok: boolean) => void; busyKey?: string | null }) {
  return (
    <ul className="divide-y divide-line/60">
      {CERT_ITEMS.map((it) => {
        const c = cert?.[it.key];
        const expired = isExpired(c);
        const soon = expiresSoon(c);
        const ok = !!c?.ok && !expired;
        return (
          <li key={it.key} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5">{ok ? <CheckCircle2 size={17} className="text-accent" aria-label="OK" /> : <Circle size={17} className={expired ? 'text-danger' : 'text-faint'} aria-label={expired ? 'Expired' : 'Missing'} />}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{it.label} <span className="font-mono text-[11px] text-faint">{it.key}</span></div>
              <div className="text-xs text-muted">{it.hint}</div>
              {c && (c.by || c.at || c.expires_at) && (
                <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-faint">
                  {c.by && <span>by {c.by}</span>}
                  {c.at && <span>on {fmtDate(c.at)}</span>}
                  {c.expires_at && <span className={cx(expired ? 'text-danger' : soon ? 'text-warn' : '')}><Clock size={10} className="mr-0.5 inline" aria-hidden />{expired ? 'expired' : 'expires'} {fmtDate(c.expires_at)}</span>}
                </div>
              )}
            </div>
            {onToggle && <Toggle checked={!!c?.ok} label={`${it.label} certified`} disabled={busyKey === it.key} onChange={(v) => onToggle(it.key, v)} />}
          </li>
        );
      })}
    </ul>
  );
}

const LINK_RULES: { keys: string[]; label: string; unit: string; ok: (v: number) => boolean; limit: string }[] = [
  { keys: ['uploadMbps', 'upload_mbps', 'upload'], label: 'Upload', unit: 'Mbps', ok: (v) => v >= 20, limit: '≥ 20' },
  { keys: ['rttMs', 'rtt_ms', 'rtt'], label: 'Round trip', unit: 'ms', ok: (v) => v <= 150, limit: '≤ 150' },
  { keys: ['jitterMs', 'jitter_ms', 'jitter'], label: 'Jitter', unit: 'ms', ok: (v) => v <= 30, limit: '≤ 30' },
  { keys: ['packetLossPct', 'loss_pct', 'loss'], label: 'Packet loss', unit: '%', ok: (v) => v <= 1, limit: '≤ 1' },
  { keys: ['videoDelayMs', 'video_delay_ms'], label: 'Video delay', unit: 'ms', ok: (v) => v <= 3000, limit: '≤ 3000' },
];

const LINK_FLAGS: { keys: string[]; label: string }[] = [
  { keys: ['streamLive', 'stream_live'], label: 'Stream on air' },
  { keys: ['backupLinkUp', 'backup_link_up'], label: 'Backup line up' },
  { keys: ['encoderOk', 'encoder_ok'], label: 'Encoder OK' },
];

/** Heartbeat link stats against the docs/11 §3 limits. Unknown keys are listed as-is. */
export function LinkHealth({ link: sample, at }: { link: LinkSample | Record<string, unknown> | null; at: string | null }) {
  const link = sample as Record<string, unknown> | null;
  if (!link) return <p className="text-sm text-muted">No heartbeat received yet.</p>;
  const used = new Set<string>();
  const rows = LINK_RULES.flatMap((r) => {
    const k = r.keys.find((x) => typeof link[x] === 'number');
    if (!k) return [];
    used.add(k);
    const v = link[k] as number;
    return [{ ...r, v, good: r.ok(v) }];
  });
  const flags = LINK_FLAGS.flatMap((f) => {
    const k = f.keys.find((x) => typeof link[x] === 'boolean');
    if (!k) return [];
    used.add(k);
    return [{ label: f.label, on: link[k] === true }];
  });
  const rest = Object.entries(link).filter(([k]) => !used.has(k));
  const stale = at ? Date.now() - new Date(at).getTime() > 5000 : true;
  return (
    <div className="space-y-3">
      <div className={cx('text-xs', stale ? 'text-danger' : 'text-muted')}>Last heartbeat {relTime(at)}{stale && ' — older than 5 s (table pauses)'}</div>
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {rows.map((r) => (
            <div key={r.label} className={cx('rounded-[12px] border px-3 py-2', r.good ? 'border-line' : 'border-danger/50 bg-danger/5')}>
              <div className="text-[11px] text-faint">{r.label} <span className="text-faint/80">({r.limit} {r.unit})</span></div>
              <div className={cx('text-lg font-semibold tabular-nums', !r.good && 'text-danger')}>{r.v} <span className="text-xs font-normal text-muted">{r.unit}</span></div>
            </div>
          ))}
        </div>
      )}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {flags.map((f) => (
            <span key={f.label} className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1', f.on ? 'text-accent ring-accent/40' : 'text-danger ring-danger/50')}>
              <span className={cx('h-1.5 w-1.5 rounded-full', f.on ? 'bg-accent' : 'bg-danger')} />{f.label}{!f.on && ': no'}
            </span>
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {rest.map(([k, v]) => <div key={k} className="contents"><dt className="font-mono text-faint">{k}</dt><dd className="truncate">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>)}
        </dl>
      )}
    </div>
  );
}
