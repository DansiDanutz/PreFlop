import { Button, EmptyState, cx, formatOdds } from '@preflop/ui';
import { ArrowRight, Star, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  type BetOption, EQUIVALENT, FAMILIES, MAX_FAVORITES, addFavorite, familyLabel, removeFavorite, replaceFavorite, resolveOption, searchOptions, sectionByMarket,
} from '../../lib/bets.ts';
import { OptionIcon } from '../icons.tsx';
import { ErrorState, Notice, SearchField, Sheet, Skeleton } from '../ui.tsx';

const pct = (p: number) => `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}% of flops`;

/**
 * "Find your next favorite." — every selection in the book, grouped by market and filtered by the
 * engine's seven families. Star to fill a favorite slot; when all six are full, choose one to replace.
 * Picking a row makes it the current prediction at the table.
 */
export function CatalogueSheet({ open, onClose, options, loading, error, onRetry, favorites, onSaveFavorites, onPick, pool, inRoom }: {
  open: boolean; onClose: () => void;
  options: readonly BetOption[]; loading: boolean; error: boolean; onRetry: () => void;
  favorites: readonly string[]; onSaveFavorites: (ids: string[]) => void;
  onPick: (o: BetOption) => void; pool: boolean; inRoom: boolean;
}) {
  const [q, setQ] = useState('');
  const [family, setFamily] = useState<string>('all');
  const [replacing, setReplacing] = useState<BetOption | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(() => searchOptions(options.filter((o) => family === 'all' || o.family === family), q), [options, family, q]);
  const families = useMemo(() => new Map(sectionByMarket(filtered).map((s) => [s.marketId, s])), [filtered]);
  // Group markets under their family heading, keeping book order.
  const groups = useMemo(() => {
    const out: { family: string; sections: ReturnType<typeof sectionByMarket> }[] = [];
    for (const s of families.values()) {
      const f = s.items[0]!.family;
      let g = out.find((x) => x.family === f);
      if (!g) out.push((g = { family: f, sections: [] }));
      g.sections.push(s);
    }
    return out;
  }, [families]);
  const index = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const favOf = (id: string) => favorites.find((f) => f === id || EQUIVALENT[f] === id);
  const offeredCount = options.filter((o) => o.offered).length;

  const toggleStar = (o: BetOption) => {
    const existing = favOf(o.id);
    if (existing) {
      onSaveFavorites(removeFavorite(favorites, existing));
      setNotice(`${o.name} removed from favorites.`);
      return;
    }
    const r = addFavorite(favorites, o.id);
    if (r.kind === 'full') setReplacing(o);
    else if (r.kind === 'added') {
      onSaveFavorites(r.list);
      setNotice(`${o.name} added to favorites.`);
    }
  };

  const close = () => { setReplacing(null); onClose(); };

  return (
    <Sheet open={open} onClose={close} title="Bet catalogue" wide>
      {replacing ? (
        <ReplaceFavorite newBet={replacing} favorites={favorites} index={index} pool={pool}
          onCancel={() => setReplacing(null)}
          onReplace={(oldId) => {
            onSaveFavorites(replaceFavorite(favorites, oldId, replacing.id));
            setNotice(`${replacing.name} replaced ${resolveOption(index, oldId)?.name ?? 'a favorite'}.`);
            setReplacing(null);
          }} />
      ) : (
        <>
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Your table, your way</p>
              <h2 className="mt-2.5 font-serif text-[30px] leading-tight tracking-[-0.045em]">Find your next favorite.</h2>
              <p className="mt-2 text-[14px] text-ink/80">Explore the complete catalogue.</p>
            </div>
            <button type="button" onClick={close} aria-label="Close the catalogue" className="grid h-10 w-10 place-items-center rounded-[8px] text-ink/80 hover:bg-surface-3">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-6"><SearchField value={q} onChange={setQ} placeholder="Search bets, cards or rules" label="Search bets" /></div>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Bet families">
            {[{ id: 'all', label: 'All bets' }, ...FAMILIES.filter((f) => options.some((o) => o.family === f.id))].map((f) => (
              <button key={f.id} type="button" aria-pressed={family === f.id} onClick={() => setFamily(f.id)}
                className={cx('h-10 rounded-[6px] border px-3 text-[14px] transition-colors',
                  family === f.id ? 'border-accent bg-accent font-semibold text-accent-ink' : 'border-line-strong text-ink/90 hover:border-accent/60')}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between text-[12px] text-ink/80">
            <span>{loading ? 'Loading…' : `${filtered.length} ${filtered.length === 1 ? 'selection' : 'selections'}`}{!loading && family === 'all' && !q && ` · ${offeredCount} offered`}</span>
            <span>{pool ? 'Pool room · no fixed odds' : 'Decimal odds · Stake included'}</span>
          </div>
          {notice && <Notice tone="accent" className="mt-3">{notice}</Notice>}

          <div className="mt-2">
            {loading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="mt-2 h-16" />)}
            {error && <ErrorState title="Could not load the odds book" onRetry={onRetry} />}
            {!loading && !error && filtered.length === 0 && <div className="mt-4"><EmptyState title="No bets match">Try another word or family.</EmptyState></div>}
            {groups.map((g) => (
              <section key={g.family} aria-label={familyLabel(g.family)}>
                <h3 className="mt-6 border-b border-line pb-3 text-[12px] font-bold uppercase tracking-[0.12em] text-ink/80">{familyLabel(g.family)}</h3>
                <ul className="divide-y divide-line">
                  {g.sections.flatMap((s) => s.items).map((o) => {
                    const starred = !!favOf(o.id);
                    return (
                      <li key={o.id} className="flex items-center gap-2">
                        <button type="button" disabled={!o.offered} onClick={() => onPick(o)}
                          className="flex min-w-0 flex-1 items-center gap-3.5 py-3.5 text-left hover:bg-surface-2/50 disabled:opacity-50">
                          <OptionIcon option={o} className="h-5 w-5 shrink-0 text-ink/75" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-semibold">{o.name}</span>
                            <span className="block truncate text-[12px] text-ink/70">{o.marketName}{o.offered ? ` · ${pct(o.probability)}` : inRoom ? ' · Not offered in this room' : ' · Too rare to offer'}</span>
                          </span>
                          <span className={cx('shrink-0 text-[14px] font-bold', o.offered ? 'text-ink' : 'text-faint')}>{o.offered ? (pool ? 'Pool' : formatOdds(o.oddsCenti)) : '—'}</span>
                        </button>
                        <button type="button" onClick={() => toggleStar(o)} disabled={!o.offered} aria-pressed={starred}
                          aria-label={starred ? `Remove ${o.name} from favorites` : `Add ${o.name} to favorites`}
                          className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-surface-3 disabled:opacity-40">
                          <Star className={cx('h-5 w-5', starred ? 'fill-accent text-accent' : 'text-ink/70')} strokeWidth={1.6} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          <p className="mt-6 text-center text-[12px] text-muted">Tap a bet to predict it now. Star it to keep it in your six favorites.</p>
        </>
      )}
    </Sheet>
  );
}

/** Replace a favorite when all six slots are full. */
function ReplaceFavorite({ newBet, favorites, index, pool, onCancel, onReplace }: {
  newBet: BetOption; favorites: readonly string[]; index: Map<string, BetOption>; pool: boolean; onCancel: () => void; onReplace: (oldId: string) => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const old = pick ? resolveOption(index, pick) : undefined;
  const price = (o: BetOption | undefined) => (o ? (pool ? 'Pool' : formatOdds(o.oddsCenti)) : '—');
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">All {MAX_FAVORITES} slots are full</p>
      <h2 className="mt-2.5 font-serif text-[30px] leading-tight tracking-[-0.045em]">Replace a favorite.</h2>
      <p className="mt-2 text-[14px] text-ink/80">Choose which favorite makes room for <strong className="text-ink">{newBet.name}</strong>.</p>

      <div className="mt-5 flex items-center gap-3 rounded-[10px] border border-accent bg-accent-deep/40 p-4">
        <OptionIcon option={newBet} className="h-6 w-6 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">New bet</div>
          <div className="truncate font-semibold">{newBet.name}</div>
        </div>
        <span className="font-bold">{price(newBet)}</span>
      </div>

      <div role="radiogroup" aria-label="Favorite to replace" className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {favorites.map((id) => {
          const o = resolveOption(index, id);
          const on = pick === id;
          return (
            <button key={id} type="button" role="radio" aria-checked={on} onClick={() => setPick(id)}
              className={cx('flex min-h-[92px] flex-col rounded-[10px] border p-3 text-left', on ? 'border-accent bg-accent-deep/30' : 'border-line-strong/70 hover:border-line-strong')}>
              <span className="flex items-center gap-2">
                <span aria-hidden className={cx('grid h-4 w-4 place-items-center rounded-full border-2', on ? 'border-accent' : 'border-line-strong')}>
                  {on && <span className="h-2 w-2 rounded-full bg-accent" />}
                </span>
                {o && <OptionIcon option={o} className="h-5 w-5 text-ink/80" />}
              </span>
              <span className="mt-2 line-clamp-2 text-[13px] font-semibold leading-tight">{o?.name ?? id}</span>
              <span className="mt-auto pt-1 text-[13px] font-bold">{price(o)}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 rounded-[10px] border border-line-strong/60 px-4 py-3 text-sm" aria-live="polite">
        {old ? (
          <>
            <span className="text-muted line-through decoration-faint">{old.name}</span>
            <ArrowRight className="h-4 w-4 text-accent" aria-hidden />
            <span className="font-semibold">{newBet.name}</span>
          </>
        ) : <span className="text-muted">Choose a favorite above</span>}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Button variant="secondary" size="lg" onClick={onCancel}>Back to the catalogue</Button>
        <Button size="lg" disabled={!pick} onClick={() => pick && onReplace(pick)}>Replace favorite</Button>
      </div>
      <p className="mt-3 text-center text-xs text-muted">Your other favorites stay unchanged.</p>
    </div>
  );
}
