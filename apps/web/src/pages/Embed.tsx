import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { TopBar } from '../components/AppShell.tsx';
import { RealityCheck } from '../components/PlaySession.tsx';
import { TableScreen } from '../components/table/TableScreen.tsx';
import { Notice } from '../components/ui.tsx';
import { setToken } from '../lib/api.ts';
import { useToken } from '../lib/auth.tsx';
import { accentVars, embedToken, parseEmbedParams } from '../lib/embed.ts';

/**
 * /embed/table/:id#token=…&… (or /embed?table=:id) — the table screen for partners' iframes: no
 * website chrome and no tab bar. The partner's player token (URL fragment, or ?token= from older
 * snippets) is moved into sessionStorage and removed from the address right away.
 * Partner options, all validated: accent=#rrggbb (theme colour), markets=id,id (markets shown),
 * stakes=10,50,200 (stake pills).
 */
export function EmbedTablePage() {
  const { id } = useParams();
  const [ready, setReady] = useState(false);
  const token = useToken();
  // Read once: the options stay for the life of the iframe even after the URL is cleaned.
  const opts = useMemo(() => parseEmbedParams(new URLSearchParams(window.location.search)), []);
  const tableId = id || opts.table || '';

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const t = embedToken(search, window.location.hash);
    if (t) {
      setToken(t);
      search.delete('token');
      const qs = search.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }
    setReady(true);
  }, []);

  // The partner's colour, on the root so sheets and dialogs pick it up too (set through the CSSOM,
  // which the Content-Security-Policy allows; no inline style element).
  useEffect(() => {
    if (!opts.accent) return;
    const root = document.documentElement.style;
    const vars = accentVars(opts.accent);
    for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
    return () => { for (const k of Object.keys(vars)) root.removeProperty(k); };
  }, [opts.accent]);

  if (!ready) return null;
  return (
    <div className="mx-auto min-h-dvh max-w-[560px]">
      <TopBar embed />
      {!token && <div className="px-5 pb-4"><Notice tone="warn">Sign-in required: this widget needs a player token from the partner site.</Notice></div>}
      {tableId
        ? <TableScreen key={tableId} tableId={tableId} embed embedOptions={{ markets: opts.markets, stakes: opts.stakes }} />
        : <div className="px-5"><Notice tone="warn">No table selected for this widget.</Notice></div>}
      {token && <RealityCheck embed />}
    </div>
  );
}
