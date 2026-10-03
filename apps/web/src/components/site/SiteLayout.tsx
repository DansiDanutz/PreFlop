import { Wordmark, cx } from '@preflop/ui';
import { Menu, X } from 'lucide-react';
import { type ReactNode, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useToken } from '../../lib/auth.tsx';

const LINKS = [
  { to: '/odds', label: 'Odds' },
  { to: '/clubs', label: 'For clubs' },
  { to: '/partners', label: 'Partners' },
  { to: '/organizers', label: 'Organizers' },
  { to: '/responsible-gaming', label: 'Responsible play' },
];

const btn = 'inline-flex h-10 items-center justify-center rounded-[12px] px-4 text-sm font-semibold transition-colors';

function SiteNav() {
  const token = useToken();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
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
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-5">
        <Link to="/" aria-label="PreFlop home"><Wordmark /></Link>
        <nav aria-label="Site" className="hidden flex-1 items-center gap-5 lg:flex">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => cx('text-sm hover:text-ink', isActive ? 'text-accent' : 'text-muted')}>{l.label}</NavLink>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 sm:flex">{ctas}</div>
        <button type="button" className="ml-auto grid h-10 w-10 place-items-center rounded-full border border-line sm:ml-0 lg:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <nav id="site-menu" aria-label="Site menu" className="border-t border-line px-5 py-4 lg:hidden">
          <ul className="space-y-1">
            {LINKS.map((l) => <li key={l.to}><Link to={l.to} className="block rounded-[10px] px-2 py-2.5 text-[15px] hover:bg-surface">{l.label}</Link></li>)}
          </ul>
          <div className="mt-3 flex gap-2 sm:hidden">{ctas}</div>
        </nav>
      )}
    </header>
  );
}

function FooterCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">{title}</div>
      <ul className="space-y-2 text-sm">{children}</ul>
    </div>
  );
}

function SiteFooter() {
  const l = (to: string, label: string) => <li><Link to={to} className="text-ink/80 hover:text-accent">{label}</Link></li>;
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Wordmark />
          <p className="mt-3 max-w-[260px] text-sm text-muted">Predict the three-card flop at live poker tables, with exact odds.</p>
        </div>
        <FooterCol title="Play">{l('/register', 'Play free')}{l('/demo', 'Watch a live table')}{l('/login', 'Sign in')}{l('/odds', 'Odds book')}</FooterCol>
        <FooterCol title="Business">{l('/clubs', 'For poker clubs')}{l('/partners', 'For betting companies')}{l('/organizers', 'For organizers')}</FooterCol>
        <FooterCol title="Legal">{l('/terms', 'Terms of use')}{l('/privacy', 'Privacy notice')}{l('/responsible-gaming', 'Responsible gaming')}</FooterCol>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-5 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>18+ only. <strong className="text-ink">Free chips have no cash value</strong> and can never be cashed out.</span>
          <span>© {new Date().getFullYear()} PreFlop. All live tables shown are simulated.</span>
        </div>
      </div>
    </footer>
  );
}

export function SiteLayout() {
  return (
    <div className="min-h-dvh">
      <SiteNav />
      <main><Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}><Outlet /></Suspense></main>
      <SiteFooter />
    </div>
  );
}

/** Section wrapper for website pages. */
export function SiteSection({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={cx('mx-auto max-w-[1200px] px-5', className)}>{children}</section>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent">{children}</div>;
}
