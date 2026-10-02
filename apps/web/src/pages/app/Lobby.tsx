import { EmptyState } from '@preflop/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Star, Swords } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { HelpButton, PageHeader, type ShellContext } from '../../components/AppShell.tsx';
import { RoomCard } from '../../components/RoomCard.tsx';
import { TableCard, tableGrid } from '../../components/TableCards.tsx';
import { ErrorState, SearchField, Skeleton, Tabs } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { tableStatus } from '../../lib/live.ts';
import { useLobby, useRooms, useSavedTables, useWallets } from '../../lib/queries.ts';
import { KEYS, readString } from '../../lib/storage.ts';

type Filter = 'all' | 'available' | 'saved';

export function LobbyPage() {
  const lobby = useLobby();
  const saved = useSavedTables();
  const shell = useOutletContext<ShellContext | undefined>();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [club, setClub] = useState('all');

  const tables = lobby.data?.tables ?? [];
  const clubs = useMemo(() => (lobby.data?.clubs ?? []).filter((c) => tables.some((t) => t.club_id === c.id)), [lobby.data, tables]);

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return tables.filter((t) => {
      if (filter === 'available' && (t.status !== 'active' || tableStatus(t).label === 'Stream unavailable')) return false;
      if (filter === 'saved' && !saved.has(t.id)) return false;
      if (club !== 'all' && t.club_id !== club) return false;
      const hay = `${t.name} ${t.club_name} ${t.city ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [tables, q, filter, club, saved]);

  const lastTable = readString(KEYS.lastTable) ?? tables.find((t) => t.status === 'active')?.id;

  return (
    <div>
      <PageHeader eyebrow="Your next three cards" title="Find your table." subtitle="Different rooms. The same feeling when the cards turn."
        action={shell && <HelpButton onClick={shell.openHelp} />} />

      <div className="mt-8 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1"><SearchField value={q} onChange={setQ} placeholder="Search tables or clubs" label="Search tables or clubs" /></div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs label="Filter tables" value={filter} onChange={setFilter} options={[
            { id: 'all', label: 'All tables' },
            { id: 'available', label: 'Available' },
            { id: 'saved', label: <><Star className="h-4 w-4" aria-hidden /> Saved</> },
          ]} />
          <label className="sr-only" htmlFor="club-filter">Club</label>
          <select id="club-filter" value={club} onChange={(e) => setClub(e.target.value)}
            className="h-11 min-w-[170px] rounded-[8px] border border-line-strong/70 bg-surface px-3.5 text-[14px] text-ink focus:border-accent focus:outline-none">
            <option value="all">All clubs</option>
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-6 flex items-baseline justify-between gap-4 border-t border-line pt-6 text-[13px]">
        <span className="font-semibold">{lobby.data ? `${list.length} ${list.length === 1 ? 'table' : 'tables'}` : 'Tables'}</span>
        <span className="hidden text-ink/80 sm:inline">Choose your atmosphere. Play at your pace.</span>
      </div>

      <div className="mt-4">
        {lobby.isError && <ErrorState title="Could not load tables" onRetry={() => void lobby.refetch()}>The lobby is not reachable right now.</ErrorState>}
        {lobby.data && list.length === 0 && (
          <EmptyState title={filter === 'saved' ? 'No saved tables yet' : 'No tables match'}>
            {filter === 'saved' ? 'Tap the star on a table to keep it here.' : 'Try another search or filter.'}
          </EmptyState>
        )}
        <ul className={tableGrid}>
          {lobby.isLoading && [0, 1, 2].map((i) => <li key={i}><Skeleton className="h-[388px]" /></li>)}
          {list.map((t) => <li key={t.id} className="flex"><TableCard t={t} saved={saved.has(t.id)} onToggleSave={() => saved.toggle(t.id)} /></li>)}
        </ul>
      </div>

      {lastTable && (
        <section className="mt-8 flex flex-col gap-4 rounded-[12px] border border-line-strong/60 bg-gradient-to-r from-accent-deep/40 to-surface px-6 py-6 sm:flex-row sm:items-center sm:px-10">
          <span aria-hidden className="text-[28px] text-accent/80">♠</span>
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-[20px] tracking-[-0.03em]">A little intuition. A lot of possibilities.</h2>
            <p className="mt-1 text-[13px] text-ink/80">Save six favorite predictions and explore every offered selection. The next flop is yours to read.</p>
          </div>
          <Link to={`/app/table/${lastTable}/bets`} className="inline-flex items-center gap-1.5 text-[14px] text-accent hover:underline">
            Explore the bets <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </section>
      )}

      <TournamentsRow />
      <RoomsSection />
    </div>
  );
}

/** A small way into tournaments; says how many are running when the API answers. */
function TournamentsRow() {
  const running = useQuery({ queryKey: ['tournaments', 'running'], queryFn: () => api.tournaments('running'), refetchInterval: 60_000 });
  const n = running.data?.tournaments.length ?? 0;
  return (
    <Link to="/app/tournaments" className="group mt-4 flex items-center gap-4 rounded-[12px] border border-line-strong/60 bg-surface px-6 py-4 hover:border-line-strong sm:px-10">
      <Swords className="h-6 w-6 shrink-0 text-accent/80" strokeWidth={1.6} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-serif text-[18px] tracking-[-0.03em]">Tournaments{n > 0 && <span className="ml-2 align-middle font-sans text-[12px] font-semibold text-accent">{n} running now</span>}</span>
        <span className="block text-[13px] text-ink/80">Same stack, same bets. The biggest stack when the clock runs out wins.</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted group-hover:text-ink" aria-hidden />
    </Link>
  );
}

function RoomsSection() {
  const rooms = useRooms();
  const wallets = useWallets();
  if (rooms.isError || (rooms.data && rooms.data.rooms.length === 0)) return null;
  return (
    <section aria-labelledby="rooms" className="mt-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Organizer rooms</p>
          <h2 id="rooms" className="mt-2 font-serif text-[28px] tracking-[-0.04em]">Rooms</h2>
          <p className="mt-1 text-[14px] text-ink/80">Organizers run these books in chips or diamonds. No cash value.</p>
        </div>
        <Link to="/app/profile" className="shrink-0 text-[14px] text-accent hover:underline">Have a code?</Link>
      </div>
      <ul className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 [&>li]:min-w-0">
        {rooms.isLoading && <li><Skeleton className="h-24" /></li>}
        {rooms.data?.rooms.map((r) => <li key={r.id}><RoomCard room={r} wallets={wallets.data?.wallets} /></li>)}
      </ul>
    </section>
  );
}
