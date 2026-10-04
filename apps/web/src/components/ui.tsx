import { Button, Card, cx } from '@preflop/ui';
import { ArrowLeft, CircleAlert, Search, X } from 'lucide-react';
import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useEffect, useId, useRef } from 'react';
import { useNavigate } from 'react-router';
import { createPortal } from 'react-dom';

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
    // On the narrowest phones the row scrolls sideways inside itself instead of widening the page.
    <div role="group" aria-label={label} className={cx('flex max-w-full gap-1 overflow-x-auto [scrollbar-width:none]', className)}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}
          className={cx('inline-flex h-11 shrink-0 items-center gap-2 rounded-[8px] border px-3 text-[14px] transition-colors min-[360px]:px-4 min-[360px]:text-[15px]',
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

export function Select({ label, className, children, error, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string | null | undefined }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      <select id={id} className={inputCls} aria-invalid={!!error} aria-describedby={error ? `${id}-h` : undefined} {...p}>{children}</select>
      {error && <div id={`${id}-h`} className="mt-1.5 text-xs text-danger">{error}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ sheet / dialog

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * Focus trap step: where Tab (or Shift+Tab) should go from `current` among a dialog's focusable
 * elements, or null to let the browser move on. Wraps at both ends; from the dialog itself (or
 * anything outside the list) Tab goes to the first control and Shift+Tab to the last.
 */
export function trapFocus<T>(items: readonly T[], current: T | null, shift: boolean): T | null {
  if (!items.length) return null;
  const i = current === null ? -1 : items.indexOf(current);
  if (i === -1) return shift ? items[items.length - 1]! : items[0]!;
  if (shift && i === 0) return items[items.length - 1]!;
  if (!shift && i === items.length - 1) return items[0]!;
  return null;
}

/** The part of an Element that inertOutside needs (a real DOM element, or a test double). */
export interface InertNode {
  readonly tagName: string;
  readonly parentElement: InertNode | null;
  readonly children: ArrayLike<InertNode>;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

const MODAL_MARK = 'data-pf-inert';

/**
 * Open sheets in opening order. Every sheet is portalled straight into <body>, so the page and the
 * sheets are siblings there and modality is one rule over <body>'s children: everything except the
 * top sheet is inert, earlier sheets included. A sheet that opens while another is open (a bet
 * settling behind the reality check) is never itself inside an inert subtree, and closing either
 * one, in any order, leaves the right one active.
 */
export function applyModalStack(body: InertNode, stack: readonly InertNode[]): void {
  const top = stack[stack.length - 1] ?? null;
  for (const el of Array.from(body.children)) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    const want = top !== null && el !== top;
    // Only touch what this rule set (MODAL_MARK): an element inert for another reason stays so.
    if (want && !el.hasAttribute('inert')) { el.setAttribute('inert', ''); el.setAttribute(MODAL_MARK, ''); }
    else if (!want && el.hasAttribute(MODAL_MARK)) { el.removeAttribute('inert'); el.removeAttribute(MODAL_MARK); }
  }
}

const openSheets: HTMLElement[] = [];

/**
 * Bottom sheet on phones, centered dialog on wide screens. Escape and the backdrop close it. Focus
 * moves into it on open, Tab and Shift+Tab cycle inside it, and focus returns to the opener on close.
 * It is aria-modal and portalled into <body>; while it is the top sheet, the page and any earlier
 * sheet are inert (applyModalStack), so neither the keyboard, the pointer nor a screen reader's
 * virtual cursor can reach what is behind it.
 */
export function Sheet({ open, onClose, title, children, labelledBy, wide = false }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; labelledBy?: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  // The latest onClose, so a parent passing a new function each render does not re-run the
  // open effect (which would pull focus out of an input on every keystroke).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const me = backdrop.current;
    if (me) { openSheets.push(me); applyModalStack(document.body, openSheets); }
    // Focus the dialog itself once on open; Tab then moves into its controls.
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Escape' && e.key !== 'Tab') || !ref.current) return;
      // With sheets stacked, only the top one (the last opened) handles Escape and traps focus.
      if (openSheets[openSheets.length - 1] !== me) return;
      if (e.key === 'Escape') { closeRef.current(); return; }
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && ref.current.contains(active);
      if (!items.length) { e.preventDefault(); ref.current.focus(); return; }
      const next = trapFocus(items, inside ? active : null, e.shiftKey);
      if (next) { e.preventDefault(); next.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const at = me ? openSheets.indexOf(me) : -1;
      if (at !== -1) { openSheets.splice(at, 1); applyModalStack(document.body, openSheets); }
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  const sheet = (
    <div ref={backdrop} className="pf-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : title} aria-labelledby={labelledBy}
        className={cx('pf-sheet-in max-h-[92dvh] w-full overflow-y-auto outline-none rounded-t-[16px] border border-line-strong/70 bg-surface p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:rounded-[14px] sm:p-7', wide ? 'max-w-[640px]' : 'max-w-[460px]')}>
        {children}
      </div>
    </div>
  );
  // On the server (and in tests without a DOM) there is no <body> to portal into.
  return typeof document === 'undefined' ? sheet : createPortal(sheet, document.body);
}
