import { EmptyState, cx } from '@preflop/ui';
import { ChevronRight, MapPin, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/AppShell.tsx';
import { ErrorState, SearchField, Skeleton } from '../../components/ui.tsx';
import { tableStatus } from '../../lib/live.ts';
import { useFavoriteClubs, useLobby } from '../../lib/queries.ts';

export function Monogram({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span aria-hidden className={cx('grid shrink-0 place-items-center rounded-full border border-accent/30 bg-accent-deep font-serif text-ink shadow-[0_0_0_6px_rgba(23,59,42,0.45),0_0_0_7px_rgba(83,230,167,0.18)]',
      size === 'lg' ? 'h-[104px] w-[104px] text-[52px]' : 'h-14 w-14 text-[26px]')}>
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
    <div>
      <PageHeader eyebrow="Rooms with character" title="The clubs." subtitle="Poker clubs and practice rooms dealing on PreFlop. Every table shows its organizer." />
      <div className="mt-8 max-w-[560px]"><SearchField value={q} onChange={setQ} placeholder="Search clubs or cities" label="Search clubs" /></div>
      <div className="mt-6 border-t border-line pt-6">
        {lobby.isError && <ErrorState title="Could not load clubs" onRetry={() => void lobby.refetch()} />}
        {lobby.data && clubs.length === 0 && <EmptyState title="No clubs match">Try another search.</EmptyState>}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2 xl:grid-cols-3 [&>li]:min-w-0">
          {lobby.isLoading && [0, 1, 2].map((i) => <li key={i}><Skeleton className="h-[176px]" /></li>)}
          {clubs.map((c) => {
            const clubTables = (lobby.data?.tables ?? []).filter((t) => t.club_id === c.id);
            const open = clubTables.filter((t) => tableStatus(t).open).length;
            const fav = favs.has(c.id);
            return (
              <li key={c.id} className="flex">
                <article className="flex w-full flex-col rounded-[12px] border border-line-strong/60 bg-surface p-5">
                  <div className="flex items-start gap-4">
                    <Monogram name={c.name} />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-serif text-[22px] leading-tight tracking-[-0.03em]">{c.name}</h2>
                      <p className="mt-1 flex items-center gap-1 text-[13px] text-muted"><MapPin className="h-3.5 w-3.5" aria-hidden /> {c.city ?? 'Online'}</p>
                    </div>
                    <button type="button" onClick={() => favs.toggle(c.id)} aria-pressed={fav} aria-label={fav ? `Remove ${c.name} from favorites` : `Add ${c.name} to favorites`}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-strong/70 text-muted hover:text-accent">
                      <Star className={cx('h-[18px] w-[18px]', fav && 'fill-accent text-accent')} strokeWidth={1.7} />
                    </button>
                  </div>
                  <div className="mt-5 flex flex-1 items-end justify-between gap-3 border-t border-line pt-4">
                    <span className="text-[13px] text-ink/80">
                      {c.tables} {c.tables === 1 ? 'table' : 'tables'}{open > 0 && <span className="text-accent"> · {open} open now</span>}
                    </span>
                    <Link to={`/app/clubs/${c.id}`} className="inline-flex h-10 items-center gap-1.5 rounded-[8px] border border-line-strong px-3.5 text-[14px] font-semibold hover:border-accent hover:text-accent">
                      Visit club <ChevronRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
