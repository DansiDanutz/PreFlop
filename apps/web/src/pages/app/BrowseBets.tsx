import { Button, Card, EmptyState, cx, formatOdds } from '@preflop/ui';
import { ArrowRight, ChevronDown, ChevronRight, Info, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { OptionIcon } from '../../components/icons.tsx';
import { CheckBadge } from '../../components/table/Tiles.tsx';
import { BackButton, ErrorState, Notice, Pill, SearchField, SerifHeading, Skeleton } from '../../components/ui.tsx';
import {
  type BetOption, CATEGORIES, type Category, EQUIVALENT, MAX_FAVORITES, addFavorite, removeFavorite, replaceFavorite, resolveOption, searchOptions, sectionByMarket,
} from '../../lib/bets.ts';
import { useBook, useFavorites, useRoom } from '../../lib/queries.ts';
import { isPool, roomOption } from '../../lib/rooms.ts';

const pct = (p: number) => `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}% of flops`;

export function BrowseBetsPage() {
  const { id: tableId = '' } = useParams();
  const nav = useNavigate();
  const book = useBook();
  const favs = useFavorites();
  const [params] = useSearchParams();
  const roomId = params.get('room');
  const { room } = useRoom(roomId);
  const pool = isPool(room);
  const roomQs = roomId ? `room=${encodeURIComponent(roomId)}` : '';
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<BetOption | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const options = useMemo(() => [...book.index.values()].map((o) => roomOption(o, room)!), [book.index, room]);
  const sections = useMemo(() => sectionByMarket(searchOptions(options, q, cat)), [options, q, cat]);
  const favOf = (id: string) => favs.ids.find((f) => f === id || EQUIVALENT[f] === id);

  const toggleStar = (o: BetOption) => {
    const existing = favOf(o.id);
    if (existing) {
      favs.save(removeFavorite(favs.ids, existing));
      setNotice(`${o.name} removed from favorites.`);
      return;
    }
    const r = addFavorite(favs.ids, o.id);
    if (r.kind === 'full') setReplacing(o);
    else if (r.kind === 'added') {
      favs.save(r.list);
      setNotice(`${o.name} added to favorites.`);
    }
  };

  if (replacing) {
    return (
      <ReplaceFavorite newBet={replacing} favorites={favs.ids} index={book.index}
        onCancel={() => setReplacing(null)}
        onReplace={(oldId) => {
          favs.save(replaceFavorite(favs.ids, oldId, replacing.id));
          setNotice(`${replacing.name} replaced ${resolveOption(book.index, oldId)?.name ?? 'a favorite'}.`);
          setReplacing(null);
        }} />
    );
  }

  const hl = highlight ? options.find((o) => o.id === highlight) : undefined;
  return (
    <div className="space-y-4 px-5 pb-28">
      <BackButton to={`/app/table/${tableId}${roomQs ? `?${roomQs}` : ''}`} label="Back to the table" />
      <div>
        <SerifHeading>Browse bets</SerifHeading>
        <p className="mt-1 text-sm text-muted">Choose a bet, then save it to a favorite slot.</p>
      </div>
      <SearchField value={q} onChange={setQ} placeholder="Search bets" label="Search bets" />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Bet categories">
        {CATEGORIES.map((c) => (
          <Pill key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>
            {c.label}{c.id === 'more' && <ChevronDown className="h-4 w-4" aria-hidden />}
          </Pill>
        ))}
      </div>
      {notice && <Notice tone="accent">{notice}</Notice>}

      {book.isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
      {book.isError && <ErrorState title="Could not load the odds book" onRetry={() => void book.refetch()} />}
      {book.data && sections.length === 0 && <EmptyState title="No bets match">Try another word or category.</EmptyState>}

      {sections.map((s) => (
        <section key={s.marketId} aria-label={s.title}>
          <h2 className="mb-2 mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{s.title}</h2>
          <Card className="divide-y divide-line overflow-hidden">
            {s.items.map((o) => {
              const starred = !!favOf(o.id);
              const isHl = highlight === o.id;
              return (
                <div key={o.id} className={cx('flex items-center gap-3 px-3 py-3', isHl && 'bg-accent-soft')}>
                  <button type="button" disabled={!o.offered} onClick={() => setHighlight(isHl ? null : o.id)} aria-pressed={isHl}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-50">
                    <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border', isHl ? 'border-accent text-accent' : 'border-line text-ink/85')}>
                      <OptionIcon option={o} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{o.name}</span>
                      <span className="block truncate text-[12px] text-muted">{o.offered ? pct(o.probability) : room ? 'Not offered in this room' : 'Too rare to offer'}</span>
                    </span>
                    <span className={cx('shrink-0 text-[15px] font-semibold', o.offered ? 'text-ink' : 'text-faint')}>{o.offered ? (pool ? 'Pool' : formatOdds(o.oddsCenti)) : '—'}</span>
                  </button>
                  <button type="button" onClick={() => toggleStar(o)} disabled={!o.offered} aria-pressed={starred}
                    aria-label={starred ? `Remove ${o.name} from favorites` : `Add ${o.name} to favorites`}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-surface-3 disabled:opacity-40">
                    <Star className={cx('h-5 w-5', starred ? 'fill-accent text-accent' : 'text-muted')} />
                  </button>
                  <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
                </div>
              );
            })}
          </Card>
          {s.items.some((o) => o.id === highlight) && !favOf(highlight!) && (
            <p className="mt-2 flex items-center gap-1.5 text-[13px] text-muted"><Info className="h-4 w-4" aria-hidden /> Tap star to add to favorites</p>
          )}
        </section>
      ))}

      <p className="pt-2 text-center text-xs text-muted">{pool ? 'Pool room: winners share the pool, so there are no fixed odds.' : 'Decimal odds include your chip stake.'}</p>

      {hl && (
        <div className="fixed inset-x-0 bottom-[72px] z-30 px-5">
          <div className="mx-auto max-w-[440px]">
            <Button size="lg" className="w-full shadow-[0_10px_30px_rgba(0,0,0,0.5)]" onClick={() => nav(`/app/table/${tableId}?sel=${encodeURIComponent(hl.id)}${roomQs ? `&${roomQs}` : ''}`)}>
              Predict {hl.name} · {pool ? 'Pool' : formatOdds(hl.oddsCenti)} <ArrowRight className="h-5 w-5" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Replace a favorite (concept "Your favorite bets", screen 3). */
function ReplaceFavorite({ newBet, favorites, index, onCancel, onReplace }: {
  newBet: BetOption; favorites: string[]; index: Map<string, BetOption>; onCancel: () => void; onReplace: (oldId: string) => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const old = pick ? resolveOption(index, pick) : undefined;
  return (
    <div className="space-y-4 px-5 pb-8">
      <BackButton label="Cancel replacing" onClick={onCancel} />
      <div>
        <SerifHeading>Replace a favorite</SerifHeading>
        <p className="mt-1 text-sm text-muted">All {MAX_FAVORITES} slots are full. Choose which one to replace.</p>
      </div>

      <Card className="flex items-center gap-3 border-accent p-4 shadow-[var(--shadow-glow)]">
        <span className="grid h-11 w-11 place-items-center rounded-[12px] border border-accent text-accent"><OptionIcon option={newBet} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wider text-accent">New bet</div>
          <div className="truncate font-semibold">{newBet.name}</div>
          <div className="truncate text-xs text-muted">{newBet.marketName}</div>
        </div>
        <span className="font-semibold">{formatOdds(newBet.oddsCenti)}</span>
      </Card>

      <div role="radiogroup" aria-label="Favorite to replace" className="grid grid-cols-3 gap-2.5">
        {favorites.map((id) => {
          const o = resolveOption(index, id);
          const on = pick === id;
          return (
            <button key={id} type="button" role="radio" aria-checked={on} onClick={() => setPick(id)}
              className={cx('relative flex min-h-[96px] flex-col rounded-[14px] border bg-surface p-3 text-left',
                on ? 'border-accent shadow-[var(--shadow-glow)]' : 'border-line hover:border-line-strong')}>
              {on && <CheckBadge />}
              <span className="flex items-center gap-2">
                <span aria-hidden className={cx('grid h-5 w-5 place-items-center rounded-full border-2', on ? 'border-accent' : 'border-line-strong')}>
                  {on && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
                </span>
                {o && <OptionIcon option={o} className="h-5 w-5 text-ink/85" />}
              </span>
              <span className="mt-2 line-clamp-2 text-[13px] font-semibold leading-tight">{o?.name ?? id}</span>
              <span className="mt-auto pt-1 text-[13px]">
                <span className="block font-semibold">{o ? formatOdds(o.oddsCenti) : '—'}</span>
                {on && <span className="block text-[11px] font-semibold text-accent">Replace this</span>}
              </span>
            </button>
          );
        })}
      </div>

      <Card className="flex items-center justify-center gap-2 px-4 py-3 text-sm" aria-live="polite">
        {old ? (
          <>
            <span className="text-muted line-through decoration-faint">{old.name} {formatOdds(old.oddsCenti)}</span>
            <ArrowRight className="h-4 w-4 text-accent" aria-hidden />
            <span className="font-semibold">{newBet.name} {formatOdds(newBet.oddsCenti)}</span>
          </>
        ) : (
          <span className="text-muted">Choose a favorite above</span>
        )}
      </Card>

      <div className="grid gap-3">
        <Button size="lg" disabled={!pick} onClick={() => pick && onReplace(pick)}>Replace favorite</Button>
        <Button size="lg" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
      <p className="text-center text-xs text-muted">Your other favorites stay unchanged.</p>
    </div>
  );
}
