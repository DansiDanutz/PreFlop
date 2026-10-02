import { cx } from '@preflop/ui';
import { ChartNoAxesColumnIncreasing, Crown, Diamond, Hash, Heart, Layers, Palette, Sigma, Spade, type LucideIcon } from 'lucide-react';
import type { BetOption } from '../lib/bets.ts';

/** Outline icons for the four main prediction tiles (concept screen 4). */
export function HandIcon({ kind, className }: { kind: 'pair' | 'flush' | 'straight' | 'high-card'; className?: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  return (
    <svg viewBox="0 0 32 32" className={cx('h-7 w-7', className)} aria-hidden>
      {kind === 'pair' && (
        <>
          <rect x="5" y="7" width="13" height="18" rx="2.5" transform="rotate(-10 11.5 16)" {...common} />
          <rect x="14" y="7" width="13" height="18" rx="2.5" transform="rotate(8 20.5 16)" {...common} />
        </>
      )}
      {kind === 'flush' && (
        <path d="M16 5c3 4.5 9 7.8 9 12.5a4.6 4.6 0 0 1-8 3.1l1.3 5.4h-4.6l1.3-5.4a4.6 4.6 0 0 1-8-3.1C7 12.8 13 9.5 16 5Z" {...common} />
      )}
      {kind === 'straight' && (
        <>
          <rect x="5" y="17" width="6" height="9" rx="1.5" {...common} />
          <rect x="13" y="12" width="6" height="14" rx="1.5" {...common} />
          <rect x="21" y="6" width="6" height="20" rx="1.5" {...common} />
        </>
      )}
      {kind === 'high-card' && (
        <>
          <rect x="8.5" y="5" width="15" height="22" rx="2.5" {...common} />
          <path d="M13 21l3-9 3 9M14.1 18h3.8" {...common} />
        </>
      )}
    </svg>
  );
}

/** Icon for any book selection, by market. */
export function iconFor(o: Pick<BetOption, 'id' | 'marketId' | 'category'>): LucideIcon | 'pair' | 'flush' | 'straight' | 'high-card' {
  if (o.id.endsWith(':pair') || o.marketId.startsWith('pair') || o.marketId === 'paired-board') return 'pair';
  if (o.marketId === 'suit-pattern' || o.marketId === 'monotone-suit' || o.id === 'hand-class:flush') return 'flush';
  if (o.marketId === 'straight' || o.marketId === 'exact-straight' || o.id === 'hand-class:straight') return 'straight';
  if (o.id === 'hand-class:high-card') return 'high-card';
  if (o.marketId.includes('ace') || o.marketId === 'broadway' || o.marketId === 'face-count') return Crown;
  switch (o.category) {
    case 'colors':
      return o.id.includes('black') ? Spade : Heart;
    case 'suits':
      return Diamond;
    case 'ranks':
      return Hash;
    case 'sequences':
      return ChartNoAxesColumnIncreasing;
    case 'more':
      return o.marketId.startsWith('sum') ? Sigma : Palette;
    default:
      return Layers;
  }
}

export function OptionIcon({ option, className }: { option: Pick<BetOption, 'id' | 'marketId' | 'category'>; className?: string }) {
  const I = iconFor(option);
  if (typeof I === 'string') return <HandIcon kind={I} className={className ?? 'h-6 w-6'} />;
  return <I className={className ?? 'h-6 w-6'} strokeWidth={1.6} aria-hidden />;
}
