import { Button, Card, formatMoney } from '@preflop/ui';
import { amountLabel, noCashValueLine } from '../../lib/rooms.ts';
import { resultLine, roundLabel } from '../../lib/flop.ts';
import type { RoundSummary } from '../../lib/rounds.ts';
import { StreamView } from '../StreamView.tsx';
import { Sheet } from '../ui.tsx';

/** Round complete (concept 01, screen 3). */
export function RoundCompleteSheet({ summary, nameOf, voidReason, onNext, onActivity }: {
  summary: RoundSummary | null; nameOf: (id: string) => string; voidReason?: string | undefined; onNext: () => void; onActivity: () => void;
}) {
  if (!summary) return null;
  const s = summary;
  const money = (m: number) => (s.currency === 'DIAMOND' ? formatMoney(m, 'DIAMOND') : formatMoney(m, 'PLAY'));
  const amount = (m: number) => amountLabel(m, s.currency);
  const isVoid = s.status === 'void';
  const names = [...new Set(s.selections.map(nameOf))];
  return (
    <Sheet open onClose={onNext} labelledBy="round-complete-title">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">The flop is out</p>
      <h2 id="round-complete-title" className="mt-2 font-serif text-[30px] leading-tight tracking-[-0.04em]">Round complete</h2>
      <p className="text-sm text-muted">{s.tableName} · {roundLabel(s.handNo)}</p>

      <StreamView cards={s.flop} size="md" revealKey={s.roundId} className="mt-4 h-[190px] rounded-[12px]" />

      <div className="mt-5 text-center" aria-live="polite">
        {isVoid ? (
          <>
            <p className="font-serif text-[34px] leading-tight">Round voided.</p>
            <p className="mt-1 text-[17px] text-ink/90">{amount(s.returnedMinor)} refunded in full.</p>
            {voidReason && <p className="mt-1 text-sm text-muted">{voidReason}</p>}
          </>
        ) : (
          <>
            <p className="font-serif text-[40px] leading-tight">{s.flop ? resultLine(s.flop) : 'Flop dealt.'}</p>
            {s.netMinor > 0 ? (
              <p className="mt-1 text-[22px] font-semibold text-accent">+{amount(s.netMinor)}</p>
            ) : s.returnedMinor > 0 ? (
              <p className="mt-1 text-[17px] text-ink/90">{amount(s.returnedMinor)} returned.</p>
            ) : (
              <p className="mt-1 text-[17px] text-muted">Not this time. Your prediction didn’t land.</p>
            )}
          </>
        )}
      </div>

      <Card className="mt-5 divide-y divide-line">
        <Row label="Prediction" value={names.join(', ')} />
        <Row label="Used" value={`${money(s.usedMinor)}`} />
        <Row label="Returned" value={`${money(s.returnedMinor)}`} accent={s.returnedMinor > 0 && !isVoid} />
      </Card>

      <div className="mt-5 grid gap-3">
        <Button size="lg" onClick={onNext}>Next round</Button>
        <Button size="lg" variant="secondary" onClick={onActivity}>View activity</Button>
      </div>
      <p className="mt-3 text-center text-xs text-muted">{noCashValueLine(s.currency)}</p>
    </Sheet>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-sm text-muted">{label}</span>
      <span className={accent ? 'text-right font-semibold text-accent' : 'text-right font-semibold'}>{value}</span>
    </div>
  );
}
