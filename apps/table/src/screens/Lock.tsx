import { Wordmark, cx } from '@preflop/ui';
import { Delete, Lock, LockKeyhole } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BigButton } from '../components/controls.tsx';
import { useNow } from '../lib/hooks.ts';
import { type Identity, ROLE_LABEL, saveIdentity } from '../lib/keystore.ts';
import { TabletLock, type UnlockResult, localLockoutStore } from '../lib/lock.ts';
import { PIN_MAX, PIN_MIN, hashPin, pinProblem } from '../lib/pin.ts';
import { ResetTablet } from './Settings.tsx';

/** Masked PIN field with a large on-screen keypad (a hardware keyboard works too). */
export function PinPad({ value, onChange, onSubmit, disabled, label, testid }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; disabled?: boolean | undefined; label: string; testid: string;
}) {
  const press = (d: string) => { if (!disabled && value.length < PIN_MAX) onChange(value + d); };
  return (
    <div className="flex flex-col items-center gap-4">
      <label className="flex w-full max-w-sm flex-col gap-2">
        <span className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">{label}</span>
        <input type="password" inputMode="numeric" autoComplete="off" maxLength={PIN_MAX} value={value} disabled={disabled} data-testid={testid}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, PIN_MAX))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
          className="h-16 rounded-[14px] border border-line-strong bg-surface-2 px-4 text-center font-mono text-3xl tracking-[0.5em] text-ink outline-none focus:border-accent" />
      </label>
      <div className="grid w-full max-w-sm grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" disabled={disabled} onClick={() => press(d)} className="h-16 rounded-[14px] border border-line-strong bg-surface-2 text-2xl font-bold active:border-accent disabled:text-faint">{d}</button>
        ))}
        <button type="button" disabled={disabled} onClick={() => onChange(value.slice(0, -1))} aria-label="Delete digit" className="grid h-16 place-items-center rounded-[14px] border border-line text-muted active:text-ink"><Delete className="h-6 w-6" /></button>
        <button type="button" disabled={disabled} onClick={() => press('0')} className="h-16 rounded-[14px] border border-line-strong bg-surface-2 text-2xl font-bold active:border-accent disabled:text-faint">0</button>
        <button type="button" disabled={disabled || value.length < PIN_MIN} onClick={onSubmit} className="h-16 rounded-[14px] bg-accent text-lg font-bold text-accent-ink disabled:bg-surface-3 disabled:text-faint">OK</button>
      </div>
    </div>
  );
}

/** Full-screen lock. The table screens are not rendered behind it, and nothing is signed. */
export function LockScreen({ id, unlock, waitMs, onReset }: {
  id: Identity; unlock: (pin: string) => Promise<UnlockResult>; waitMs: (now: number) => number; onReset: () => void;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const now = useNow(500);
  const wait = waitMs(now);
  const submit = async () => {
    if (busy || pin.length < PIN_MIN || wait > 0) return;
    setBusy(true);
    const r = await unlock(pin);
    setBusy(false);
    setPin('');
    if (!r.ok) setErr(r.reason === 'wait' ? 'Too many wrong PINs. Wait, then try again.' : `Wrong PIN${r.waitMs ? '. Too many tries: wait before the next one.' : '.'}`);
  };
  const c = id.config;
  return (
    <div className="grid h-full place-items-center overflow-auto p-6" data-testid="lock-screen">
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-[22px] border border-line bg-surface p-8">
        <Wordmark size="sm" />
        <div className="grid h-16 w-16 place-items-center rounded-full bg-accent-soft text-accent"><LockKeyhole className="h-8 w-8" /></div>
        <div className="text-center">
          <h1 className="font-serif text-4xl">Tablet locked</h1>
          <p className="mt-1 text-base text-muted">{ROLE_LABEL[c.role]} · {c.personId} · table <b className="text-ink">{c.tableId}</b></p>
        </div>
        <PinPad value={pin} onChange={(v) => { setPin(v); setErr(null); }} onSubmit={() => void submit()} disabled={busy || wait > 0} label="Staff PIN" testid="unlock-pin" />
        {wait > 0 && <div role="status" className="text-base font-semibold text-warn">Try again in {Math.ceil(wait / 1000)} s</div>}
        {err && wait === 0 && <div role="alert" className="text-base font-semibold text-danger">{err}</div>}
        <details className="w-full text-sm text-muted">
          <summary className="cursor-pointer text-center">Forgot the PIN?</summary>
          <p className="mt-3">The PIN cannot be recovered. Reset this tablet (the signing key is deleted), then ask the club admin to revoke credential <b className="font-mono text-ink">{c.credentialId}</b> and enroll a new key.</p>
          <div className="mt-3"><ResetTablet config={c} onReset={onReset} compact /></div>
        </details>
      </div>
    </div>
  );
}

/** Choose a PIN (after enrollment), or change it (current PIN required). Saves only the hash. */
export function PinSetup({ id, onDone, onCancel, change = false }: { id: Identity; onDone: (next: Identity) => void; onCancel?: () => void; change?: boolean }) {
  const [step, setStep] = useState<'current' | 'new' | 'confirm'>(change ? 'current' : 'new');
  const [current, setCurrent] = useState('');
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setErr(null), [step]);

  const next = async () => {
    if (busy) return;
    if (step === 'current') {
      if (!id.pin) return;
      setBusy(true);
      // Same attempt count and backoff as the lock screen: an unlocked tablet is no way round them.
      const r = await new TabletLock({ now: Date.now(), idleMs: 0, locked: false, store: localLockoutStore() }).verify(current, id.pin, Date.now());
      setBusy(false);
      if (!r.ok) {
        setErr(r.reason === 'wait' ? `Too many wrong PINs. Try again in ${Math.ceil(r.waitMs / 1000)} s.` : 'Wrong PIN.');
        setCurrent('');
        return;
      }
      setStep('new');
      return;
    }
    if (step === 'new') {
      const p = pinProblem(first);
      if (p) { setErr(p); return; }
      setStep('confirm');
      return;
    }
    if (second !== first) { setErr('The PINs do not match. Start again.'); setFirst(''); setSecond(''); setStep('new'); return; }
    setBusy(true);
    try {
      const saved: Identity = { ...id, pin: await hashPin(first) };
      await saveIdentity(saved);
      onDone(saved);
    } catch (e) {
      setErr(`Could not save the PIN (${(e as Error).message}).`);
    } finally {
      setBusy(false);
    }
  };

  const pad = step === 'current'
    ? <PinPad value={current} onChange={setCurrent} onSubmit={() => void next()} disabled={busy} label="Current PIN" testid="pin-current" />
    : step === 'new'
      ? <PinPad value={first} onChange={setFirst} onSubmit={() => void next()} disabled={busy} label={`New PIN (${PIN_MIN}–${PIN_MAX} digits)`} testid="pin-new" />
      : <PinPad value={second} onChange={setSecond} onSubmit={() => void next()} disabled={busy} label="Repeat the PIN" testid="pin-confirm" />;

  return (
    <div className={cx('flex flex-col items-center gap-5', !change && 'grid min-h-full place-items-center p-6')} data-testid="pin-setup">
      <div className={cx('flex w-full max-w-md flex-col items-center gap-5', !change && 'rounded-[22px] border border-line bg-surface p-8')}>
        {!change && (
          <div className="text-center">
            <div className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Last step</div>
            <h1 className="mt-1 flex items-center justify-center gap-3 font-serif text-4xl"><Lock className="h-8 w-8 text-accent" /> Set your staff PIN</h1>
            <p className="mt-2 text-base text-muted">The tablet locks after a few idle minutes and when it wakes up. Only this PIN unlocks it; nothing can be signed while it is locked.</p>
          </div>
        )}
        {pad}
        {err && <div role="alert" className="text-base font-semibold text-danger">{err}</div>}
        {onCancel && <BigButton tone="neutral" className="w-full max-w-sm" onClick={onCancel}>Cancel</BigButton>}
      </div>
    </div>
  );
}
