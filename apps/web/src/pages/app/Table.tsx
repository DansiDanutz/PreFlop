import { useParams } from 'react-router';
import { TableScreen } from '../../components/table/TableScreen.tsx';

export function TablePage() {
  const { id = '' } = useParams();
  return <TableScreen key={id} tableId={id} />;
}
