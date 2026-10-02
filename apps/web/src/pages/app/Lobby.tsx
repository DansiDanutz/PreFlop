import { EmptyState } from '@preflop/ui';
import { Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FreeChipsCard } from '../../components/AppShell.tsx';
import { CompactTableCard, FeaturedTableCard, TableCard } from '../../components/TableCards.tsx';
import { ErrorState, Pill, SearchField, SerifHeading, Skeleton } from '../../components/ui.tsx';
import { tableStatus } from '../../lib/live.ts';
import { useFavoriteClubs, useLobby, useRooms, useWallets } from '../../lib/queries.ts';
import { RoomCard } from '../../components/RoomCard.tsx';
import { Link } from 'react-router';

type Filter = 'all' | 'available' | 'favorites';

export function LobbyPage() {
  const lobby = useLobby();
  const favs = useFavoriteClubs();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const tables = lobby.data?.tables ?? [];
  const green = tables.find((t) => t.id === 'green-room');
  const midnight = tables.find((t) => t.id === 'midnight-room');

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return tables.filter((t) => {
      if (filter === 'available' && !tableStatus(t).open) return false;
      if (filter === 'favorites' && !favs.has(t.club_id)) return false;
      const hay = `${t.name} ${t.club_name} ${t.city ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [tables, q, filter, favs]);

  return (
    <div className="space-y-6 px-5 pb-6">
      <FreeChipsCard tagline={0} />

      {(lobby.isLoading || green || midnight) && (
        <section aria-labelledby="choose" className="space-y-3">
          <div>
            <SerifHeading as="h1" className="text-[28px]"><span id="choose">Choose your table</span></SerifHeading>
            <p className="mt-1 text-sm text-muted">Two tables. Same game. Your pace.</p>
          </div>
          {lobby.isLoading ? (
            <>
              <Skeleton className="h-[330px]" />
              <Skeleton className="h-24" />
            </>
          ) : (
            <>
              {green && <FeaturedTableCard t={green} copy="Sharpen your instincts with a classic table." />}
              {midnight && <CompactTableCard t={midnight} title="Practice at your pace" copy="A relaxed table for casual play." />}
            </>
          )}
        </section>
      )}

      <section aria-labelledby="find" className="space-y-4">
        <SerifHeading as="h2" className="text-[28px]"><span id="find">Find your table</span></SerifHeading>
        <SearchField value={q} onChange={setQ} placeholder="Search clubs or tables" label="Search clubs or tables" />
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5" role="group" aria-label="Filter tables">
          <Pill active={filter === 'all'} onClick={() => setFilter('all')}>All clubs</Pill>
          <Pill active={filter === 'available'} onClick={() => setFilter('available')}>Available</Pill>
          <Pill active={filter === 'favorites'} onClick={() => setFilter('favorites')}>
            <Star className="h-4 w-4" aria-hidden /> Favorites
          </Pill>
        </div>

        {lobby.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[138px]" />)}
        {lobby.isError && <ErrorState title="Could not load tables" onRetry={() => void lobby.refetch()}>The lobby is not reachable right now.</ErrorState>}
        {lobby.data && list.length === 0 && (
          <EmptyState title={filter === 'favorites' ? 'No favorite clubs yet' : 'No tables match'}>
            {filter === 'favorites' ? 'Open a club and tap the star to keep it here.' : 'Try another search or filter.'}
          </EmptyState>
        )}
        <ul className="space-y-3">
          {list.map((t) => (
            <li key={t.id}><TableCard t={t} /></li>
          ))}
        </ul>
        {lobby.data && (
          <p className="text-center text-xs text-faint">All live tables are simulated while physical-table play is switched off.</p>
        )}
      </section>

      <RoomsSection />
    </div>
  );
}

function RoomsSection() {
  const rooms = useRooms();
  const wallets = useWallets();
  if (rooms.isError || (rooms.data && rooms.data.rooms.length === 0)) return null;
  return (
    <section aria-labelledby="rooms" className="space-y-3">
      <div className="flex items-baseline justify-between">
        <SerifHeading as="h2" className="text-[28px]"><span id="rooms">Rooms</span></SerifHeading>
        <Link to="/app/profile" className="text-sm text-accent hover:underline">Have a code?</Link>
      </div>
      <p className="-mt-1 text-sm text-muted">Organizers run these books in chips or diamonds. No cash value.</p>
      {rooms.isLoading && <Skeleton className="h-24" />}
      <ul className="space-y-3">
        {rooms.data?.rooms.map((r) => <li key={r.id}><RoomCard room={r} wallets={wallets.data?.wallets} /></li>)}
      </ul>
    </section>
  );
}
