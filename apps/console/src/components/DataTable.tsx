import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cx } from '@preflop/ui';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Sort key; omit to make the column unsortable. */
  sort?: (row: T) => number | string | null | undefined;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

export function sortRows<T>(rows: readonly T[], col: Column<T> | undefined, dir: 'asc' | 'desc'): T[] {
  if (!col?.sort) return [...rows];
  const f = col.sort;
  const m = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = f(a);
    const y = f(b);
    if (x === y) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * m;
  });
}

export function DataTable<T>({ rows, columns, rowKey, initialSort, empty, onRowClick, caption, dense, rowClassName }: {
  rows: readonly T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  empty?: ReactNode;
  onRowClick?: ((row: T) => void) | undefined;
  caption?: string;
  dense?: boolean;
  rowClassName?: (row: T) => string | undefined;
}) {
  const [sort, setSort] = useState<SortState>(initialSort ?? null);
  const sorted = useMemo(() => (sort ? sortRows(rows, columns.find((c) => c.key === sort.key), sort.dir) : rows), [rows, columns, sort]);

  if (!rows.length) {
    return <div className="rounded-[14px] border border-dashed border-line-strong px-6 py-10 text-center text-sm text-muted">{empty ?? 'Nothing here yet.'}</div>;
  }

  const toggle = (k: string) =>
    setSort((s) => (s?.key === k ? (s.dir === 'desc' ? { key: k, dir: 'asc' } : null) : { key: k, dir: 'desc' }));

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full border-separate border-spacing-0 text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const aria = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined;
              return (
                <th key={c.key} scope="col" aria-sort={aria}
                  className={cx('sticky top-0 whitespace-nowrap border-b border-line bg-surface px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint',
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left', c.className)}>
                  {c.sort ? (
                    <button type="button" onClick={() => toggle(c.key)} className={cx('inline-flex items-center gap-1 uppercase hover:text-ink', active && 'text-ink', c.align === 'right' && 'flex-row-reverse')}>
                      {c.header}
                      {active ? (sort!.dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />) : <ArrowUpDown size={12} className="opacity-40" aria-hidden />}
                    </button>
                  ) : c.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)}
              {...(onRowClick ? { tabIndex: 0, onClick: () => onRowClick(r), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') onRowClick(r); } } : {})}
              className={cx('group', onRowClick && 'cursor-pointer outline-none focus-visible:bg-surface-2', rowClassName?.(r))}>
              {columns.map((c) => (
                <td key={c.key} className={cx('border-b border-line/60 px-3 align-middle tabular-nums group-hover:bg-surface-2/60', dense ? 'py-2' : 'py-3',
                  c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left', c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
