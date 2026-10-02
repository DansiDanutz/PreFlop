import { cx, formatOdds } from '@preflop/ui';
import { Check, Plus, Star, X } from 'lucide-react';
import type { BetOption } from '../../lib/bets.ts';
import { familyLabel } from '../../lib/bets.ts';
import { OptionIcon } from '../icons.tsx';

/** A favorite bet: icon, name, family, decimal odds; the selected one carries the accent border. */
export function FavoriteTile({ id, option, selected, editing, onSelect, onRemove, pool = false }: {
  id: string; option: BetOption | undefined; selected: boolean; editing: boolean; onSelect: () => void; onRemove: () => void; pool?: boolean;
}) {
  const offered = !!option?.offered;
  const price = offered ? (pool ? 'Pool' : formatOdds(option!.oddsCenti)) : '—';
  return (
    <div className="relative">
      <button type="button" onClick={onSelect} disabled={editing || !offered} aria-pressed={selected}
        aria-label={`${option?.name ?? id}${offered ? `, ${pool ? 'pool payout' : `odds ${price}`}` : ', not offered'}`}
        className={cx('relative flex h-full min-h-[118px] w-full gap-3 rounded-[10px] border p-3.5 text-left transition-[border-color,background-color] disabled:cursor-not-allowed',
          selected && !editing ? 'border-accent bg-accent-deep/35' : 'border-line-strong/60 bg-surface-2/40 hover:border-line-strong',
          !offered && !editing && 'opacity-50')}>
        {option ? <OptionIcon option={option} className={cx('mt-0.5 h-6 w-6 shrink-0', selected ? 'text-accent' : 'text-ink/80')} /> : <Star className="mt-0.5 h-6 w-6 shrink-0 text-faint" />}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-2 text-[15px] font-bold leading-tight">{option?.name ?? 'Unavailable'}</span>
          <span className="mt-1 truncate text-[12px] text-ink/70">{option ? familyLabel(option.family) : id}</span>
          <span className={cx('mt-auto pt-2.5 text-[17px] font-bold', offered ? 'text-ink' : 'text-faint')}>{price}</span>
        </span>
        {!editing && (selected
          ? <Check className="absolute bottom-2.5 right-2.5 h-3.5 w-3.5 text-accent" strokeWidth={2.5} aria-hidden />
          : <Star className="absolute bottom-2.5 right-2.5 h-3 w-3 fill-ink/45 text-ink/45" aria-hidden />)}
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

export function EmptyFavoriteSlot({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="grid min-h-[118px] place-items-center rounded-[10px] border border-dashed border-line-strong text-muted hover:border-accent hover:text-accent">
      <span className="flex flex-col items-center gap-1 text-sm"><Plus className="h-5 w-5" aria-hidden /> Add a bet</span>
    </button>
  );
}
