import { cx, formatOdds } from '@preflop/ui';
import { Check, Plus, Star, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { BetOption, GridTile } from '../../lib/bets.ts';
import { HandIcon, OptionIcon } from '../icons.tsx';

export function CheckBadge() {
  return (
    <span aria-hidden className="absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full bg-accent text-accent-ink">
      <Check className="h-3.5 w-3.5" strokeWidth={3} />
    </span>
  );
}

const tileBase = 'relative flex flex-col rounded-[14px] border bg-surface text-left transition-[border-color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50';
const tileState = (selected: boolean) => (selected ? 'border-accent shadow-[var(--shadow-glow)] bg-accent-soft/40' : 'border-line hover:border-line-strong');

/** One of the four main prediction tiles (Pair / Flush / Straight / High card). */
export function PredictionTile({ tile, option, selected, onSelect, pool = false }: { tile: GridTile; option: BetOption | undefined; selected: boolean; onSelect: () => void; pool?: boolean }) {
  const offered = !!option?.offered;
  const price = offered ? (pool ? 'Pool' : formatOdds(option!.oddsCenti)) : '';
  return (
    <button type="button" onClick={onSelect} disabled={!offered} aria-pressed={selected}
      aria-label={`${tile.title}: ${tile.subtitle}${offered ? `, ${pool ? 'pool payout' : `odds ${price}`}` : ', not offered'}`}
      className={cx(tileBase, tileState(selected), 'min-h-[132px] p-4')}>
      {selected && <CheckBadge />}
      <HandIcon kind={tile.icon} className={cx('h-8 w-8', selected ? 'text-accent' : 'text-ink/85')} />
      <span className="mt-auto pt-3 text-[17px] font-semibold leading-tight">{tile.title}</span>
      <span className="mt-0.5 text-[13px] leading-snug text-muted">{tile.subtitle}</span>
      <span className={cx('mt-1.5 text-sm font-semibold', offered ? 'text-accent' : 'text-faint')}>{offered ? price : 'Not offered'}</span>
    </button>
  );
}

/** Favorite bet tile (concept "Your favorite bets", screen 1). */
export function FavoriteTile({ id, option, selected, editing, onSelect, onRemove, pool = false }: {
  id: string; option: BetOption | undefined; selected: boolean; editing: boolean; onSelect: () => void; onRemove: () => void; pool?: boolean;
}) {
  const offered = !!option?.offered;
  const price = offered ? (pool ? 'Pool' : formatOdds(option!.oddsCenti)) : '—';
  return (
    <div className="relative">
      <button type="button" onClick={onSelect} disabled={editing || !offered} aria-pressed={selected}
        aria-label={`${option?.name ?? id}${offered ? `, ${pool ? 'pool payout' : `odds ${price}`}` : ', not offered'}`}
        className={cx(tileBase, tileState(selected), 'h-full min-h-[116px] w-full p-3', editing && 'disabled:opacity-100')}>
        {selected && !editing && <CheckBadge />}
        {option ? <OptionIcon option={option} className={cx('h-6 w-6', selected ? 'text-accent' : 'text-ink/85')} /> : <Star className="h-6 w-6 text-faint" />}
        <span className="mt-2 line-clamp-2 text-[14px] font-semibold leading-tight">{option?.name ?? 'Unavailable'}</span>
        <span className="mt-0.5 truncate text-[11px] text-muted">{option?.marketName ?? id}</span>
        <span className="mt-auto flex items-center justify-between pt-1.5">
          <span className={cx('text-[13px] font-semibold', offered ? 'text-ink' : 'text-faint')}>{price}</span>
          {!editing && <Star className="h-3.5 w-3.5 fill-accent text-accent" aria-hidden />}
        </span>
      </button>
      {editing && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${option?.name ?? id} from favorites`}
          className="absolute -right-1.5 -top-1.5 grid h-7 w-7 place-items-center rounded-full border border-line-strong bg-surface-3 text-ink hover:border-danger hover:text-danger">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function EmptyFavoriteSlot({ to }: { to: string }) {
  return (
    <Link to={to} className="grid min-h-[116px] place-items-center rounded-[14px] border border-dashed border-line-strong text-muted hover:border-accent hover:text-accent">
      <span className="flex flex-col items-center gap-1 text-sm"><Plus className="h-5 w-5" aria-hidden /> Add a bet</span>
    </Link>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-serif text-[24px] leading-tight">{children}</h2>
      {right}
    </div>
  );
}
