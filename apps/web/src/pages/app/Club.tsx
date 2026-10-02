import type { TableSummary } from '@preflop/client';
import { EmptyState, cx } from '@preflop/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Star } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { TableCard, tableGrid } from '../../components/TableCards.tsx';
import { ErrorState, Skeleton } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { isNotImplemented } from '../../lib/problems.ts';
import { qk, useFavoriteClubs, useLobby, useSavedTables } from '../../lib/queries.ts';
import { Monogram } from './Clubs.tsx';

export function ClubPage() {
  const { id = '' } = useParams();
  const club = useQuery({ queryKey: qk.club(id), queryFn: () => api.club(id) });
  const lobby = useLobby();
  const favs = useFavoriteClubs();
  const saved = useSavedTables();
  // Live table state comes from the lobby stream; the club endpoint gives the header.
  const live = (lobby.data?.tables ?? []).filter((t) => t.club_id === id);
  const tables: TableSummary[] = live.length ? live : club.data ? [...club.data.tables] : [];
  const back = (
    <Link to="/app/clubs" className="inline-flex items-center gap-1.5 text-[14px] text-ink/85 hover:text-ink">
      <ChevronLeft className="h-4 w-4" aria-hidden /> All clubs
    </Link>
  );

  if (club.isError) {
    return (
      <div className="space-y-6">
        {back}
        <ErrorState title={isNotImplemented(club.error) ? 'Club not found' : 'Could not load this club'} onRetry={() => void club.refetch()} />
      </div>
    );
  }
  const fav = favs.has(id);
  const c = club.data;
  return (
    <div>
      {back}
      <header className="mt-8 flex flex-col gap-6 border-b border-line pb-10 sm:flex-row sm:items-center">
        {c ? <Monogram name={c.name} size="lg" /> : <Skeleton className="h-[104px] w-[104px] rounded-full" />}
        <div className="min-w-0 flex-1 sm:pl-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Organizer</p>
          {c ? (
            <>
              <h1 className="mt-2 font-serif text-[36px] leading-tight tracking-[-0.045em] lg:text-[42px]">{c.name}</h1>
              <p className="mt-1.5 text-[15px] text-ink/85">{[c.city, c.country].filter(Boolean).join(' · ') || 'Online'}</p>
            </>
          ) : (
            <><Skeleton className="mt-2 h-10 w-72" /><Skeleton className="mt-2 h-4 w-36" /></>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-[6px] border border-line-strong px-2.5 py-1.5 text-[12px] font-semibold">
            {tables.length} {tables.length === 1 ? 'table' : 'tables'}
          </span>
          <button type="button" onClick={() => favs.toggle(id)} aria-pressed={fav} aria-label={fav ? 'Remove club from favorites' : 'Add club to favorites'}
            className="grid h-10 w-10 place-items-center rounded-full border border-line-strong hover:border-accent">
            <Star className={cx('h-[18px] w-[18px]', fav ? 'fill-accent text-accent' : 'text-muted')} strokeWidth={1.7} />
          </button>
        </div>
      </header>

      <section aria-labelledby="club-tables" className="mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="club-tables" className="text-[20px] font-bold">Choose a table</h2>
          {tables.some((t) => t.kind === 'simulated') && <span className="text-[13px] text-ink/80">Simulated play · No live club connection</span>}
        </div>
        {club.data && tables.length === 0 && <div className="mt-5"><EmptyState title="No tables yet">This club has not opened a table on PreFlop.</EmptyState></div>}
        <ul className={cx(tableGrid, 'mt-5')}>
          {club.isLoading && [0, 1].map((i) => <li key={i}><Skeleton className="h-[388px]" /></li>)}
          {tables.map((t) => <li key={t.id} className="flex"><TableCard t={t} saved={saved.has(t.id)} onToggleSave={() => saved.toggle(t.id)} /></li>)}
        </ul>
      </section>
    </div>
  );
}
