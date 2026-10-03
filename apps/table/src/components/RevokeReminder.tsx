import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { type RetiredCredential, confirmRevoked, localRetiredStore, revokeInstruction } from '../lib/handover.ts';
import { groupFingerprint } from '../lib/envelope.ts';
import { ROLE_LABEL } from '../lib/keystore.ts';
import { HoldButton } from './controls.tsx';

/**
 * "Revoke the old credential" prompt, shown after a reset or re-enrollment (setup, enrollment and
 * settings) until someone confirms the club admin revoked it. `except` hides the credential this
 * tablet is using now.
 */
export function RevokeReminder({ except }: { except?: string | undefined }) {
  const store = localRetiredStore();
  const [list, setList] = useState<RetiredCredential[]>(() => store.get());
  const shown = list.filter((r) => !except || r.credentialId !== except);
  if (!shown.length) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="revoke-reminder">
      {shown.map((r) => (
        <div key={`${r.fingerprint}-${r.credentialId}`} role="alert" className="flex flex-col gap-3 rounded-[16px] border border-warn/60 bg-warn/10 px-5 py-4 text-base">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-warn"><ShieldAlert className="h-5 w-5" /> Old credential still active: ask the club admin to revoke it</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1">
            <dt className="text-muted">Credential</dt><dd className="selectable break-all font-mono text-lg font-bold" data-testid="revoke-cred-id">{r.credentialId ?? 'not verified on this tablet'}</dd>
            <dt className="text-muted">Who</dt><dd>{ROLE_LABEL[r.role]} · {r.personId} · table <b>{r.tableId}</b></dd>
            {!r.credentialId && <><dt className="text-muted">Key</dt><dd className="font-mono">{groupFingerprint(r.fingerprint)}</dd></>}
          </dl>
          <p className="text-sm text-muted">{revokeInstruction(r)} The console list shows person, role and table: match those to find the row.</p>
          <HoldButton tone="neutral" ms={900} className="text-base" hint="Press and hold once it is revoked" onHold={() => setList(confirmRevoked(r, store))}>
            The club admin revoked it
          </HoldButton>
        </div>
      ))}
    </div>
  );
}
