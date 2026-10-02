import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { BigButton, HoldButton, Sheet } from '../components/controls.tsx';
import { groupFingerprint } from '../lib/envelope.ts';
import { type Identity, ROLE_LABEL, deleteIdentity } from '../lib/keystore.ts';

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
            <HoldButton tone="danger" ms={1500} className="flex-1 text-lg" onHold={async () => { await deleteIdentity(); onReset(); }}>Delete key</HoldButton>
          </div>
        </Sheet>
      )}
    </>
  );
}

export function SettingsSheet({ id, clockOffsetMs, onClose, onReset }: { id: Identity; clockOffsetMs: number; onClose: () => void; onReset: () => void }) {
  const c = id.config;
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
      <div className="mt-6"><ResetTablet onReset={onReset} /></div>
    </Sheet>
  );
}
