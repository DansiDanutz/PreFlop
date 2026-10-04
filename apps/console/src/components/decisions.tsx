import type { DecisionHint, ReadingCheck } from '@preflop/client';
import { Badge } from '@preflop/ui';
import { fmtDateTime } from '../lib/format.ts';
import { cardLabel } from '../lib/manualFlop.ts';

/**
 * Decision hints (docs/20): what the decision model suggests, shown beside the operator's own
 * controls. A hint is advice: nothing on these pages happens because of it.
 */

const TONE: Record<string, 'accent' | 'muted' | 'live' | 'info' | 'warn' | 'danger'> = {
  dismiss: 'muted', watch: 'info', pause_table: 'warn', escalate: 'danger',
  settle: 'live', void: 'warn',
};
const LABEL: Record<string, string> = { dismiss: 'dismiss', watch: 'watch', pause_table: 'pause table', escalate: 'escalate', settle: 'settle', void: 'void' };

/** The pick-one answer `question` of a stored hint, as a badge with its confidence. "—" when there is no hint. */
export function ChoiceHint({ hint, question }: { hint: DecisionHint | null | undefined; question: string }) {
  const a = hint?.answers[question];
  if (!hint || !a || a.type !== 'choice') return <span className="text-xs text-muted" title="No suggestion yet (the adviser is off, or has not seen this one)">—</span>;
  const pct = a.confidence !== undefined ? ` · ${Math.round(a.confidence * 100)}%` : '';
  return (
    <span title={`Suggested by ${hint.model ?? 'the decision model'} ${fmtDateTime(hint.at)}. Advice only: the decision is yours.`}>
      <Badge tone={TONE[a.choice] ?? 'muted'} className="!px-2 !py-0.5 !text-[10px]">{LABEL[a.choice] ?? a.choice}{pct}</Badge>
    </span>
  );
}

/** Per-card verdicts of the reading check; nothing when the adviser is off. */
export function ReadingVerdicts({ check }: { check: ReadingCheck | null }) {
  if (!check?.enabled || !check.cards.length) return null;
  const unsure = check.cards.filter((c) => !c.accept);
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs" data-testid="reading-check" title={`Checked by ${check.model ?? 'the decision model'}: the model's probability that pre-filling each card is safe; ✓ from 70 % up, otherwise check the card by eye. Advice only.`}>
      <span className="text-muted">Adviser:</span>
      {check.cards.map((c) => <Badge key={c.card} tone={c.accept ? 'live' : 'warn'} className="!px-2 !py-0.5 !text-[10px]">{cardLabel(c.card)} {c.accept ? '✓' : '?'}{c.confidence !== null ? ` ${Math.round(c.confidence * 100)}% safe` : ''}</Badge>)}
      {unsure.length > 0 && <span className="text-muted">check {unsure.map((c) => cardLabel(c.card)).join(', ')} by eye</span>}
    </span>
  );
}
