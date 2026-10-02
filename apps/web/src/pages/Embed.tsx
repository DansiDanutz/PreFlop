import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { TopBar } from '../components/AppShell.tsx';
import { TableScreen } from '../components/table/TableScreen.tsx';
import { Notice } from '../components/ui.tsx';
import { setToken } from '../lib/api.ts';
import { useToken } from '../lib/auth.tsx';

/**
 * /embed/table/:id?token=… — the table screen for partners' iframes: no website chrome and no
 * tab bar. The partner's player token is moved from the URL into sessionStorage right away.
 */
export function EmbedTablePage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [ready, setReady] = useState(false);
  const token = useToken();

  useEffect(() => {
    const t = params.get('token');
    if (t) {
      setToken(t);
      params.delete('token');
      setParams(params, { replace: true });
    }
    setReady(true);
  }, [params, setParams]);

  if (!ready) return null;
  return (
    <div className="mx-auto min-h-dvh max-w-[560px]">
      <TopBar embed />
      {!token && <div className="px-5 pb-4"><Notice tone="warn">Sign-in required: this widget needs a player token from the partner site.</Notice></div>}
      <TableScreen key={id} tableId={id} embed />
    </div>
  );
}
