import { Spinner, cx } from '@preflop/ui';
import { AlertTriangle, RotateCw, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { inertSiblings, restoreFocus, trapTab } from '../lib/focus.ts';
import type { Runner } from '../lib/hooks.ts';

type Tone = 'accent' | 'danger' | 'warn' | 'neutral';
const TONE: Record<Tone, string> = {
  accent: 'bg-accent text-accent-ink active:bg-accent-strong disabled:bg-surface-3 disabled:text-faint',
  danger: 'bg-danger text-white active:brightness-110 disabled:bg-surface-3 disabled:text-faint',
  warn: 'bg-warn text-black active:brightness-110 disabled:bg-surface-3 disabled:text-faint',
  neutral: 'bg-surface-2 text-ink border border-line-strong active:border-accent disabled:text-faint',
};

/** Large touch button (min 56 px). */
export function BigButton({ tone = 'accent', className, busy, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; busy?: boolean | undefined }) {
  // A caller's text size wins over the default (Tailwind would otherwise pick by CSS order).
  const sized = /(^|\s)text-(xs|sm|base|lg|xl|[2-9]xl)(\s|$)/.test(className ?? '');
  return (
    <button type="button" {...p} disabled={p.disabled || busy}
      className={cx('inline-flex min-h-14 items-center justify-center gap-3 rounded-[16px] px-6 font-bold tracking-wide transition-[filter,background-color] disabled:cursor-not-allowed', !sized && 'text-lg', TONE[tone], className)}>
      {busy ? <Spinner className="border-t-current" /> : null}
      {children}
    </button>
  );
}

/**
 * Press-and-hold button: the action fires only after `ms` of continuous press, so a stray tap
 * never starts a hand. Works with touch, mouse, pen and keyboard (hold Space/Enter).
 */
export function HoldButton({ onHold, ms = 600, tone = 'accent', disabled, busy, className, children, hint = 'Press and hold' }: {
  onHold: () => void; ms?: number; tone?: Tone; disabled?: boolean | undefined; busy?: boolean | undefined; className?: string | undefined; children: ReactNode; hint?: string;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const start = () => {
    if (disabled || busy || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      if (navigator.vibrate) navigator.vibrate(40);
      onHold();
    }, ms);
  };
  useEffect(() => stop, []);
  return (
    <button type="button" disabled={disabled || busy} aria-label={typeof children === 'string' ? `${children} (press and hold)` : undefined}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); start(); }}
      onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop} onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } }}
      onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') stop(); }}
      className={cx('relative isolate inline-flex min-h-14 flex-col items-center justify-center overflow-hidden rounded-[20px] px-8 font-bold tracking-wide disabled:cursor-not-allowed', TONE[tone], className)}
      style={{ ['--hold-ms' as string]: `${ms}ms` }}>
      <span className={cx('hold-fill absolute inset-0 -z-10 bg-white/30', holding && 'holding')} />
      <span className="inline-flex items-center gap-3">{busy ? <Spinner className="border-t-current" /> : null}{children}</span>
      <span className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] opacity-70">{holding ? 'Keep holding…' : hint}</span>
    </button>
  );
}

/** The failed write with its message; RETRY reuses the same Idempotency-Key. */
export function ActionStatus({ runner, className }: { runner: Runner; className?: string }) {
  const f = runner.failed;
  if (!f) return null;
  return (
    <div role="alert" className={cx('pf-pop flex items-center gap-4 rounded-[16px] border px-5 py-4', f.retryable ? 'border-warn/60 bg-warn/10' : 'border-danger/60 bg-danger/10', className)}>
      <AlertTriangle className={cx('h-7 w-7 shrink-0', f.retryable ? 'text-warn' : 'text-danger')} />
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold">{f.action.label}: {f.retryable ? 'no confirmation' : 'refused'}</div>
        <div className="text-sm text-muted">{f.problem.message}</div>
      </div>
      {f.retryable && (
        <BigButton tone="warn" onClick={() => void runner.retry()} busy={!!runner.pending}>
          <RotateCw className="h-5 w-5" /> Retry
        </BigButton>
      )}
      <button type="button" onClick={runner.dismiss} className="grid h-14 w-14 place-items-center rounded-full text-muted active:text-ink" aria-label="Dismiss">
        <X className="h-6 w-6" />
      </button>
    </div>
  );
}

/**
 * Modal sheet with dialog semantics: role="dialog", aria-modal, labelled by its title. Rendered
 * into <body> so the rest of the page can be made inert while it is open; Tab / Shift+Tab stay
 * inside, Escape closes, and focus returns to the opener on close (lib/focus.ts).
 */
export function Sheet({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const titleId = useId();
  const overlay = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // The opener is read during the first render, before anything in the sheet can take focus.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useLayoutEffect(() => {
    const undoInert = inertSiblings(document.body, overlay.current!);
    return () => {
      undoInert();
      restoreFocus(opener);
    };
  }, [opener]);
  useEffect(() => {
    // A child with autoFocus already has focus; otherwise start on the dialog itself, never on a
    // confirm button.
    const p = panel.current;
    if (p && !p.contains(document.activeElement)) p.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Portals bubble through the React tree: only the innermost sheet closes.
      e.stopPropagation();
      e.preventDefault();
      close.current();
      return;
    }
    if (e.key === 'Tab' && panel.current) {
      e.stopPropagation();
      trapTab(panel.current, e, document.activeElement);
    }
  };
  return createPortal(
    <div ref={overlay} className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}
        className={cx('pf-pop max-h-[92vh] w-full overflow-auto rounded-[22px] border border-line-strong bg-surface p-6 shadow-2xl outline-none', wide ? 'max-w-3xl' : 'max-w-lg')} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id={titleId} className="font-serif text-2xl">{title}</h2>
          <button type="button" onClick={onClose} className="grid h-12 w-12 place-items-center rounded-full border border-line text-muted active:text-ink" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Pill choice grid, ≥ 56 px. */
export function Choice<T extends string>({ options, value, onChange, render, cols = 3 }: { options: readonly T[]; value: T | null; onChange: (v: T) => void; render?: (v: T) => ReactNode; cols?: number }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)}
          className={cx('min-h-14 rounded-[14px] border px-3 text-base font-semibold transition-colors',
            o === value ? 'border-accent bg-accent-soft text-ink shadow-[var(--shadow-glow)]' : 'border-line-strong text-ink/90 active:border-accent/60')}>
          {render ? render(o) : o}
        </button>
      ))}
    </div>
  );
}
