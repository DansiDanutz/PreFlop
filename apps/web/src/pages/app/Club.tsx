import type { TableSummary } from '@preflop/client';
import { Card, StatusDot, cx } from '@preflop/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, MapPin, Star } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { FreeChipsCard } from '../../components/AppShell.tsx';
import { StreamView } from '../../components/StreamView.tsx';
import { BackButton, ErrorState, SerifHeading, Skeleton } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { tableStatus } from '../../lib/live.ts';
import { isNotImplemented } from '../../lib/problems.ts';
import { qk, useFavoriteClubs, useLobby } from '../../lib/queries.ts';
import { Monogram } from './Clubs.tsx';

function ClubTableRow({ t }: { t: TableSummary }) {
  const st = tableStatus(t);
  return (
    <Card className="flex gap-3 p-3">
      <StreamView cards={t.last_flop?.cards} size="sm" cardScale={0.66} unavailable={st.label === 'Stream unavailable'} className="min-h-[96px] w-[112px] shrink-0 self-stretch rounded-[12px]" watermark={false} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="truncate font-semibold">{t.name}</div>
        <div className="mt-0.5 whitespace-nowrap"><StatusDot tone={st.tone} label={<span className="text-[13px]">{st.label}</span>} /></div>
        <div className="mt-0.5 flex items-center gap-1 text-[13px] text-muted"><MapPin className="h-3.5 w-3.5" aria-hidden /> {t.city ?? 'Online'}</div>
        <div className="mt-auto flex justify-end pt-2">
          <Link to={`/app/table/${t.id}`} className={cx('inline-flex h-9 items-center gap-0.5 whitespace-nowrap rounded-[12px] px-3 text-sm font-semibold',
            'border border-line-strong text-ink hover:border-accent hover:text-accent')}>
            View table <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </Card>
  );
}

export function ClubPage() {
  const { id = '' } = useParams();
  const club = useQuery({ queryKey: qk.club(id), queryFn: () => api.club(id) });
  const lobby = useLobby();
  const favs = useFavoriteClubs();
  // Live table state comes from the lobby stream; the club endpoint gives the header.
  const live = (lobby.data?.tables ?? []).filter((t) => t.club_id === id);
  const tables: TableSummary[] = live.length ? live : club.data ? [...club.data.tables] : [];

  if (club.isError) {
    return (
      <div className="space-y-4 px-5">
        <BackButton to="/app/clubs" />
        <ErrorState title={isNotImplemented(club.error) ? 'Club not found' : 'Could not load this club'} onRetry={() => void club.refetch()} />
      </div>
    );
  }
  const fav = favs.has(id);
  return (
    <div className="space-y-5 px-5 pb-6">
      <div className="flex items-center gap-3">
        <BackButton to="/app/clubs" />
        <FreeChipsCard tagline={1} className="flex-1 py-3!" />
      </div>

      <Card className="flex items-center gap-4 p-5">
        {club.data ? <Monogram name={club.data.name} size="lg" /> : <Skeleton className="h-16 w-16 rounded-full" />}
        <div className="min-w-0 flex-1">
          {club.data ? (
            <>
              <SerifHeading className="text-[26px]">{club.data.name}</SerifHeading>
              <p className="text-sm text-muted">{[club.data.city, club.data.country].filter(Boolean).join(' · ') || 'Online'}</p>
              <p className="mt-0.5 text-xs uppercase tracking-wider text-faint">Organizer</p>
            </>
          ) : (
            <>
              <Skeleton className="h-7 w-44" />
              <Skeleton className="mt-2 h-4 w-28" />
            </>
          )}
        </div>
        <button type="button" onClick={() => favs.toggle(id)} aria-pressed={fav} aria-label={fav ? 'Remove club from favorites' : 'Add club to favorites'}
          className="grid h-11 w-11 place-items-center rounded-full border border-line-strong hover:border-accent">
          <Star className={cx('h-5 w-5', fav ? 'fill-accent text-accent' : 'text-muted')} />
        </button>
      </Card>

      <section aria-labelledby="club-tables" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <SerifHeading as="h2" className="text-[26px]"><span id="club-tables">Club tables</span></SerifHeading>
          <span className="text-sm text-muted">{tables.length} {tables.length === 1 ? 'table' : 'tables'}</span>
        </div>
        {club.isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-[108px]" />)}
        <ul className="space-y-3">
          {tables.map((t) => <li key={t.id}><ClubTableRow t={t} /></li>)}
        </ul>
        {tables.some((t) => t.kind === 'simulated') && <p className="text-xs text-faint">Simulated tables: physical-table play is switched off for now.</p>}
      </section>
    </div>
  );
}
