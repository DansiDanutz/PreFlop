import { Button } from '@preflop/ui';
import { Sheet } from '../ui.tsx';

/**
 * "Confirm this stake?": shown before a stake above 25% of the balance (or an all-in) is placed,
 * with the stake and what it returns if it wins.
 */
export function StakeConfirmSheet({ open, onClose, onConfirm, stake, potential, share, allIn, selection, busy = false }: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  /** Formatted stake, e.g. "2,500 free chips" or "800 points". */
  stake: string;
  /** Formatted total return if correct, or a phrase such as "A share of the pool". */
  potential: string;
  /** Share of the balance, 0–1. */
  share: number;
  allIn: boolean;
  selection: string;
  busy?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="stake-confirm-title">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-warn">{allIn ? 'All in' : 'Large stake'}</p>
      <h2 id="stake-confirm-title" className="mt-2 font-serif text-[28px] leading-tight tracking-[-0.03em]">{allIn ? 'Put everything on this flop?' : 'Confirm this stake?'}</h2>
      <p className="mt-2 text-sm text-muted">
        {allIn ? 'This stake is your whole balance.' : `This stake is ${Math.round(share * 100)}% of your balance.`} Take a second before you place it.
      </p>
      <dl className="mt-5 divide-y divide-line rounded-[12px] border border-line-strong/60 bg-surface-2">
        <div className="flex items-center justify-between gap-4 px-4 py-3"><dt className="text-sm text-muted">Prediction</dt><dd className="text-right font-semibold">{selection}</dd></div>
        <div className="flex items-center justify-between gap-4 px-4 py-3"><dt className="text-sm text-muted">Stake</dt><dd className="text-right font-semibold" data-testid="confirm-stake">{stake}</dd></div>
        <div className="flex items-center justify-between gap-4 px-4 py-3"><dt className="text-sm text-muted">Returns if correct</dt><dd className="text-right font-semibold text-accent" data-testid="confirm-potential">{potential}</dd></div>
      </dl>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={onClose}>Change stake</Button>
        <Button disabled={busy} onClick={onConfirm}>{busy ? 'Placing…' : 'Confirm'}</Button>
      </div>
    </Sheet>
  );
}
