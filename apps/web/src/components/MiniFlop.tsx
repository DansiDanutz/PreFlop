import { cx } from '@preflop/ui';

const SUIT: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

/** A compact text flop for lists, e.g. K♥ K♦ 7♥. */
export function MiniFlop({ cards, className }: { cards: readonly string[] | null | undefined; className?: string }) {
  if (!cards?.length) return <span className={cx('text-sm text-faint', className)}>Flop pending</span>;
  return (
    <span className={cx('inline-flex gap-1', className)} aria-label={`Flop ${cards.join(' ')}`}>
      {cards.map((c, i) => {
        const s = c.slice(-1).toLowerCase();
        const red = s === 'h' || s === 'd';
        return (
          <span key={i} aria-hidden className="inline-grid h-7 min-w-[26px] place-items-center rounded-[6px] bg-card px-1 font-serif text-[13px] leading-none"
            style={{ color: red ? 'var(--color-card-red)' : 'var(--color-card-black)' }}>
            {c.slice(0, -1).replace('T', '10')}{SUIT[s]}
          </span>
        );
      })}
    </span>
  );
}
