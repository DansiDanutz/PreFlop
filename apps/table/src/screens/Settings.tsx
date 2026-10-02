import { KeyRound, Lock, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { BigButton, Choice, HoldButton, Sheet } from '../components/controls.tsx';
import { groupFingerprint } from '../lib/envelope.ts';
import { type Identity, ROLE_LABEL, deleteIdentity, saveIdentity } from '../lib/keystore.ts';
import { DEFAULT_IDLE_MIN, IDLE_CHOICES_MIN, localLockoutStore } from '../lib/lock.ts';
import { PinSetup } from './Lock.tsx';

/** "Reset this tablet": deletes the private key after a confirm + 1.5 s hold. */
export function ResetTablet({ onReset, compact }: { onReset: () => void; compact?: boolean }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <BigButton tone="neutral" className={compact ? 'w-full text-base' : 'w-full'} onClick={() => setConfirm(true)}>
        <Trash2 className="h-5 w-5 text-danger" /> Reset this tablet
      </BigButton>
      {confirm && (
        <Sheet title="Reset this tablet?" onClose={() => setConfirm(false)}>
          <p className="text-base text-muted">The signing key is deleted from this tablet and cannot be recovered. The club admin must revoke the old credential and enroll a new key.</p>
          <div className="mt-6 flex gap-3">
            <BigButton tone="neutral" className="flex-1" onClick={() => setConfirm(false)}>Cancel</BigButton>
            <HoldButton tone="danger" ms={1500} className="flex-1 text-lg" onHold={async () => { await deleteIdentity(); localLockoutStore().set(null); onReset(); }}>Delete key</HoldButton>
          </div>
        </Sheet>
      )}
    </>
  );
}

export function SettingsSheet({ id, clockOffsetMs, onClose, onReset, onLockNow, onIdentity }: {
  id: Identity; clockOffsetMs: number; onClose: () => void; onReset: () => void; onLockNow: () => void; onIdentity: (next: Identity) => void;
}) {
  const c = id.config;
  const [changing, setChanging] = useState(false);
  const idle = id.idleMinutes ?? DEFAULT_IDLE_MIN;
  const setIdle = async (m: number) => {
    const next = { ...id, idleMinutes: m };
    await saveIdentity(next);
    onIdentity(next);
  };
  if (changing) {
    return (
      <Sheet title="Change PIN" onClose={() => setChanging(false)}>
        <PinSetup id={id} change onCancel={() => setChanging(false)} onDone={(next) => { onIdentity(next); setChanging(false); }} />
      </Sheet>
    );
  }
  const rows: [string, string][] = [
    ['Role', ROLE_LABEL[c.role]], ['Person', c.personId], ['Table', c.tableId], ['Credential', c.credentialId ?? '—'],
    ['Key fingerprint', groupFingerprint(c.fingerprint)], ['API', c.apiUrl], ['Clock offset', `${(clockOffsetMs / 1000).toFixed(1)} s`],
  ];
  return (
    <Sheet title="This tablet" onClose={onClose}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-base">
        {rows.map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="selectable break-all font-mono text-[15px]">{v}</dd></div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-faint">The private key is non-extractable and stays in this browser's storage.</p>
      <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5">
        <div className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">Lock after idle</div>
        <Choice options={IDLE_CHOICES_MIN.map(String) as readonly string[]} value={String(idle)} onChange={(v) => void setIdle(Number(v))} render={(v) => `${v} min`} cols={4} />
        <div className="grid grid-cols-2 gap-3">
          <BigButton tone="neutral" onClick={() => setChanging(true)} data-testid="change-pin"><KeyRound className="h-5 w-5" /> Change PIN</BigButton>
          <BigButton tone="neutral" onClick={() => { onClose(); onLockNow(); }} data-testid="lock-now"><Lock className="h-5 w-5" /> Lock now</BigButton>
        </div>
      </div>
      <div className="mt-6"><ResetTablet onReset={onReset} /></div>
    </Sheet>
  );
}
