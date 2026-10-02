import { Badge, CardBack, PlayingCard, cx } from '@preflop/ui';
import { Maximize2, VideoOff } from 'lucide-react';

/**
 * The felt "stream" area. Every live table today is simulated (docs/06 #7), so this shows the
 * table's real flop data on a CSS felt, with a DEMO STREAM badge, never a fake video.
 */
export function StreamView({
  cards, size = 'md', revealKey, unavailable = false, onExpand, className, badge = true, watermark = true, cardScale = 1,
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
  /** Shrinks the cards to fit small thumbnails. */
  cardScale?: number;
}) {
  const gap = size === 'sm' ? 'gap-1.5' : size === 'md' ? 'gap-2.5' : 'gap-3';
  return (
    <div className={cx('felt felt-vignette relative isolate overflow-hidden', className)}>
      {watermark && (
        <span aria-hidden className={cx('pf-watermark absolute left-1/2 -translate-x-1/2', size === 'sm' ? 'bottom-1 text-[20px]' : 'bottom-2 text-[40px]')}>
          PreFlop
        </span>
      )}
      {unavailable ? (
        <div className="absolute inset-0 grid place-items-center text-muted">
          <VideoOff className="h-7 w-7" aria-label="Stream unavailable" />
        </div>
      ) : (
        <div key={revealKey ?? 'static'} className={cx('absolute inset-0 flex items-center justify-center', gap, revealKey && 'pf-reveal', size === 'sm' && badge && 'pt-4')}
          style={cardScale !== 1 ? { transform: `scale(${cardScale})`, transformOrigin: '50% 60%' } : undefined}>
          {[0, 1, 2].map((i) => {
            const c = cards?.[i];
            return c ? <PlayingCard key={i} code={c} size={size} /> : <CardBack key={i} size={size} />;
          })}
        </div>
      )}
      {badge && !unavailable && (
        <Badge tone="live" className={cx(size === 'sm' ? 'absolute left-1.5 top-1.5 gap-1! px-1.5! py-0! text-[8px]! tracking-wide!' : 'absolute left-2 top-2')}>
          Demo stream
        </Badge>
      )}
      {onExpand && (
        <button type="button" onClick={onExpand} aria-label="Expand stream"
          className="absolute bottom-2.5 right-2.5 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white/90 hover:bg-black/60">
          <Maximize2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
