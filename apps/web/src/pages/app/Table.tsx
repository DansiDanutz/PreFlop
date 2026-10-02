import { useMatch, useParams } from 'react-router';
import { TableScreen } from '../../components/table/TableScreen.tsx';

/** /app/table/:id, and /app/table/:id/bets which opens the bet catalogue over the table. */
export function TablePage() {
  const { id = '' } = useParams();
  const catalogue = !!useMatch('/app/table/:id/bets');
  return <TableScreen key={id} tableId={id} catalogue={catalogue} />;
}
