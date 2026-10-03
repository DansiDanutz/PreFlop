import { KeyRound, Lock, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { BigButton, Choice, HoldButton, Sheet } from '../components/controls.tsx';
import { RevokeReminder } from '../components/RevokeReminder.tsx';
import { groupFingerprint } from '../lib/envelope.ts';
import { CONSOLE_REVOKE_PATH, localRetiredStore, retireCredential } from '../lib/handover.ts';
import { type Identity, ROLE_LABEL, type TabletConfig, deleteIdentity, saveIdentity } from '../lib/keystore.ts';
import { DEFAULT_IDLE_MIN, IDLE_CHOICES_MIN, localLockoutStore } from '../lib/lock.ts';
import { PinSetup } from './Lock.tsx';

/**
 * "Reset this tablet": deletes the private key after a confirm + 1.5 s hold. The credential it
 * signed with is remembered (lib/handover.ts) so the next screens keep asking the club admin to
 * revoke it.
 */
export function ResetTablet({ config, onReset, compact }: { config: TabletConfig; onReset: () => void; compact?: boolean }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <BigButton tone="neutral" className={compact ? 'w-full text-base' : 'w-full'} onClick={() => setConfirm(true)}>
        <Trash2 className="h-5 w-5 text-danger" /> Reset this tablet
      </BigButton>
      {confirm && (
        <Sheet title="Reset this tablet?" onClose={() => setConfirm(false)}>
          <p className="text-base text-muted">The signing key is deleted from this tablet and cannot be recovered.</p>
          <div className="mt-4 rounded-[14px] border border-warn/60 bg-warn/10 px-4 py-3 text-base" data-testid="reset-revoke-note">
            <div className="flex items-center gap-2 font-semibold text-warn"><ShieldAlert className="h-5 w-5" /> Then the club admin must revoke</div>
            <div className="mt-1 break-all font-mono text-lg font-bold">{config.credentialId ?? `key ${groupFingerprint(config.fingerprint)} (not verified yet)`}</div>
            <div className="text-sm text-muted">{ROLE_LABEL[config.role]} · {config.personId} · table {config.tableId}</div>
            <div className="mt-2 text-sm text-muted">In {CONSOLE_REVOKE_PATH}. Deleting the key here does not revoke it on the server. This tablet will remind you until it is done.</div>
          </div>
          <div className="mt-6 flex gap-3">
            <BigButton tone="neutral" className="flex-1" onClick={() => setConfirm(false)}>Cancel</BigButton>
            <HoldButton tone="danger" ms={1500} className="flex-1 text-lg" onHold={async () => { retireCredential(config, localRetiredStore()); await deleteIdentity(); localLockoutStore().set(null); onReset(); }}>Delete key</HoldButton>
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
    ['Table', c.tableId], ['Key fingerprint', groupFingerprint(c.fingerprint)], ['API', c.apiUrl], ['Clock offset', `${(clockOffsetMs / 1000).toFixed(1)} s`],
  ];
  return (
    <Sheet title="This tablet" onClose={onClose}>
      {/* Who this tablet signs as: the first thing to check at a shift handover. */}
      <div className="mb-5 rounded-[16px] border border-accent/40 bg-accent-soft px-5 py-4" data-testid="settings-identity">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Signs as</div>
        <div className="mt-1 text-2xl font-bold"><span data-testid="settings-person">{c.personId}</span> · <span data-testid="settings-role">{ROLE_LABEL[c.role]}</span></div>
        <div className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted">Credential id</div>
        <div className="selectable break-all font-mono text-xl font-bold" data-testid="settings-credential">{c.credentialId ?? '—'}</div>
        <p className="mt-2 text-sm text-muted">Every action from this tablet is signed as this person. At a shift change the next person does not use it: they enroll their own tablet key, and if this tablet is reset, the club admin revokes this credential id.</p>
      </div>
      <div className="mb-5"><RevokeReminder except={c.credentialId} /></div>
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
      <div className="mt-6"><ResetTablet config={c} onReset={onReset} /></div>
    </Sheet>
  );
}
