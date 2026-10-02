import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Wordmark } from '@preflop/ui';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { errorMessage } from '../lib/format.ts';
import { portalPath } from '../lib/portals.ts';
import { Callout } from '../components/ui.tsx';

/** Redeems a single-use owner link from PreFlop: the signed-in account becomes an owner of the organization. */
export function ClaimPage() {
  const { token = '' } = useParams();
  const { me } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const claim = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.claimOrg(token);
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav(portalPath(r.kind, r.org_id), { replace: true });
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-screen place-items-center bg-bg px-4 py-10">
      <Card className="w-full max-w-md p-7">
        <Wordmark />
        <h1 className="mt-6 font-serif text-3xl tracking-[-0.02em]">Take over your organization</h1>
        <p className="mt-3 text-sm text-ink/85">
          PreFlop sent you this link. Opening it makes <strong>{me?.display_name}</strong> ({me?.email}) an owner. It works once.
        </p>
        <p className="mt-2 text-xs text-muted">Not the right account? Sign out from the switcher first, then open the link again.</p>
        {err && <div className="mt-4"><Callout tone="danger" title="This link did not work">{err}</Callout></div>}
        <Button className="mt-6 w-full" disabled={busy || !token} onClick={claim}>{busy ? 'Taking over…' : 'Become owner'}</Button>
      </Card>
    </div>
  );
}
