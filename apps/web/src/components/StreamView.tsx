import { CardBack, PlayingCard, cx } from '@preflop/ui';
import { Maximize } from 'lucide-react';
import type { ReactNode } from 'react';

export type FeltTheme = 'green' | 'blue' | 'violet';
const THEME_CLASS: Record<FeltTheme, string> = { green: '', blue: 'felt-blue', violet: 'felt-violet' };

/** A stable felt colour per club, so each club's tables share a look. */
export function feltTheme(key: string | null | undefined): FeltTheme {
  if (!key) return 'green';
  if (/midnight|meridian/i.test(key)) return 'blue';
  if (/noir|salon|prive|violet/i.test(key)) return 'violet';
  if (/atlas|green/i.test(key)) return 'green';
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (['green', 'blue', 'violet'] as const)[h % 3]!;
}

/** "Table 04" → "TABLE 04", for the small embossed label on the felt. */
export function feltLabel(name: string | null | undefined): string | null {
  const m = name?.match(/table\s*(\d+)/i);
  return m ? `TABLE ${m[1]!.padStart(2, '0')}` : null;
}

/**
 * The table felt. Every live table today is simulated (docs/06 #7), so this shows the table's
 * real flop data on a CSS felt with a SIMULATED TABLE tag, never a fake video.
 */
export function StreamView({
  cards, size = 'md', revealKey, unavailable = false, onExpand, className, badge = true, watermark = true, theme = 'green', label, action,
}: {
  cards: readonly string[] | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  /** Changing this replays the reveal animation (e.g. the round id of a freshly dealt flop). */
  revealKey?: string | null;
  unavailable?: boolean;
  onExpand?: () => void;
  className?: string;
  badge?: boolean;
  watermark?: boolean;
  theme?: FeltTheme;
  /** Small embossed label, e.g. TABLE 04. */
  label?: string | null;
  /** A control in the top-right corner (e.g. the save-table star). */
  action?: ReactNode;
}) {
  const gap = size === 'lg' ? 'gap-2.5 sm:gap-3' : 'gap-[9px]';
  return (
    <div className={cx('felt felt-noise relative isolate overflow-hidden', unavailable ? 'felt-grey' : THEME_CLASS[theme], className)}>
      <span aria-hidden className="felt-ring" />
      {watermark && (
        <span aria-hidden className={cx('absolute inset-x-0 text-center font-serif italic tracking-[-0.05em] text-[#e0e6cb]/25',
          size === 'lg' ? 'bottom-6 text-[28px]' : 'bottom-4 text-[17px]')}>
          PreFlop
        </span>
      )}
      {label && <span aria-hidden className="absolute bottom-3 right-4 text-[8px] tracking-[0.18em] text-white/30">{label}</span>}
      <div key={revealKey ?? 'static'} className={cx('absolute inset-0 z-[2] flex items-center justify-center pb-3', gap, revealKey && 'pf-reveal', unavailable && 'opacity-35 grayscale')}>
        {[0, 1, 2].map((i) => {
          const c = cards?.[i];
          return c ? <PlayingCard key={i} code={c} size={size} /> : <CardBack key={i} size={size} />;
        })}
      </div>
      {unavailable && (
        <span className="absolute left-1/2 top-1/2 z-[5] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[8px] bg-black/75 px-3.5 py-2 text-[13px] text-ink">
          Table unavailable
        </span>
      )}
      {(badge || action || onExpand) && (
        <div className="absolute inset-x-3 top-3 z-[5] flex items-start justify-between">
          {badge ? (
            <span className={cx('inline-flex items-center gap-1.5 rounded-[4px] border border-[#6c8a6f]/25 bg-[#101a15]/75 px-2 py-[5px] text-[8.5px] font-medium tracking-[0.09em] text-[#c4d3c8]', unavailable && 'opacity-50')}>
              <span className="h-1 w-1 rounded-full bg-[#bccdbb]" /> SIMULATED TABLE
            </span>
          ) : <span />}
          {action}
          {onExpand && (
            <button type="button" onClick={onExpand} aria-label="Expand table view" className="grid h-9 w-9 place-items-center rounded-[8px] text-white/85 hover:bg-black/30">
              <Maximize className="h-5 w-5" strokeWidth={1.6} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
