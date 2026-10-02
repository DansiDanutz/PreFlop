import { Card, EmptyState, cx } from '@preflop/ui';
import { ChevronRight, MapPin, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ErrorState, SearchField, SerifHeading, Skeleton } from '../../components/ui.tsx';
import { tableStatus } from '../../lib/live.ts';
import { useFavoriteClubs, useLobby } from '../../lib/queries.ts';

export function Monogram({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span aria-hidden className={cx('grid shrink-0 place-items-center rounded-full border-2 border-accent bg-surface-2 font-serif text-ink shadow-[0_0_0_4px_rgba(31,211,139,0.12)]',
      size === 'lg' ? 'h-16 w-16 text-3xl' : 'h-12 w-12 text-xl')}>
      {name.trim()[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

export function ClubsPage() {
  const lobby = useLobby();
  const favs = useFavoriteClubs();
  const [q, setQ] = useState('');
  const clubs = useMemo(() => {
    const w = q.toLowerCase();
    return (lobby.data?.clubs ?? []).filter((c) => `${c.name} ${c.city ?? ''}`.toLowerCase().includes(w));
  }, [lobby.data, q]);

  return (
    <div className="space-y-4 px-5 pb-6">
      <SerifHeading>Clubs</SerifHeading>
      <p className="-mt-2 text-sm text-muted">Poker clubs and practice rooms dealing on PreFlop.</p>
      <SearchField value={q} onChange={setQ} placeholder="Search clubs or cities" label="Search clubs" />
      {lobby.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}
      {lobby.isError && <ErrorState title="Could not load clubs" onRetry={() => void lobby.refetch()} />}
      {lobby.data && clubs.length === 0 && <EmptyState title="No clubs match">Try another search.</EmptyState>}
      <ul className="space-y-3">
        {clubs.map((c) => {
          const open = (lobby.data?.tables ?? []).filter((t) => t.club_id === c.id && tableStatus(t).open).length;
          return (
            <li key={c.id}>
              <Card className="flex items-center gap-3 p-4">
                <Monogram name={c.name} />
                <Link to={`/app/clubs/${c.id}`} className="min-w-0 flex-1 rounded-md">
                  <div className="truncate font-semibold">{c.name}</div>
                  <div className="flex items-center gap-1 text-[13px] text-muted">
                    <MapPin className="h-3.5 w-3.5" aria-hidden /> {c.city ?? 'Online'} · {c.tables} {c.tables === 1 ? 'table' : 'tables'}
                    {open > 0 && <span className="text-accent"> · {open} open</span>}
                  </div>
                </Link>
                <button type="button" onClick={() => favs.toggle(c.id)} aria-pressed={favs.has(c.id)} aria-label={favs.has(c.id) ? `Remove ${c.name} from favorites` : `Add ${c.name} to favorites`}
                  className="grid h-10 w-10 place-items-center rounded-full text-muted hover:text-accent">
                  <Star className={cx('h-5 w-5', favs.has(c.id) && 'fill-accent text-accent')} />
                </button>
                <Link to={`/app/clubs/${c.id}`} aria-label={`Open ${c.name}`} className="text-muted hover:text-ink"><ChevronRight className="h-5 w-5" /></Link>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
