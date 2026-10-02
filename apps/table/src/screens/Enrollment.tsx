import { Wordmark } from '@preflop/ui';
import { BadgeCheck, Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { BigButton } from '../components/controls.tsx';
import { ApiProblem, TableApi } from '../lib/api.ts';
import { enrollmentMismatch } from '../lib/enrollment.ts';
import { groupFingerprint } from '../lib/envelope.ts';
import { type Identity, ROLE_LABEL, saveIdentity } from '../lib/keystore.ts';
import { ResetTablet } from './Settings.tsx';

export function Enrollment({ id, onEnrolled, onReset }: { id: Identity; onEnrolled: (id: Identity) => void; onReset: () => void }) {
  const c = id.config;
  const [cred, setCred] = useState(c.credentialId ?? '');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(c.publicKeyPem);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = c.publicKeyPem;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const verify = async () => {
    const credentialId = cred.trim();
    if (!credentialId) return;
    setBusy(true);
    setErr(null);
    const next: Identity = { keys: id.keys, config: { ...c, credentialId } };
    const api = new TableApi(next);
    try {
      await api.syncClock().catch(() => 0);
      // The server's view of this credential must match what was set up on this tablet.
      const who = await api.whoami();
      const mismatch = enrollmentMismatch(c, who);
      if (mismatch) { setErr(mismatch); return; }
      await api.state();
      await saveIdentity(next);
      onEnrolled(next);
    } catch (e) {
      setErr(e instanceof ApiProblem ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center p-6">
      <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-[1.25fr_1fr]">
        <section className="flex flex-col gap-5 rounded-[22px] border border-line bg-surface p-7">
          <div className="flex items-center justify-between gap-4">
            <Wordmark size="sm" />
            <span className="text-sm text-muted">{ROLE_LABEL[c.role]} · {c.personId} · table <b className="text-ink">{c.tableId}</b></span>
          </div>
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Step 1 of 2</div>
            <h1 className="mt-1 font-serif text-4xl">Give this public key to the club admin</h1>
            <p className="mt-2 text-base text-muted">They enroll it in the club console (Staff → Add tablet credential). Read the fingerprint aloud to check it arrived intact. It is a public key — safe to share.</p>
          </div>
          <div className="rounded-[16px] border border-accent/40 bg-accent-soft px-5 py-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Fingerprint</div>
            <div className="mt-1 font-mono text-4xl tracking-[0.12em] text-ink" data-testid="fingerprint">{groupFingerprint(c.fingerprint)}</div>
          </div>
          <pre className="selectable overflow-auto rounded-[14px] border border-line bg-bg px-4 py-3 font-mono text-[13px] leading-relaxed text-muted" data-testid="public-pem">{c.publicKeyPem}</pre>
          <BigButton tone="neutral" onClick={() => void copy()} data-testid="copy-pem">
            {copied ? <><Check className="h-5 w-5 text-accent" /> Copied</> : <><Copy className="h-5 w-5" /> Copy public key</>}
          </BigButton>
        </section>
        <section className="flex flex-col gap-5 rounded-[22px] border border-line bg-surface p-7">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Step 2 of 2</div>
            <h2 className="mt-1 font-serif text-4xl">Enter the credential id</h2>
            <p className="mt-2 text-base text-muted">The club console shows it after enrolling the key. The tablet then makes one signed request to prove it works.</p>
          </div>
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
            <input value={cred} onChange={(e) => setCred(e.target.value)} placeholder="cred-…" autoComplete="off" spellCheck={false} name="credentialId"
              className="h-16 rounded-[14px] border border-line-strong bg-surface-2 px-4 font-mono text-xl text-ink outline-none placeholder:text-faint focus:border-accent" />
            {err && <div role="alert" className="rounded-[12px] border border-danger/50 bg-danger/10 px-4 py-3 text-base text-danger">{err}</div>}
            <BigButton type="submit" disabled={!cred.trim()} busy={busy} className="text-xl" data-testid="verify-cred">
              <BadgeCheck className="h-6 w-6" /> Verify and start
            </BigButton>
          </form>
          <div className="mt-auto border-t border-line pt-5">
            <ResetTablet onReset={onReset} compact />
          </div>
        </section>
      </div>
    </div>
  );
}
