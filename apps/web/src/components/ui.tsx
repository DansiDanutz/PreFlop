import { Button, Card, cx } from '@preflop/ui';
import { ArrowLeft, CircleAlert, Search, X } from 'lucide-react';
import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useEffect, useId, useRef } from 'react';
import { useNavigate } from 'react-router';

/** Small app-level building blocks shared by the player app and the website. */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('pf-skeleton rounded-[14px]', className)} />;
}

export function SerifHeading({ children, className, as: As = 'h1' }: { children: ReactNode; className?: string; as?: 'h1' | 'h2' | 'h3' }) {
  return <As className={cx('font-serif text-[30px] leading-[1.1] tracking-tight text-ink', className)}>{children}</As>;
}

export function BackButton({ to, label = 'Back', onClick }: { to?: string; label?: string; onClick?: () => void }) {
  const nav = useNavigate();
  return (
    <button type="button" aria-label={label} onClick={() => (onClick ? onClick() : to ? nav(to) : nav(-1))}
      className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink hover:border-accent hover:text-accent">
      <ArrowLeft className="h-5 w-5" />
    </button>
  );
}

export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <label className="flex h-12 items-center gap-3 rounded-[8px] border border-line-strong/70 bg-surface px-4 focus-within:border-accent">
      <Search className="h-5 w-5 shrink-0 text-muted" aria-hidden />
      <span className="sr-only">{label}</span>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none" />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search" className="text-muted hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      )}
    </label>
  );
}

export function Pill({ active, children, onClick, className }: { active: boolean; children: ReactNode; onClick: () => void; className?: string }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={cx('inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[8px] border px-3.5 text-[14px] transition-colors',
        active ? 'border-accent bg-accent font-semibold text-accent-ink' : 'border-line-strong text-ink/90 hover:border-accent/60', className)}>
      {children}
    </button>
  );
}

/** Text tabs with a raised active state (lobby and activity filters). */
export function Tabs<T extends string>({ options, value, onChange, label, className }: {
  options: readonly { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string; className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx('flex gap-1', className)}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}
          className={cx('inline-flex h-11 shrink-0 items-center gap-2 rounded-[8px] border px-4 text-[15px] transition-colors',
            value === o.id ? 'border-line-strong bg-surface-3 text-ink' : 'border-transparent text-ink/80 hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Uppercase accent label above a serif heading. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-[11px] font-bold uppercase tracking-[0.2em] text-accent', className)}>{children}</p>;
}

export function ErrorState({ title = 'Something went wrong', children, onRetry }: { title?: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <Card role="alert" className="flex flex-col items-center gap-3 p-6 text-center">
      <CircleAlert className="h-6 w-6 text-warn" aria-hidden />
      <div className="font-serif text-xl">{title}</div>
      {children && <div className="text-sm text-muted">{children}</div>}
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </Card>
  );
}

export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'danger' | 'accent'; children: ReactNode; className?: string }) {
  const t = { info: 'border-info/40 bg-info/10 text-ink', warn: 'border-warn/40 bg-warn/10 text-ink', danger: 'border-danger/40 bg-danger/10 text-ink', accent: 'border-accent/40 bg-accent-soft text-ink' }[tone];
  return <div role={tone === 'danger' || tone === 'warn' ? 'alert' : 'status'} className={cx('rounded-[14px] border px-4 py-3 text-sm', t, className)}>{children}</div>;
}

// ------------------------------------------------------------------ form fields

const inputCls = 'h-12 w-full rounded-[8px] border border-line-strong bg-surface-2 px-4 text-[15px] text-ink placeholder:text-faint focus:border-accent focus:outline-none';

export function Field({ label, hint, error, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      <input id={id} className={inputCls} aria-invalid={!!error} aria-describedby={hint || error ? `${id}-h` : undefined} {...p} />
      {(hint || error) && <div id={`${id}-h`} className={cx('mt-1.5 text-xs', error ? 'text-danger' : 'text-muted')}>{error ?? hint}</div>}
    </div>
  );
}

export function TextArea({ label, className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      <textarea id={id} className={cx(inputCls, 'h-28 py-3')} {...p} />
    </div>
  );
}

export function Select({ label, className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      <select id={id} className={inputCls} {...p}>{children}</select>
    </div>
  );
}

// ------------------------------------------------------------------ sheet / dialog

/** Bottom sheet on phones, centered dialog on wide screens. Escape and the backdrop close it. */
export function Sheet({ open, onClose, title, children, labelledBy, wide = false }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; labelledBy?: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    // Focus the dialog itself; Tab then moves into its controls.
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="pf-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : title} aria-labelledby={labelledBy}
        className={cx('pf-sheet-in max-h-[92dvh] w-full overflow-y-auto outline-none rounded-t-[16px] border border-line-strong/70 bg-surface p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:rounded-[14px] sm:p-7', wide ? 'max-w-[640px]' : 'max-w-[460px]')}>
        {children}
      </div>
    </div>
  );
}
