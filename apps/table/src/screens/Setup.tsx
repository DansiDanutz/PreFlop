import { Wordmark } from '@preflop/ui';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { BigButton, Choice } from '../components/controls.tsx';
import { RevokeReminder } from '../components/RevokeReminder.tsx';
import { DEFAULT_API_URL } from '../lib/api.ts';
import { generateCredentialKey, publicKeyFingerprint, publicKeyPem } from '../lib/envelope.ts';
import { type Identity, ROLE_LABEL, type Role, saveIdentity } from '../lib/keystore.ts';

const ROLES: Role[] = ['dealer', 'floor', 'floor_manager'];

function Field({ label, hint, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">{label}</span>
      <input {...p} className="h-14 rounded-[14px] border border-line-strong bg-surface-2 px-4 text-lg text-ink outline-none placeholder:text-faint focus:border-accent" />
      {hint && <span className="text-sm text-faint">{hint}</span>}
    </label>
  );
}

export function Setup({ onDone }: { onDone: (id: Identity) => void }) {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [tableId, setTableId] = useState('');
  const [personId, setPersonId] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = /^https?:\/\/.+/.test(apiUrl.trim()) && tableId.trim() && personId.trim() && role;

  const create = async () => {
    if (!ok || !role) return;
    setBusy(true);
    setErr(null);
    try {
      const keys = await generateCredentialKey();
      const id: Identity = {
        keys,
        config: {
          apiUrl: apiUrl.trim().replace(/\/+$/, ''), tableId: tableId.trim(), personId: personId.trim(), role,
          publicKeyPem: await publicKeyPem(keys.publicKey), fingerprint: await publicKeyFingerprint(keys.publicKey), createdAt: Date.now(),
        },
      };
      await saveIdentity(id);
      onDone(id);
    } catch (e) {
      setErr(`This browser cannot create an Ed25519 key (${(e as Error).message}). Use an up-to-date Chrome or Safari.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center p-6">
      <div className="grid w-full max-w-5xl gap-10 md:grid-cols-[1fr_1.3fr]">
        <div className="md:col-span-2"><RevokeReminder /></div>
        <div className="flex flex-col justify-center gap-6">
          <Wordmark size="lg" />
          <h1 className="font-serif text-5xl leading-[1.05]">Set up this table tablet</h1>
          <p className="text-lg text-muted">One tablet credential per person and role, for one table. The signing key is created on this tablet and never leaves it.</p>
          <ul className="flex flex-col gap-3 text-base text-muted">
            <li className="flex items-center gap-3"><KeyRound className="h-5 w-5 text-accent" /> Ed25519 key, locked to this device</li>
            <li className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-accent" /> Every action is signed and single-use</li>
          </ul>
        </div>
        <form className="flex flex-col gap-5 rounded-[22px] border border-line bg-surface p-7" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <Field label="PreFlop API" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} inputMode="url" autoComplete="off" spellCheck={false} name="apiUrl" />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Table id" value={tableId} onChange={(e) => setTableId(e.target.value)} placeholder="e.g. atlas-t04" autoComplete="off" spellCheck={false} name="tableId" />
            <Field label="Your name or badge" value={personId} onChange={(e) => setPersonId(e.target.value)} placeholder="e.g. Ana · D-117" autoComplete="off" name="personId" />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">Your role at this table</span>
            <Choice options={ROLES} value={role} onChange={setRole} render={(r) => ROLE_LABEL[r]} />
          </div>
          {err && <div className="rounded-[12px] border border-danger/50 bg-danger/10 px-4 py-3 text-danger">{err}</div>}
          <BigButton type="submit" disabled={!ok} busy={busy} className="mt-2 text-xl" data-testid="create-key">
            <KeyRound className="h-6 w-6" /> Create tablet key
          </BigButton>
        </form>
      </div>
    </div>
  );
}
