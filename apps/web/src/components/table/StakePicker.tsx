import { Segmented, formatMoney } from '@preflop/ui';
import { useId, useState } from 'react';
import { amountLabel, balanceLabel } from '../../lib/rooms.ts';

/** Stake selector: 50 · 100 · 250 pills (concept) plus a custom amount. */
export function StakePicker({ value, onChange, balance, presets, currency, minStake = 1 }: {
  value: number; onChange: (v: number) => void; balance: number | null; presets: readonly number[]; currency: string; minStake?: number;
}) {
  const preset = presets.includes(value);
  const [custom, setCustom] = useState(!preset);
  const id = useId();
  const fmt = (v: number) => (currency === 'DIAMOND' ? formatMoney(v, 'DIAMOND') : formatMoney(v, 'PLAY'));
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[15px] font-semibold">{balanceLabel(currency)}</span>
        <button type="button" onClick={() => setCustom((c) => !c)} className="text-sm text-accent hover:underline" aria-expanded={custom} aria-controls={id}>
          {custom ? 'Use presets' : 'Custom amount'}
        </button>
      </div>
      {custom ? (
        <div id={id} className="flex items-center gap-3">
          <label className="sr-only" htmlFor={`${id}-in`}>Custom stake</label>
          <input id={`${id}-in`} type="number" inputMode="numeric" min={minStake} step={1} value={value || ''}
            onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            className="h-11 flex-1 rounded-full border border-accent bg-accent-soft px-5 text-[15px] font-semibold text-ink focus:outline-none" />
          {balance !== null && balance > 0 && (
            <button type="button" onClick={() => onChange(balance)} className="h-11 rounded-full border border-line-strong px-4 text-sm font-semibold hover:border-accent">Max</button>
          )}
        </div>
      ) : (
        <Segmented options={presets} value={preset ? value : -1} onChange={onChange} render={fmt} />
      )}
      {balance !== null && value > balance && <p className="text-xs text-warn">More than your {amountLabel(balance, currency)}.</p>}
      {value > 0 && value < minStake && <p className="text-xs text-warn">The minimum stake here is {amountLabel(minStake, currency)}.</p>}
    </div>
  );
}
