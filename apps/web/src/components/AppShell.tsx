import { ChipIcon, Wordmark, cx, formatMoney } from '@preflop/ui';
import { Building2, CircleHelp, FileText, Gift, House, Info, Swords, Trophy, User } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router';
import { useBalance, useMe, useRealMoney } from '../lib/queries.ts';
import { Sheet, Skeleton } from './ui.tsx';

export function initials(name: string | undefined | null) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'P';
}

const NAV = [
  { to: '/app', label: 'Lobby', short: 'Lobby', end: true, icon: House },
  { to: '/app/clubs', label: 'Clubs', short: 'Clubs', end: false, icon: Building2 },
  { to: '/app/tournaments', label: 'Tournaments', short: 'Tourneys', end: false, icon: Swords },
  { to: '/app/leaderboards', label: 'Leaderboards', short: 'Ranks', end: false, icon: Trophy },
  { to: '/app/promotions', label: 'Promotions', short: 'Promos', end: false, icon: Gift },
  { to: '/app/activity', label: 'Activity', short: 'Activity', end: false, icon: FileText },
  { to: '/app/profile', label: 'Profile', short: 'Profile', end: false, icon: User },
] as const;

/** The section name shown at the top of each screen on wide layouts. */
export function sectionOf(path: string): string {
  if (path.startsWith('/app/table')) return 'The table';
  if (path.startsWith('/app/clubs/')) return 'The club';
  if (path.startsWith('/app/clubs')) return 'Clubs';
  if (path.startsWith('/app/activity')) return 'Activity';
  if (path.startsWith('/app/tournaments')) return 'Tournaments';
  if (path.startsWith('/app/leaderboards')) return 'Leaderboards';
  if (path.startsWith('/app/promotions')) return 'Promotions';
  if (path.startsWith('/app/profile')) return 'Profile';
  return 'Lobby';
}

export function PracticePill({ className }: { className?: string }) {
  return (
    <span title="You are playing with free chips"
      className={cx(className ?? 'inline-flex', 'items-center rounded-[6px] border border-accent/45 bg-accent-deep px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-accent')}>
      PRACTICE
    </span>
  );
}

function Avatar() {
  const me = useMe();
  return (
    <span className="grid h-10 w-10 place-items-center rounded-full border border-line-strong bg-surface-3 font-serif text-[17px] text-ink">
      {me.data ? initials(me.data.display_name) : <User className="h-5 w-5 text-muted" aria-hidden />}
    </span>
  );
}

/** Chip icon and free-chip balance, as in the top-right of every practice screen. */
export function ChipBalance({ className }: { className?: string }) {
  const b = useBalance();
  return (
    <span className={cx('flex items-center gap-2.5', className)}>
      <span className="grid h-10 w-10 place-items-center rounded-full border border-accent/40 bg-accent-deep"><ChipIcon size={26} /></span>
      <span className="leading-tight">
        <span className="block text-[16px] font-bold">{b.balance === null ? <Skeleton className="h-4 w-14" /> : formatMoney(b.balance, 'PLAY')}</span>
        <span className="block text-[12px] text-muted">free chips</span>
      </span>
    </span>
  );
}

/** Top bar. Wide screens: section name and PRACTICE; phones: the wordmark. Balance and avatar on the right. */
export function TopBar({ embed = false }: { embed?: boolean }) {
  const real = useRealMoney();
  const loc = useLocation();
  // Inside an organizer's room the player uses chips or diamonds, not practice chips.
  const [params] = useSearchParams();
  const practice = !real && !params.get('room');
  return (
    <header className="sticky top-0 z-30 flex h-[72px] items-center gap-4 border-b border-line bg-bg/92 px-5 backdrop-blur lg:h-[92px] lg:px-10">
      {embed ? <Wordmark size="sm" /> : (
        <Link to="/app" aria-label="PreFlop lobby" className="lg:hidden"><Wordmark size="md" /></Link>
      )}
      {!embed && <span className="hidden text-[13px] font-medium uppercase tracking-[0.14em] text-muted lg:inline">{sectionOf(loc.pathname)}</span>}
      {practice && <PracticePill className={embed ? 'inline-flex' : 'hidden lg:inline-flex'} />}
      <div className="flex-1" />
      {practice && <ChipBalance />}
      {embed ? <Avatar /> : <Link to="/app/profile" aria-label="Your profile" className="hidden rounded-full lg:block"><Avatar /></Link>}
    </header>
  );
}

/** Left navigation rail on wide screens. */
function Rail({ onHelp }: { onHelp: () => void }) {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line px-4 pb-6 pt-8 lg:flex">
      <Link to="/app" aria-label="PreFlop lobby" className="px-2"><Wordmark size="lg" /></Link>
      <p className="mt-2 whitespace-nowrap px-2 text-[9px] font-medium uppercase tracking-[0.1em] text-muted">The flop is just the beginning</p>
      <nav aria-label="Main" className="mt-10 flex flex-col gap-2.5">
        {NAV.map(({ to, label, end, icon: Icon }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => cx('flex h-12 items-center gap-3.5 rounded-[8px] px-4 text-[15px] transition-colors',
              isActive ? 'border border-accent/25 bg-accent-deep text-accent' : 'text-ink/85 hover:bg-surface-2 hover:text-ink')}>
            <Icon className="h-5 w-5" strokeWidth={1.6} aria-hidden /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="flex-1" />
      <div className="border-t border-line pt-6">
        <p className="flex gap-3 px-2 text-[13px] leading-relaxed text-ink/85">
          <Info className="mt-0.5 h-[18px] w-[18px] shrink-0 text-accent" aria-hidden />
          <span>All instinct.<br />Zero real money.</span>
        </p>
        <button type="button" onClick={onHelp} className="mt-5 px-2 text-[13px] text-accent hover:underline">How to play</button>
        <p className="mt-5 px-2 text-[11px] text-muted">Free chips · No cash value</p>
      </div>
    </aside>
  );
}

/** Bottom tab bar on phones. */
export function TabBar() {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-[560px] px-2">
        {NAV.map(({ to, label, short, end, icon: Icon }) => (
          <NavLink key={to} to={to} end={end} aria-label={label}
            className={({ isActive }) => cx('flex min-w-0 flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium', isActive ? 'text-accent' : 'text-muted hover:text-ink')}>
            <Icon className="h-[22px] w-[22px]" strokeWidth={1.6} aria-hidden />
            <span className="truncate">{short}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/** Page heading: accent eyebrow, large serif title, short subtitle and an optional action. */
export function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">{eyebrow}</p>}
        <h1 className="mt-3 font-serif text-[34px] leading-[1.15] tracking-[-0.045em] lg:text-[44px]">{title}</h1>
        {subtitle && <p className="mt-2 text-[15px] text-ink/80">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function HowToPlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const steps: [string, string][] = [
    ['Choose', 'Pick one of your six favorite bets, or any of the offered selections in the catalogue, and an amount of free chips.'],
    ['Lock', 'Predictions close when the dealer locks the round, before the shuffle. Nothing can be added after that.'],
    ['Reveal', 'The flop is dealt. Correct predictions pay the decimal odds, which include your original chips.'],
  ];
  return (
    <Sheet open={open} onClose={onClose} title="How to play">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">How to play</p>
      <h2 className="mt-2 font-serif text-[28px] leading-tight tracking-[-0.03em]">Three cards. One prediction.</h2>
      <ol className="mt-5 space-y-4">
        {steps.map(([t, d], i) => (
          <li key={t} className="flex gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-accent/50 bg-accent-deep text-[13px] font-semibold text-accent">{i + 1}</span>
            <span><span className="block font-semibold">{t}</span><span className="block text-sm text-muted">{d}</span></span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-xs text-muted">Free chips have no cash value. Every round is started by you: no auto-replay and no countdown pressure.</p>
      <button type="button" onClick={onClose} className="mt-5 h-11 w-full rounded-[8px] bg-accent font-semibold text-accent-ink hover:bg-accent-strong">Got it</button>
    </Sheet>
  );
}

export function AppFooter() {
  return (
    <footer className="mt-12 flex flex-col gap-1.5 border-t border-line pt-6 text-[12px] text-muted sm:flex-row sm:justify-between">
      <span>Simulated tables while physical-table play is switched off.</span>
      <span>Free chips. No purchases, prizes or cash-out.</span>
    </footer>
  );
}

export function AppLayout() {
  const [help, setHelp] = useState(false);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[222px_minmax(0,1fr)]">
      <Rail onHelp={() => setHelp(true)} />
      <div className="min-w-0">
        <TopBar />
        <main id="main" className="mx-auto max-w-[1240px] px-5 pb-28 pt-8 lg:px-10 lg:pb-10 lg:pt-10">
          <Outlet context={{ openHelp: () => setHelp(true) }} />
          <AppFooter />
        </main>
      </div>
      <TabBar />
      <HowToPlay open={help} onClose={() => setHelp(false)} />
    </div>
  );
}

/** Lets a page open the How to play sheet owned by the layout. */
export type ShellContext = { openHelp: () => void };

export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex h-11 shrink-0 items-center gap-2 rounded-[8px] border border-line-strong px-3 text-[15px] font-semibold hover:border-accent/60 sm:px-5">
      <CircleHelp className="h-5 w-5" aria-hidden /> <span className="hidden sm:inline">How to play</span>
    </button>
  );
}
