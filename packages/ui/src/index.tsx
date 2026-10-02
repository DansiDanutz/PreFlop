import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

/**
 * Shared PreFlop components. Styling uses Tailwind utilities generated from tokens.css, so
 * every app must `@import "tailwindcss"; @import "@preflop/ui/tokens.css";` and add
 * `@source "../../packages/ui/src";` (path relative to its CSS) so these classes are compiled.
 */

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ------------------------------------------------------------------ brand

export function Wordmark({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'lg' ? 'text-4xl' : size === 'sm' ? 'text-xl' : 'text-[28px]';
  return <span className={cx('font-serif tracking-tight text-ink', s, className)}>PreFlop</span>;
}

/** The poker-chip balance icon from the concepts. */
export function ChipIcon({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="15" fill="#1fd38b" />
      <circle cx="16" cy="16" r="10.5" fill="#0b2a1d" />
      <circle cx="16" cy="16" r="8" fill="none" stroke="#1fd38b" strokeWidth="1.6" strokeDasharray="3 2.2" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <rect key={a} x="14.6" y="1.5" width="2.8" height="4.6" rx="0.8" fill="#e9fff5" transform={`rotate(${a} 16 16)`} />
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------ primitives

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'primary', size = 'md', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  const v = {
    primary: 'bg-accent text-accent-ink hover:bg-accent-strong disabled:bg-surface-3 disabled:text-faint',
    secondary: 'bg-transparent text-ink border border-line-strong hover:border-accent hover:text-accent disabled:text-faint',
    ghost: 'bg-transparent text-muted hover:text-ink',
    danger: 'bg-danger text-white hover:brightness-110',
  }[variant];
  const s = { sm: 'h-9 px-3 text-sm', md: 'h-11 px-5 text-[15px]', lg: 'h-14 px-6 text-lg' }[size];
  return <button className={cx('inline-flex items-center justify-center gap-2 rounded-[12px] font-semibold transition-colors disabled:cursor-not-allowed', v, s, className)} {...p} />;
}

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-[18px] border border-line bg-surface', className)} {...p} />;
}

export function Badge({ children, tone = 'accent', className }: { children: ReactNode; tone?: 'accent' | 'muted' | 'live' | 'info' | 'warn' | 'danger'; className?: string }) {
  const t = {
    accent: 'border-accent/60 text-accent',
    muted: 'border-line-strong text-muted',
    live: 'border-transparent bg-black/60 text-white',
    info: 'border-info/60 text-info',
    warn: 'border-warn/60 text-warn',
    danger: 'border-danger/60 text-danger',
  }[tone];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider', t, className)}>
      {tone === 'live' && <span className="h-2 w-2 rounded-full bg-live pf-pulse" />}
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'accent', label }: { tone?: 'accent' | 'info' | 'muted' | 'danger' | 'warn'; label: ReactNode }) {
  const c = { accent: 'bg-accent text-accent', info: 'bg-info text-info', muted: 'bg-faint text-muted', danger: 'bg-danger text-danger', warn: 'bg-warn text-warn' }[tone];
  return (
    <span className={cx('inline-flex items-center gap-2 text-sm', c.split(' ')[1])}>
      <span className={cx('h-2 w-2 rounded-full', c.split(' ')[0])} />
      {label}
    </span>
  );
}

/** Pill selector, e.g. stake chips 50 / 100 / 250 or the lobby filters. */
export function Segmented<T extends string | number>({ options, value, onChange, className, render }: {
  options: readonly T[]; value: T; onChange: (v: T) => void; className?: string; render?: (v: T) => ReactNode;
}) {
  return (
    <div className={cx('grid gap-2', className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={String(o)} type="button" onClick={() => onChange(o)}
          className={cx('h-10 rounded-full border text-[15px] font-semibold transition-colors',
            o === value ? 'border-accent bg-accent-soft text-ink shadow-[var(--shadow-glow)]' : 'border-line-strong text-ink/90 hover:border-accent/60')}>
          {render ? render(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ cards

const SUIT: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

/** A face-up playing card from a code like "Kh", "Td", "7c". */
export function PlayingCard({ code, size = 'md', className, flip = false }: { code: string; size?: 'sm' | 'md' | 'lg'; className?: string; flip?: boolean }) {
  const rank = code.slice(0, -1).replace('T', '10');
  const suit = code.slice(-1).toLowerCase();
  const red = suit === 'h' || suit === 'd';
  const dims = { sm: 'h-16 w-11 text-sm', md: 'h-28 w-20 text-xl', lg: 'h-40 w-28 text-3xl' }[size];
  return (
    <div className={cx('relative select-none rounded-[10px] bg-card shadow-[0_6px_18px_rgba(0,0,0,0.45)] ring-1 ring-black/20', dims, flip && 'pf-flip', className)}
      style={{ color: red ? 'var(--color-card-red)' : 'var(--color-card-black)' }} aria-label={code}>
      <div className="absolute left-1.5 top-1 flex flex-col items-center font-serif leading-none">
        <span>{rank}</span>
        <span className="text-[0.8em]">{SUIT[suit]}</span>
      </div>
      <div className="absolute inset-0 grid place-items-center text-[2.2em] leading-none">{SUIT[suit]}</div>
      <div className="absolute bottom-1 right-1.5 flex rotate-180 flex-col items-center font-serif leading-none">
        <span>{rank}</span>
        <span className="text-[0.8em]">{SUIT[suit]}</span>
      </div>
    </div>
  );
}

/** Green patterned card back (the concepts' face-down flop). */
export function CardBack({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dims = { sm: 'h-16 w-11', md: 'h-28 w-20', lg: 'h-40 w-28' }[size];
  return (
    <div className={cx('rounded-[10px] bg-card p-1 shadow-[0_6px_18px_rgba(0,0,0,0.45)]', dims, className)}>
      <div className="card-back-pattern h-full w-full rounded-[7px] ring-1 ring-black/30" />
    </div>
  );
}

/** Three cards: face-down until `cards` is known. */
export function Flop({ cards, size = 'md', className }: { cards?: readonly string[] | null; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <div className={cx('flex items-center justify-center gap-3', className)}>
      {[0, 1, 2].map((i) => (cards && cards[i] ? <PlayingCard key={`${cards[i]}-${i}`} code={cards[i]!} size={size} flip /> : <CardBack key={i} size={size} />))}
    </div>
  );
}

// ------------------------------------------------------------------ round progress

export type RoundPhase = 'open' | 'locked' | 'reveal';

/** Open → Locked → Reveal stepper from the "Clubs & tables" concept. */
export function RoundStepper({ phase, className }: { phase: RoundPhase; className?: string }) {
  const steps: { key: RoundPhase; label: string }[] = [{ key: 'open', label: 'Open' }, { key: 'locked', label: 'Locked' }, { key: 'reveal', label: 'Reveal' }];
  const at = steps.findIndex((s) => s.key === phase);
  return (
    <div className={cx('relative flex items-start justify-between px-4', className)}>
      <div className="absolute left-10 right-10 top-[9px] h-[2px] bg-line-strong" />
      <div className="absolute left-10 top-[9px] h-[2px] bg-accent transition-all" style={{ width: `calc(${(at / 2) * 100}% - ${at === 2 ? 80 : at === 1 ? 40 : 0}px)` }} />
      {steps.map((s, i) => (
        <div key={s.key} className="relative z-10 flex w-16 flex-col items-center gap-1.5">
          <span className={cx('h-[18px] w-[18px] rounded-full border-2', i < at ? 'border-accent bg-accent' : i === at ? 'border-accent bg-accent shadow-[0_0_0_4px_rgba(31,211,139,0.2)]' : 'border-line-strong bg-surface')} />
          <span className={cx('text-xs', i === at ? 'text-accent' : 'text-muted')}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ money

/** Formats integer minor units for a currency (PLAY/CHIP/DIAMOND are whole units; EUR 2 dp; USDT/USDC 6 dp shown as 2). */
export function formatMoney(minor: number, currency: string): string {
  const digits: Record<string, number> = { EUR: 2, USDT: 6, USDC: 6, PLAY: 0, CHIP: 0, DIAMOND: 0 };
  const d = digits[currency] ?? 2;
  const v = minor / 10 ** d;
  const shown = currency === 'USDT' || currency === 'USDC' ? 2 : d;
  const n = v.toLocaleString('en-US', { minimumFractionDigits: shown, maximumFractionDigits: shown });
  return currency === 'EUR' ? `€${n}` : currency === 'PLAY' ? n : currency === 'DIAMOND' ? `${n} ◆` : `${n} ${currency}`;
}

export const currencyLabel = (c: string) => ({ PLAY: 'Free chips', CHIP: 'Chips', DIAMOND: 'Diamonds', EUR: 'Euro', USDT: 'USDT', USDC: 'USDC' })[c] ?? c;

/** Decimal odds from hundredths: 238 → "2.38×". */
export const formatOdds = (centi: number) => `${(centi / 100).toFixed(2)}×`;

/** Balance card from the concepts: chip icon, amount, label, tagline. */
export function BalanceCard({ amount, label, tagline, className, children }: { amount: ReactNode; label: ReactNode; tagline?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <Card className={cx('flex items-center gap-4 px-5 py-4', className)}>
      <ChipIcon size={34} />
      <div className="min-w-0 flex-1">
        <div className="text-[22px] font-semibold leading-tight">{amount}</div>
        <div className="text-sm text-muted">{label}</div>
      </div>
      {tagline && <div className="max-w-[45%] text-right text-[13px] leading-snug text-muted">{tagline}</div>}
      {children}
    </Card>
  );
}

export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-[18px] border border-dashed border-line-strong p-8 text-center">
      <div className="font-serif text-xl">{title}</div>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-accent', className)} />;
}
