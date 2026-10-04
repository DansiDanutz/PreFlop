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
  return (
    <span className={cx('inline-flex items-baseline gap-[0.18em] font-serif font-bold tracking-[-0.06em] text-ink', s, className)}>
      PreFlop<span aria-hidden className="text-[0.5em] tracking-normal text-accent">♠</span>
    </span>
  );
}

/** The poker-chip balance icon from the concepts. */
export function ChipIcon({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="15" fill="#53e6a7" />
      <circle cx="16" cy="16" r="10.5" fill="#0f2a1e" />
      <circle cx="16" cy="16" r="8" fill="none" stroke="#53e6a7" strokeWidth="1.6" strokeDasharray="3 2.2" />
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
  return <button className={cx('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] font-semibold transition-colors disabled:cursor-not-allowed', v, s, className)} {...p} />;
}

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-[12px] border border-line-strong/60 bg-surface', className)} {...p} />;
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
          aria-pressed={o === value}
          className={cx('h-10 rounded-[6px] border text-[14px] transition-colors',
            o === value ? 'border-accent/60 bg-accent-deep text-accent' : 'border-line-strong/70 text-ink/90 hover:border-accent/50')}>
          {render ? render(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ cards

const SUIT: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

const CARD_DIMS = { sm: 'h-[64px] w-[44px] text-[12px]', md: 'h-[87px] w-[59px] text-[15px]', lg: 'h-[136px] w-[92px] text-[22px]' } as const;

/** A face-up playing card from a code like "Kh", "Td", "7c": ivory face, Georgia indices. */
export function PlayingCard({ code, size = 'md', className, flip = false }: { code: string; size?: 'sm' | 'md' | 'lg'; className?: string; flip?: boolean }) {
  const rank = code.slice(0, -1).replace('T', '10');
  const suit = code.slice(-1).toLowerCase();
  const red = suit === 'h' || suit === 'd';
  return (
    <div className={cx('relative shrink-0 select-none rounded-[6px] border border-white/85 bg-card font-serif shadow-[0_5px_12px_rgba(0,0,0,0.25)]', CARD_DIMS[size], flip && 'pf-flip', className)}
      style={{ color: red ? 'var(--color-card-red)' : 'var(--color-card-black)' }} aria-label={code}>
      <div className="absolute left-[0.4em] top-[0.3em] flex flex-col items-center font-bold leading-[1.05]">
        <span>{rank}</span>
        <span className="text-[0.78em] leading-none">{SUIT[suit]}</span>
      </div>
      <div className="absolute inset-0 grid place-items-center text-[2.4em] leading-none">{SUIT[suit]}</div>
      <div className="absolute bottom-[0.3em] right-[0.4em] flex rotate-180 flex-col items-center font-bold leading-[1.05]">
        <span>{rank}</span>
        <span className="text-[0.78em] leading-none">{SUIT[suit]}</span>
      </div>
    </div>
  );
}

/** Green patterned card back (a face-down flop). */
export function CardBack({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <div className={cx('shrink-0 rounded-[6px] bg-card p-[3px] shadow-[0_5px_12px_rgba(0,0,0,0.3)]', CARD_DIMS[size], className)}>
      <div className="card-back-pattern h-full w-full rounded-[4px] ring-1 ring-black/30" />
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

// ------------------------------------------------------------------ felt table

export type FeltTheme = 'green' | 'blue' | 'violet';
const THEME_CLASS: Record<FeltTheme, string> = { green: '', blue: 'felt-blue', violet: 'felt-violet' };

/** A stable felt colour per club, so each club's tables share a look. */
export function feltTheme(key: string | null | undefined): FeltTheme {
  if (!key) return 'green';
  if (/midnight|meridian/i.test(key)) return 'blue';
  if (/noir|salon|prive|violet/i.test(key)) return 'violet';
  if (/atlas|green/i.test(key)) return 'green';
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (['green', 'blue', 'violet'] as const)[h % 3]!;
}

/** "Table 04" → "TABLE 04", for the small embossed label on the felt. */
export function feltLabel(name: string | null | undefined): string | null {
  const m = name?.match(/table\s*(\d+)/i);
  return m ? `TABLE ${m[1]!.padStart(2, '0')}` : null;
}

/**
 * The table felt. Every live table today is simulated (docs/06 #7), so this shows the table's
 * real flop data on a CSS felt with a SIMULATED TABLE tag, never a fake video.
 */
export function Felt({
  cards, size = 'md', revealKey, unavailable = false, onExpand, className, badge = true, badgeText = 'SIMULATED TABLE', watermark = true, theme = 'green', label, action,
}: {
  cards: readonly string[] | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  /** Changing this replays the reveal animation (e.g. the round id of a freshly dealt flop). */
  revealKey?: string | null;
  unavailable?: boolean;
  onExpand?: () => void;
  className?: string;
  badge?: boolean;
  /** The corner tag: SIMULATED TABLE, or TEST TABLE on a manual table. */
  badgeText?: string;
  watermark?: boolean;
  theme?: FeltTheme;
  /** Small embossed label, e.g. TABLE 04. */
  label?: string | null;
  /** A control in the top-right corner (e.g. the save-table star). */
  action?: ReactNode;
}) {
  const gap = size === 'lg' ? 'gap-2.5 sm:gap-3' : 'gap-[9px]';
  return (
    <div className={cx('felt felt-noise relative isolate overflow-hidden', unavailable ? 'felt-grey' : THEME_CLASS[theme], className)}>
      <span aria-hidden className="felt-ring" />
      {watermark && (
        <span aria-hidden className={cx('absolute inset-x-0 text-center font-serif italic tracking-[-0.05em] text-[#e0e6cb]/25',
          size === 'lg' ? 'bottom-6 text-[28px]' : 'bottom-4 text-[17px]')}>
          PreFlop
        </span>
      )}
      {label && <span aria-hidden className="absolute bottom-3 right-4 text-[8px] tracking-[0.18em] text-white/30">{label}</span>}
      <div key={revealKey ?? 'static'} className={cx('absolute inset-0 z-[2] flex items-center justify-center pb-3', gap, revealKey && 'pf-reveal', unavailable && 'opacity-35 grayscale')}>
        {[0, 1, 2].map((i) => {
          const c = cards?.[i];
          return c ? <PlayingCard key={i} code={c} size={size} /> : <CardBack key={i} size={size} />;
        })}
      </div>
      {unavailable && (
        <span className="absolute left-1/2 top-1/2 z-[5] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[8px] bg-black/75 px-3.5 py-2 text-[13px] text-ink">
          Table unavailable
        </span>
      )}
      {(badge || action || onExpand) && (
        <div className="absolute inset-x-3 top-3 z-[5] flex items-start justify-between">
          {badge ? (
            <span className={cx('inline-flex items-center gap-1.5 rounded-[4px] border border-[#6c8a6f]/25 bg-[#101a15]/75 px-2 py-[5px] text-[8.5px] font-medium tracking-[0.09em] text-[#c4d3c8]', unavailable && 'opacity-50')}>
              <span className="h-1 w-1 rounded-full bg-[#bccdbb]" /> {badgeText}
            </span>
          ) : <span />}
          {action}
          {onExpand && (
            <button type="button" onClick={onExpand} aria-label="Expand table view" className="grid h-9 w-9 place-items-center rounded-[8px] text-white/85 hover:bg-black/30">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
            </button>
          )}
        </div>
      )}
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
          <span className={cx('h-[18px] w-[18px] rounded-full border-2', i < at ? 'border-accent bg-accent' : i === at ? 'border-accent bg-accent shadow-[0_0_0_4px_rgba(83,230,167,0.2)]' : 'border-line-strong bg-surface')} />
          <span className={cx('text-xs', i === at ? 'text-accent' : 'text-muted')}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ money

/** Minor-unit digits per currency: PLAY/CHIP/DIAMOND are whole units, EUR has cents, USDT/USDC 6 dp. */
export const CURRENCY_DIGITS: Record<string, number> = { EUR: 2, USDT: 6, USDC: 6, PLAY: 0, CHIP: 0, DIAMOND: 0 };

/** The number alone, scaled by the currency's minor digits: 150 EUR → "1.50", 1500 PLAY → "1,500". USDT/USDC show 2 dp. */
export function formatAmount(minor: number, currency: string): string {
  const d = CURRENCY_DIGITS[currency] ?? 2;
  const shown = currency === 'USDT' || currency === 'USDC' ? 2 : d;
  const n = (Math.abs(minor) / 10 ** d).toLocaleString('en-US', { minimumFractionDigits: shown, maximumFractionDigits: shown });
  return minor < 0 ? `-${n}` : n;
}

/**
 * Formats integer minor units with their unit, so an amount is never ambiguous:
 * "1,000 free chips" (PLAY), "1,500 chips" (CHIP), "100 ◆" (DIAMOND), "€1.50" (EUR), "1.00 USDT".
 */
export function formatMoney(minor: number, currency: string): string {
  const n = formatAmount(Math.abs(minor), currency);
  const sign = minor < 0 ? '-' : '';
  switch (currency) {
    case 'EUR': return `${sign}€${n}`;
    case 'PLAY': return `${sign}${n} free chips`;
    case 'CHIP': return `${sign}${n} chips`;
    case 'DIAMOND': return `${sign}${n} ◆`;
    default: return `${sign}${n} ${currency}`;
  }
}

/** Compact form for tight spots (stake pills, a balance beside a chip icon): no word unit for PLAY/CHIP. */
export function formatMoneyShort(minor: number, currency: string): string {
  return currency === 'PLAY' || currency === 'CHIP' ? formatAmount(minor, currency) : formatMoney(minor, currency);
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
    <div className="rounded-[12px] border border-dashed border-line-strong p-8 text-center">
      <div className="font-serif text-xl">{title}</div>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-accent', className)} />;
}
