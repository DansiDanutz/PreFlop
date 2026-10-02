import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useMutation, useQueryClient, type QueryKey, type UseQueryResult } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, Copy, Construction, RefreshCw, X } from 'lucide-react';
import { Button, Card, cx, Spinner } from '@preflop/ui';
import { errorMessage, isNotAvailable } from '../lib/format.ts';

// ------------------------------------------------------------------ page scaffolding

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-faint">{eyebrow}</div>}
        <h1 className="font-serif text-[34px] leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, subtitle, actions, children, className }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cx('p-5', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="font-serif text-xl leading-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </Card>
  );
}

export function Kpi({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'accent' | 'warn' | 'danger' | undefined }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className={cx('mt-2 text-[28px] font-semibold leading-none tabular-nums', tone === 'accent' && 'text-accent', tone === 'warn' && 'text-warn', tone === 'danger' && 'text-danger')}>{value}</div>
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function Callout({ tone = 'info', title, children, icon }: { tone?: 'info' | 'warn' | 'danger' | 'accent'; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const t = { info: 'border-info/40 bg-info/10', warn: 'border-warn/40 bg-warn/10', danger: 'border-danger/50 bg-danger/10', accent: 'border-accent/40 bg-accent-soft' }[tone];
  const ic = { info: 'text-info', warn: 'text-warn', danger: 'text-danger', accent: 'text-accent' }[tone];
  return (
    <div className={cx('flex gap-3 rounded-[14px] border px-4 py-3 text-sm', t)} role={tone === 'danger' ? 'alert' : undefined}>
      <span className={cx('mt-0.5 shrink-0', ic)}>{icon ?? <AlertTriangle size={16} aria-hidden />}</span>
      <div className="min-w-0">
        {title && <div className="font-semibold text-ink">{title}</div>}
        {children && <div className="text-muted [&_strong]:text-ink">{children}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ query states

export function NotAvailable({ what }: { what: string }) {
  return (
    <div className="rounded-[18px] border border-dashed border-line-strong px-6 py-10 text-center">
      <Construction className="mx-auto text-warn" size={28} aria-hidden />
      <div className="mt-3 font-serif text-xl">Not available yet</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">
        The API does not serve <strong className="text-ink">{what}</strong> on this environment yet. This page will fill in automatically once the endpoint is deployed.
      </p>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-danger/50 bg-danger/10 px-4 py-3 text-sm" role="alert">
      <span className="flex items-center gap-2 text-ink"><AlertTriangle size={16} className="text-danger" aria-hidden />{errorMessage(error)}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}><RefreshCw size={14} aria-hidden />Retry</Button>}
    </div>
  );
}

export function Loading({ label = 'Loading…', rows = 0 }: { label?: string; rows?: number }) {
  if (rows > 0) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label={label}>
        {Array.from({ length: rows }, (_, i) => <div key={i} className="h-10 animate-pulse rounded-[10px] bg-surface-2" />)}
      </div>
    );
  }
  return <div className="flex items-center gap-3 py-8 text-sm text-muted" aria-busy="true"><Spinner />{label}</div>;
}

/** Renders loading / not-available / error states, then children with the data. */
export function QueryView<T>({ q, what, children, rows = 4 }: { q: UseQueryResult<T>; what: string; children: (data: T) => ReactNode; rows?: number }) {
  if (q.isPending) return <Loading rows={rows} label={`Loading ${what}…`} />;
  if (q.isError) {
    if (isNotAvailable(q.error)) return <NotAvailable what={what} />;
    return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  }
  return <>{children(q.data)}</>;
}

// ------------------------------------------------------------------ toasts

type Toast = { id: number; tone: 'ok' | 'error'; text: string };
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex items-start gap-2 rounded-[14px] border bg-surface-2 px-4 py-3 text-sm shadow-xl', t.tone === 'ok' ? 'border-accent/50' : 'border-danger/60')}>
            {t.tone === 'ok' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />}
            <span className="min-w-0 flex-1 break-words">{t.text}</span>
            <button className="text-faint hover:text-ink" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** A mutation that toasts its outcome and invalidates the given query keys. */
export function useAction<A, R>(fn: (a: A) => Promise<R>, o: { invalidate?: QueryKey[]; success?: string | ((r: R, a: A) => string); onSuccess?: (r: R, a: A) => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, a) => {
      o.invalidate?.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
      if (o.success) toast('ok', typeof o.success === 'function' ? o.success(r, a) : o.success);
      o.onSuccess?.(r, a);
    },
    onError: (e) => toast('error', isNotAvailable(e) ? 'This action is not available on the API yet.' : errorMessage(e)),
  });
}

// ------------------------------------------------------------------ dialogs

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cx('m-auto w-[calc(100vw-2rem)] rounded-[18px] border border-line-strong bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-[2px]', wide ? 'max-w-3xl' : 'max-w-lg')}>
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            <h2 id={titleId} className="font-serif text-xl">{title}</h2>
            <button type="button" onClick={onClose} className="rounded-full p-1 text-muted hover:text-ink" aria-label="Close"><X size={18} /></button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation for destructive actions; optionally requires a reason and/or typing a phrase. */
export function ConfirmDialog({ open, onClose, onConfirm, title, children, confirmLabel = 'Confirm', danger = true, reason, typePhrase, busy }: {
  open: boolean; onClose: () => void; onConfirm: (reason: string) => void; title: ReactNode; children?: ReactNode;
  confirmLabel?: string; danger?: boolean; reason?: { label: string; placeholder?: string; min?: number } | undefined; typePhrase?: string | undefined; busy?: boolean;
}) {
  const [text, setText] = useState('');
  const [typed, setTyped] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setText(''); setTyped(''); setTouched(false); } }, [open]);
  const reasonErr = reason && text.trim().length < (reason.min ?? 3) ? `Enter a reason (at least ${reason.min ?? 3} characters).` : null;
  const phraseErr = typePhrase && typed.trim() !== typePhrase ? `Type ${typePhrase} to confirm.` : null;
  const submit = () => { setTouched(true); if (!reasonErr && !phraseErr) onConfirm(text.trim()); };
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} size="sm" onClick={submit} disabled={busy}>{busy && <Spinner className="h-4 w-4" />}{confirmLabel}</Button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
        {children && <div className="text-sm text-muted [&_strong]:text-ink">{children}</div>}
        {reason && (
          <Field label={reason.label} error={touched ? reasonErr : null}>
            {(p) => <TextInput {...p} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={reason.placeholder} />}
          </Field>
        )}
        {typePhrase && (
          <Field label={<>Type <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-ink">{typePhrase}</code> to confirm</>} error={touched ? phraseErr : null}>
            {(p) => <TextInput {...p} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ form fields

const inputCls = 'w-full rounded-[10px] border border-line-strong bg-surface-2 px-3 text-[14px] text-ink placeholder:text-faint outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-60 aria-[invalid=true]:border-danger';

type FieldProps = { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined };

export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: string | null | undefined; children: (p: FieldProps) => ReactNode; className?: string }) {
  const id = useId();
  const desc = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-muted">{label}</label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': desc })}
      {error ? <p id={`${id}-err`} className="text-xs text-danger">{error}</p> : hint ? <p id={`${id}-hint`} className="text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

export function TextInput({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputCls, 'h-10', className)} {...p} />;
}
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(inputCls, 'h-10 pr-8', className)} {...p}>{children}</select>;
}
export function TextArea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputCls, 'min-h-28 py-2 font-mono text-[13px] leading-relaxed', className)} {...p} />;
}

export function Toggle({ checked, onChange, label, disabled, danger }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        checked ? (danger ? 'border-danger bg-danger' : 'border-accent bg-accent') : 'border-line-strong bg-surface-3')}>
      <span className={cx('inline-block h-4.5 w-4.5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-[3px]')} />
    </button>
  );
}

/** Small pill tabs (filters, channel pickers). */
export function Pills<T extends string>({ options, value, onChange, label, render }: { options: readonly T[]; value: T; onChange: (v: T) => void; label: string; render?: (v: T) => ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-full border border-line bg-surface p-1">
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={o === value} onClick={() => onChange(o)}
          className={cx(cx('h-8 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition-colors', !render && 'capitalize'), o === value ? 'bg-accent-soft text-accent ring-1 ring-accent/60' : 'text-muted hover:text-ink')}>
          {render ? render(o) : o}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy', size = 'sm' }: { text: string; label?: string; size?: 'sm' | 'md' }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  return (
    <Button type="button" variant="secondary" size={size} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }
      catch { toast('error', 'Clipboard not available. Select the text and copy it manually.'); }
    }}>
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{done ? 'Copied' : label}
    </Button>
  );
}

/** A secret shown exactly once, with copy and a warning. */
export function SecretOnce({ label, secret }: { label: string; secret: string }) {
  return (
    <div className="space-y-3">
      <Callout tone="warn" title="Copy this now — it will not be shown again">
        PreFlop stores only a hash. If you lose it, revoke it and create a new one.
      </Callout>
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-[10px] border border-line-strong bg-bg px-3 py-2.5 font-mono text-[13px] text-accent">{secret}</code>
        <CopyButton text={secret} />
      </div>
    </div>
  );
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="relative rounded-[14px] border border-line bg-bg">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">{lang}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-ink/90"><code>{code}</code></pre>
    </div>
  );
}

export function KeyVal({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(120px,auto)_1fr] gap-x-6 gap-y-2 text-sm">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-mono text-[12.5px]', className)}>{children}</span>;
}
