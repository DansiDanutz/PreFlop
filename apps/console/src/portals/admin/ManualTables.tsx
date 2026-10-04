import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ManualTable } from '@preflop/client';
import { Badge, Button, formatMoney } from '@preflop/ui';
import { Camera, CameraOff, Lock, Plus } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { pad3 } from '../../lib/format.ts';
import { RANKS, SUITS, cardLabel, secondsLeft, toggleCard } from '../../lib/manualFlop.ts';
import { Callout, ConfirmDialog, ErrorBox, Field, Loading, PageHeader, Section, TextInput, useAction } from '../../components/ui.tsx';
import { FlopText, RoundStateBadge } from '../../components/domain.tsx';

/**
 * Manual tables (migration 020): close betting, then type the three flop cards. Free play only.
 * The flop is accepted only after betting closes; an unentered flop is voided and refunded at the
 * result deadline. Every step is in the audit log with who did it.
 */
export function ManualTables() {
  const q = useQuery({ queryKey: ['admin', 'manual-tables'], queryFn: api.adminManualTables, refetchInterval: 3000 });
  const [form, setForm] = useState({ name: '' });
  const create = useAction((b: typeof form) => api.adminCreateManualTable({ name: b.name.trim() }), {
    invalidate: [['admin', 'manual-tables'], ['admin', 'tables']],
    success: (r) => `Manual table “${r.name}” created; betting is open.`,
    onSuccess: () => setForm({ ...form, name: '' }),
  });

  return (
    <>
      <PageHeader eyebrow="PreFlop team" title="Manual tables"
        subtitle="Close betting, then type the three flop cards. Players bet with play money only; every entry is audited." />
      {q.isPending ? <Loading rows={4} /> : q.isError ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="space-y-6">
          {!q.data.enabled && (
            <Callout tone="warn" title="Manual tables are switched off">
              No round opens and betting can't be closed. Turn on <code className="font-mono">manual_tables_enabled</code> in Settings.
            </Callout>
          )}
          {q.data.tables.map((t) => <ManualTableCard key={t.id} t={t} slaMs={q.data.result_sla_ms} />)}
          <Section title="New manual table" subtitle="Play money. It opens for bets at once and appears in the player lobby.">
            <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (form.name.trim().length >= 2) create.mutate(form); }}>
              <Field label="Name" className="min-w-[200px] flex-1">{(p) => <TextInput {...p} value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Webcam test table" />}</Field>
              <Button type="submit" disabled={create.isPending || form.name.trim().length < 2}><Plus size={16} aria-hidden />Create table</Button>
            </form>
          </Section>
        </div>
      )}
    </>
  );
}

function ManualTableCard({ t, slaMs }: { t: ManualTable; slaMs: number }) {
  const r = t.round;
  const [picked, setPicked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [, tick] = useState(0);
  // A new hand clears the picker; the countdown re-renders every second while betting is closed.
  // A new hand (settled, or voided and replaced) clears the picker and any confirmation still open.
  useEffect(() => { setPicked([]); setConfirming(false); }, [r?.id]);
  useEffect(() => {
    if (r?.state !== 'LOCKED') return;
    const i = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [r?.state]);

  const lock = useAction(() => api.adminManualLock(t.id, r!.hand_no), { invalidate: [['admin', 'manual-tables']], success: `Betting closed on ${t.name}.` });
  const settle = useAction((cards: string[]) => api.adminManualFlop(t.id, r!.hand_no, cards), {
    invalidate: [['admin', 'manual-tables'], ['admin', 'tables']],
    success: (res) => `Hand settled: ${res.cards.map(cardLabel).join(' ')}. The next hand is open.`,
    onSuccess: () => { setConfirming(false); setPicked([]); },
  });
  const left = r?.state === 'LOCKED' ? secondsLeft(r.locked_at, slaMs) : null;

  return (
    <Section
      title={<span className="flex flex-wrap items-center gap-2">{t.name}<Badge tone="muted">Play money</Badge>{t.status !== 'active' && <Badge tone="warn">{t.status}</Badge>}</span>}
      subtitle={t.last_settled ? <span className="inline-flex items-center gap-2">Last flop, hand #{pad3(t.last_settled.hand_no)}: <FlopText cards={t.last_settled.flop} /></span> : 'No hand settled yet.'}>
      {!r ? <p className="text-sm text-muted">No hand yet. One opens within a few seconds while the table is active.</p> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="font-medium">Hand #{pad3(r.hand_no)}</span>
            <RoundStateBadge state={r.state} />
            <span className="text-muted"><span className="tabular-nums text-ink">{r.bets}</span> bets · <span className="tabular-nums text-ink">{formatMoney(r.staked_minor, t.currency)}</span> staked</span>
            {left !== null && <span className={left < 60 ? 'text-danger' : 'text-muted'} role="timer">Enter the flop within {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} or the hand is voided and refunded</span>}
          </div>

          {r.state === 'OPEN' && (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => lock.mutate(undefined)} disabled={lock.isPending}><Lock size={16} aria-hidden />Close betting</Button>
              <span className="text-sm text-muted">Close betting before the flop is dealt. You can type the cards once betting is closed.</span>
            </div>
          )}

          {r.state === 'LOCKED' && (
            <div className="space-y-3">
              <WebcamReader onReading={(reading) => setPicked(reading.cards.slice(0, 3))} />
              <CardPicker picked={picked} onToggle={(c) => setPicked((p) => toggleCard(p, c))} />
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-muted">Flop: {picked.length ? <FlopText cards={picked} /> : 'pick three cards'}</span>
                <Button onClick={() => setConfirming(true)} disabled={picked.length !== 3 || settle.isPending}>Settle hand</Button>
                {picked.length > 0 && <Button variant="secondary" size="sm" onClick={() => setPicked([])}>Clear</Button>}
              </div>
            </div>
          )}

          {(r.state === 'SETTLED' || r.state === 'VOID') && (
            <p className="text-sm text-muted">{r.state === 'VOID' ? `Hand voided${r.void_reason ? `: ${r.void_reason}` : ''}; every bet was refunded.` : 'Hand settled.'} The next hand opens within a few seconds.</p>
          )}
        </div>
      )}

      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} busy={settle.isPending} danger={false}
        title={`Settle hand #${r ? pad3(r.hand_no) : ''}?`} confirmLabel="Settle and pay"
        onConfirm={() => settle.mutate(picked)}>
        The flop is <strong>{picked.map(cardLabel).join(' ')}</strong>. Winning bets are paid at once; this can't be undone.
      </ConfirmDialog>
    </Section>
  );
}

/** 52 buttons, a row per suit. Up to three can be picked; a second tap unpicks. */
function CardPicker({ picked, onToggle }: { picked: readonly string[]; onToggle: (card: string) => void }) {
  return (
    <div className="space-y-1.5 overflow-x-auto" role="group" aria-label="Flop cards">
      {SUITS.map((s) => (
        <div key={s.id} className="flex gap-1.5">
          {RANKS.map((rank) => {
            const card = `${rank}${s.id}`;
            const on = picked.includes(card);
            const full = picked.length >= 3 && !on;
            return (
              <button key={card} type="button" onClick={() => onToggle(card)} disabled={full} aria-pressed={on}
                aria-label={`${rank === 'T' ? '10' : rank} of ${s.name}`}
                className={`h-10 min-w-[2.5rem] rounded-[8px] border text-sm font-semibold tabular-nums transition-colors
                  ${on ? 'border-accent bg-accent/15' : 'border-line-strong hover:border-accent'} ${s.red ? 'text-danger' : 'text-ink'} disabled:opacity-35`}>
                {cardLabel(card)}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Camera preview (docs/19): the laptop camera pointed at the dealt cards, shown beside the picker so
 * the operator types what the camera sees. Card recognition will run in this browser, on this
 * laptop, with no outside service; until then the picker is filled by hand. Works only over https
 * or on localhost (the browser rule for cameras).
 */
function WebcamReader({ onReading: _onReading }: { onReading: (r: { cards: string[] }) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [stream]);

  const start = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError('This browser gives no camera access here; the console must be opened over https.'); return; }
    try {
      setStream(await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }));
    } catch (e) {
      setCameraError(e instanceof Error && e.name === 'NotAllowedError' ? 'Camera access was refused. Allow the camera for this site and try again.' : `Camera unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="rounded-[10px] border border-line p-3">
      <div className="flex flex-wrap items-center gap-3">
        {stream
          ? <Button size="sm" variant="secondary" onClick={() => setStream(null)}><CameraOff size={14} aria-hidden />Stop camera</Button>
          : <Button size="sm" variant="secondary" onClick={() => void start()}><Camera size={14} aria-hidden />Use webcam</Button>}
        <span className="text-xs text-muted">Point the camera at the three cards and pick them below. Nothing leaves this laptop.</span>
      </div>
      {cameraError && <p className="mt-2 text-xs text-danger">{cameraError}</p>}
      {stream && <video ref={video} autoPlay playsInline muted className="mt-3 aspect-video w-full max-w-md rounded-[8px] border border-line bg-black" aria-label="Webcam view of the table" />}
    </div>
  );
}
