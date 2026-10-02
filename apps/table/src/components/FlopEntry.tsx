import { PlayingCard } from '@preflop/ui';
import { ArrowLeft, Check } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { isValidFlop, prettyFlop } from '../lib/cards.ts';
import { CardPicker, SelectedFlop } from './CardPicker.tsx';
import { BigButton, HoldButton } from './controls.tsx';

/**
 * Pick three cards → review them large → press and hold SUBMIT. `resetKey` clears the selection
 * when the hand changes, so a pick can never carry over to the next hand.
 */
export function FlopEntry({ title, subtitle, submitLabel = 'Submit flop', busy, onSubmit, resetKey, tone = 'accent', aside }: {
  title: ReactNode; subtitle?: ReactNode; submitLabel?: string; busy?: boolean | undefined; onSubmit: (cards: string[]) => void; resetKey: string;
  tone?: 'accent' | 'warn'; aside?: ReactNode;
}) {
  const [cards, setCards] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => { setCards([]); setReviewing(false); }, [resetKey]);
  const ok = isValidFlop(cards);

  if (reviewing && ok) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-8 py-4" data-testid="flop-review">
        <div className="text-center">
          <div className="font-serif text-4xl">Is this the flop on the table?</div>
          <div className="mt-2 text-lg text-muted">{subtitle}</div>
        </div>
        <div className="felt flex gap-5 rounded-[24px] px-10 py-8 ring-1 ring-white/10">
          {cards.map((c) => <PlayingCard key={c} code={c} size="lg" className="pf-pop" />)}
        </div>
        <div className="font-mono text-xl tracking-widest text-muted" aria-hidden>{prettyFlop(cards)}</div>
        <div className="flex w-full max-w-2xl gap-4">
          <BigButton tone="neutral" className="flex-1" onClick={() => setReviewing(false)} disabled={busy}><ArrowLeft className="h-5 w-5" /> Change</BigButton>
          {/* Signing the flop is press-and-hold, like every other signed step: a stray tap never submits. */}
          <HoldButton tone={tone} className="flex-[2] text-xl" busy={busy} onHold={() => onSubmit(cards)}>
            <span className="inline-flex items-center gap-3" data-testid="flop-submit"><Check className="h-6 w-6" /> {submitLabel}</span>
          </HoldButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4" data-testid="flop-entry">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1 basis-80">
          <div className="font-serif text-3xl leading-tight">{title}</div>
          {subtitle && <div className="mt-1 text-base text-muted">{subtitle}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {aside}
          <SelectedFlop cards={cards} size="sm" onClear={() => setCards([])} />
          <BigButton tone={tone} disabled={!ok} onClick={() => setReviewing(true)} className="min-w-44" data-testid="flop-review-btn">
            {ok ? 'Review' : `Pick ${3 - cards.length} more`}
          </BigButton>
        </div>
      </div>
      <CardPicker value={cards} onChange={setCards} disabled={!!busy} />
    </div>
  );
}
