import { Wordmark, cx } from '@preflop/ui';
import { ChevronDown, Menu, X } from 'lucide-react';
import { type ReactNode, Suspense, useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useToken } from '../../lib/auth.tsx';
import { contactEmail } from '../../lib/site.ts';

export interface SiteLink { to: string; label: string; hint?: string }
export interface SiteGroup { label: string; links: SiteLink[] }

/** Header navigation: two direct links, two grouped menus, and News. */
export const NAV: (SiteLink | SiteGroup)[] = [
  { to: '/players', label: 'Players' },
  { to: '/odds', label: 'Markets & odds' },
  {
    label: 'Business',
    links: [
      { to: '/clubs', label: 'Poker clubs', hint: 'Certified tables, Table Box and revenue share' },
      { to: '/partners', label: 'Betting partners', hint: 'Partner API, widget and webhooks' },
      { to: '/organizers', label: 'Organizers', hint: 'Rooms with chips or diamonds' },
      { to: '/agents', label: 'Agents', hint: 'Two-level referral programme' },
    ],
  },
  {
    label: 'Trust',
    links: [
      { to: '/fairness', label: 'Fairness & security', hint: 'Exact odds and the evidence chain' },
      { to: '/responsible-gaming', label: 'Responsible play', hint: 'Limits, reality checks, self-exclusion' },
    ],
  },
  { to: '/news', label: 'News' },
];

const isGroup = (x: SiteLink | SiteGroup): x is SiteGroup => 'links' in x;
const btn = 'inline-flex h-10 items-center justify-center rounded-[12px] px-4 text-sm font-semibold transition-colors';

function NavMenu({ group }: { group: SiteGroup }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const active = group.links.some((l) => loc.pathname === l.to);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative" onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className={cx('inline-flex h-10 items-center gap-1 rounded-[10px] px-2 text-sm hover:text-ink', active || open ? 'text-ink' : 'text-muted', active && 'underline decoration-accent decoration-2 underline-offset-[10px]')}>
        {group.label}<ChevronDown className={cx('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id={id} className="absolute left-1/2 top-full z-50 mt-2 w-[320px] -translate-x-1/2 rounded-[14px] border border-line-strong bg-surface p-2 shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
          <ul>
            {group.links.map((l) => (
              <li key={l.to}>
                <Link to={l.to} aria-current={loc.pathname === l.to ? 'page' : undefined}
                  className="block rounded-[10px] px-3 py-2.5 hover:bg-surface-3 aria-[current=page]:bg-accent-soft">
                  <span className="block text-sm font-semibold text-ink">{l.label}</span>
                  {l.hint && <span className="mt-0.5 block text-[13px] text-muted">{l.hint}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SiteNav() {
  const token = useToken();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const ctas = token ? (
    <Link to="/app" className={cx(btn, 'bg-accent text-accent-ink hover:bg-accent-strong')}>Open the app</Link>
  ) : (
    <>
      <Link to="/login" className={cx(btn, 'text-ink hover:text-accent')}>Sign in</Link>
      <Link to="/register" className={cx(btn, 'bg-accent text-accent-ink hover:bg-accent-strong')}>Play free</Link>
    </>
  );
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/90 backdrop-blur">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-[10px] focus:bg-accent focus:px-4 focus:py-2 focus:font-semibold focus:text-accent-ink">Skip to content</a>
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-4 sm:px-5">
        <Link to="/" aria-label="PreFlop home"><Wordmark /></Link>
        <nav aria-label="Site" className="hidden flex-1 items-center gap-3 lg:flex">
          {NAV.map((x) => isGroup(x) ? <NavMenu key={x.label} group={x} /> : (
            <NavLink key={x.to} to={x.to}
              className={({ isActive }) => cx('inline-flex h-10 items-center rounded-[10px] px-2 text-sm hover:text-ink', isActive ? 'text-ink underline decoration-accent decoration-2 underline-offset-[10px]' : 'text-muted')}>
              {x.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 sm:flex">{ctas}</div>
        <button type="button" className="ml-auto grid h-11 w-11 place-items-center rounded-full border border-line sm:ml-0 lg:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)}>
          {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>
      </div>
      {open && (
        <nav id="site-menu" aria-label="Site menu" className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-line px-4 pb-6 pt-3 lg:hidden">
          <ul className="space-y-1">
            {NAV.map((x) => isGroup(x) ? (
              <li key={x.label} className="pt-3">
                <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted">{x.label}</div>
                <ul>
                  {x.links.map((l) => (
                    <li key={l.to}><Link to={l.to} aria-current={loc.pathname === l.to ? 'page' : undefined} className="block rounded-[10px] px-2 py-2.5 text-[15px] hover:bg-surface aria-[current=page]:text-accent">{l.label}</Link></li>
                  ))}
                </ul>
              </li>
            ) : (
              <li key={x.to}><Link to={x.to} aria-current={loc.pathname === x.to ? 'page' : undefined} className="block rounded-[10px] px-2 py-2.5 text-[15px] font-semibold hover:bg-surface aria-[current=page]:text-accent">{x.label}</Link></li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2 sm:hidden">{ctas}</div>
        </nav>
      )}
    </header>
  );
}

function FooterCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">{title}</h2>
      <ul className="space-y-2 text-sm">{children}</ul>
    </div>
  );
}

function SiteFooter() {
  const l = (to: string, label: string) => <li><Link to={to} className="text-ink/80 hover:text-accent">{label}</Link></li>;
  const email = contactEmail();
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-10 px-4 py-12 sm:px-5 lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr]">
        <div className="col-span-2 lg:col-span-1">
          <Wordmark />
          <p className="mt-3 max-w-[280px] text-sm text-muted">Predict the three-card flop at poker tables, with exact odds over all 22,100 possible flops. Free to play.</p>
        </div>
        <FooterCol title="Play">{l('/players', 'For players')}{l('/odds', 'Markets & odds')}{l('/news', 'News')}{l('/register', 'Play free')}{l('/demo', 'Watch a live table')}{l('/login', 'Sign in')}</FooterCol>
        <FooterCol title="Business">{l('/clubs', 'Poker clubs')}{l('/partners', 'Betting partners')}{l('/organizers', 'Organizers')}{l('/agents', 'Agents')}</FooterCol>
        <FooterCol title="Trust">{l('/fairness', 'Fairness & security')}{l('/responsible-gaming', 'Responsible play')}</FooterCol>
        <FooterCol title="Legal">
          {l('/terms', 'Terms of use')}{l('/privacy', 'Privacy notice')}
          {email && <li><a href={`mailto:${email}`} className="text-ink/80 hover:text-accent">Contact us</a></li>}
        </FooterCol>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 py-6 text-xs leading-relaxed text-muted sm:px-5 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
          <p className="max-w-[760px]">
            <strong className="text-ink">18+ only.</strong> PreFlop is free to play: <strong className="text-ink">free chips have no cash value</strong> and can never be cashed out.
            Organizer chips and diamonds are never cashed out on PreFlop either. Real-money play is switched off; it would only ever be offered where licensed, through licensed operators.
            Play for fun, set limits in your profile and take breaks. <Link to="/responsible-gaming" className="text-accent underline underline-offset-2">Responsible play</Link>.
          </p>
          <p className="shrink-0">© {new Date().getFullYear()} PreFlop. All live tables shown are simulated.</p>
        </div>
      </div>
    </footer>
  );
}

export function SiteLayout() {
  return (
    <div className="min-h-dvh">
      <SiteNav />
      <main id="main" tabIndex={-1} className="outline-none"><Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}><Outlet /></Suspense></main>
      <SiteFooter />
    </div>
  );
}

/** Section wrapper for website pages. */
export function SiteSection({ children, className, id, labelledBy }: { children: ReactNode; className?: string | undefined; id?: string | undefined; labelledBy?: string | undefined }) {
  return <section id={id} aria-labelledby={labelledBy} className={cx('mx-auto max-w-[1200px] px-4 sm:px-5', className)}>{children}</section>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent">{children}</div>;
}
