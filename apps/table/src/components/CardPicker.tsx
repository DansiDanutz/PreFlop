import { CardBack, PlayingCard, cx } from '@preflop/ui';
import { Undo2 } from 'lucide-react';
import { RANKS, SUITS, SUIT_NAME, SUIT_SYMBOL, isRed } from '../lib/cards.ts';

/**
 * 4 rows (♠ ♥ ♦ ♣) × 13 ranks. Tap to select up to three cards (in the order the dealer sees
 * them), tap again to remove. Tiles are ≥ 56 px tall.
 */
export function CardPicker({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const toggle = (code: string) => {
    if (disabled) return;
    if (value.includes(code)) onChange(value.filter((c) => c !== code));
    else if (value.length < 3) onChange([...value, code]);
  };
  const full = value.length >= 3;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" role="group" aria-label="Card picker">
      {SUITS.map((s) => (
        <div key={s} className="flex max-h-[112px] min-h-[60px] flex-1 items-stretch gap-2">
          <div className={cx('grid w-12 shrink-0 place-items-center rounded-[12px] bg-surface-2 text-3xl leading-none', s === 'h' || s === 'd' ? 'text-card-red' : 'text-ink')} aria-label={SUIT_NAME[s]}>
            {SUIT_SYMBOL[s]}
          </div>
          <div className="grid flex-1 grid-cols-13 gap-1.5" style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}>
            {RANKS.map((r) => {
              const code = `${r}${s}`;
              const idx = value.indexOf(code);
              const sel = idx >= 0;
              return (
                <button key={code} type="button" data-card={code} aria-pressed={sel} aria-label={`${r === 'T' ? '10' : r} of ${SUIT_NAME[s]}`}
                  disabled={disabled || (full && !sel)} onClick={() => toggle(code)}
                  className={cx('relative flex h-full min-h-[60px] min-w-0 flex-col items-center justify-center gap-1 rounded-[10px] font-serif leading-none transition-[transform,opacity,box-shadow]',
                    sel ? 'bg-card -translate-y-0.5 shadow-[0_0_0_3px_var(--color-accent),0_8px_20px_rgba(31,211,139,0.35)]'
                      : 'bg-card/95 shadow-[0_2px_6px_rgba(0,0,0,0.4)] active:scale-95',
                    full && !sel && 'opacity-30')}
                  style={{ color: isRed(code) ? 'var(--color-card-red)' : 'var(--color-card-black)' }}>
                  <span className="text-[26px]">{r === 'T' ? '10' : r}</span>
                  <span className="text-[18px]">{SUIT_SYMBOL[s]}</span>
                  {sel && <span className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-accent font-sans text-xs font-bold text-accent-ink">{idx + 1}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The three chosen cards, face down where still empty. */
export function SelectedFlop({ cards, size = 'md', onClear }: { cards: string[]; size?: 'sm' | 'md' | 'lg'; onClear?: () => void }) {
  return (
    <div className="flex items-center gap-3">
      {[0, 1, 2].map((i) => (cards[i] ? <PlayingCard key={cards[i]} code={cards[i]!} size={size} className="pf-pop" /> : <CardBack key={`b${i}`} size={size} className="opacity-50" />))}
      {onClear && cards.length > 0 && (
        <button type="button" onClick={onClear} className="ml-1 grid h-14 w-14 place-items-center rounded-full border border-line-strong text-muted active:text-ink" aria-label="Clear selection">
          <Undo2 className="h-6 w-6" />
        </button>
      )}
    </div>
  );
}
