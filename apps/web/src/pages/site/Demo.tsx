import { useMemo } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { TableScreen } from '../../components/table/TableScreen.tsx';
import { ErrorState, Skeleton } from '../../components/ui.tsx';
import { useToken } from '../../lib/auth.tsx';
import { useLobby } from '../../lib/queries.ts';

/**
 * /demo: the practice table, live and read-only, for visitors who have not signed up. Everything it
 * shows comes from the public API (lobby, table, book, public stream topics); betting needs an
 * account, so the bet panel is a "Play free" call to action. Signed-in players go to the real table.
 */
export function DemoPage() {
  const token = useToken();
  const [params] = useSearchParams();
  const lobby = useLobby();
  const wanted = params.get('table');
  const table = useMemo(() => {
    const tables = (lobby.data?.tables ?? []).filter((t) => t.status === 'active' && t.kind === 'simulated');
    return tables.find((t) => t.id === wanted) ?? tables.find((t) => t.open_round_id) ?? tables[0] ?? null;
  }, [lobby.data, wanted]);
  if (token && table) return <Navigate to={`/app/table/${table.id}`} replace />;
  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-16 pt-8">
      {lobby.isLoading ? <Skeleton className="h-[60vh]" />
        : !table ? (
          <ErrorState title="No practice table is dealing right now" onRetry={() => void lobby.refetch()}>
            Try again in a minute, or <Link to="/register" className="text-accent underline">create a free account</Link> to be ready for the next flop.
          </ErrorState>
        ) : <TableScreen key={table.id} tableId={table.id} guest />}
    </div>
  );
}
