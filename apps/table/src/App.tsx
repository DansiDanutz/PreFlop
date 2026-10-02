import { Spinner } from '@preflop/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from './components/Header.tsx';
import { type Action, ApiProblem, TableApi } from './lib/api.ts';
import { useMyEntries, useRunner, useTableState } from './lib/hooks.ts';
import { type Identity, loadIdentity } from './lib/keystore.ts';
import type { Round } from './lib/types.ts';
import { DealerScreen } from './screens/Dealer.tsx';
import { Enrollment } from './screens/Enrollment.tsx';
import { FloorScreen } from './screens/Floor.tsx';
import { ManagerScreen } from './screens/Manager.tsx';
import { SettingsSheet } from './screens/Settings.tsx';
import { Setup } from './screens/Setup.tsx';

export function App() {
  const [id, setId] = useState<Identity | null | undefined>(undefined);
  useEffect(() => {
    loadIdentity().then((x) => setId(x ?? null), () => setId(null));
  }, []);
  if (id === undefined) return <div className="grid h-full place-items-center"><Spinner className="h-10 w-10" /></div>;
  if (!id) return <Setup onDone={setId} />;
  if (!id.config.credentialId) return <Enrollment id={id} onEnrolled={setId} onReset={() => setId(null)} />;
  return <TableShell key={id.config.credentialId} id={id} onReset={() => setId(null)} />;
}

const FLOP_PATH = /\/hands\/(\d+)\/flop$/;

function TableShell({ id, onReset }: { id: Identity; onReset: () => void }) {
  const api = useMemo(() => new TableApi(id), [id]);
  const [offset, setOffset] = useState(0);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    const sync = () => api.syncClock().then(setOffset, () => {});
    void sync();
    const h = setInterval(sync, 5 * 60_000);
    return () => clearInterval(h);
  }, [api]);
  const live = useTableState(api);
  const cred = id.config.credentialId!;
  const { mem, remember } = useMyEntries(cred);

  const roundOf = (a: Action) => {
    const m = FLOP_PATH.exec(a.path);
    return m ? `${id.config.tableId}:h${m[1]}` : null;
  };
  const onDone = useCallback((a: Action) => {
    const rid = roundOf(a);
    if (rid) remember(rid, (JSON.parse(a.body) as { cards: string[] }).cards);
    live.refresh();
  }, [remember, live]); // eslint-disable-line react-hooks/exhaustive-deps
  const onProblem = useCallback((a: Action, p: ApiProblem) => {
    // An entry for this side already exists (another tablet, or an earlier session): stop asking.
    const rid = roundOf(a);
    if (rid && p.type === 'duplicate_entry') remember(rid, []);
    live.refresh();
    return false;
  }, [remember, live]); // eslint-disable-line react-hooks/exhaustive-deps
  const runner = useRunner(api, onDone, onProblem);
  const submitFlop = (r: Round, cards: string[]) => void runner.run(api.flop(r.hand_no, cards));

  const role = id.config.role;
  return (
    <div className="flex h-full flex-col">
      <Header live={live} role={role} personId={id.config.personId} tableId={id.config.tableId} clockOffsetMs={offset} onSettings={() => setSettings(true)} />
      {live.error && ['credential_revoked', 'unknown_credential', 'bad_signature', 'forbidden_table', 'stale_request'].includes(live.error.type) && (
        <div role="alert" className="border-b border-danger/50 bg-danger/15 px-5 py-3 text-base font-semibold text-danger">{live.error.message}</div>
      )}
      <main className="min-h-0 flex-1 overflow-auto">
        {role === 'dealer' && <DealerScreen api={api} live={live} mem={mem} runner={runner} submitFlop={submitFlop} />}
        {role === 'floor' && <FloorScreen live={live} mem={mem} runner={runner} submitFlop={submitFlop} />}
        {role === 'floor_manager' && <ManagerScreen api={api} live={live} mem={mem} runner={runner} submitFlop={submitFlop} />}
      </main>
      {settings && <SettingsSheet id={id} clockOffsetMs={offset} onClose={() => setSettings(false)} onReset={onReset} />}
    </div>
  );
}
