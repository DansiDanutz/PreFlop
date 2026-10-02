import { BalanceCard, ChipIcon, Wordmark, cx, formatMoney } from '@preflop/ui';
import { Activity, Building2, House, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router';
import { useBalance, useMe, useRealMoney } from '../lib/queries.ts';
import { KEYS, readString } from '../lib/storage.ts';
import { Skeleton } from './ui.tsx';

export function initials(name: string | undefined | null) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'P';
}

/** Top bar on every app screen: serif wordmark, PRACTICE pill in play money, round avatar. */
export function TopBar({ embed = false }: { embed?: boolean }) {
  const me = useMe();
  const real = useRealMoney();
  // Inside an organizer's room the player uses chips or diamonds, not practice chips.
  const [params] = useSearchParams();
  const practice = !real && !params.get('room');
  const avatar = (
    <span className="grid h-10 w-10 place-items-center rounded-full border border-line-strong bg-surface-2 text-sm font-semibold text-ink">
      {me.data ? initials(me.data.display_name) : <User className="h-5 w-5 text-muted" aria-hidden />}
    </span>
  );
  return (
    <header className="flex h-16 items-center gap-3 px-5">
      {embed ? <Wordmark size="sm" /> : <Link to="/app" aria-label="PreFlop lobby"><Wordmark size="md" /></Link>}
      {practice && (
        <span className="rounded-full border border-accent/70 px-2.5 py-[3px] text-[11px] font-semibold tracking-[0.12em] text-accent" title="You are playing with free chips">
          PRACTICE
        </span>
      )}
      <div className="flex-1" />
      {embed ? avatar : <Link to="/app/profile" aria-label="Your profile" className="rounded-full">{avatar}</Link>}
    </header>
  );
}

const TAGLINES: [string, string][] = [['Play. Practice.', 'Get better.'], ['Same hands.', 'More experience.'], ['Good instincts', 'add up.']];

/** The balance card under the top bar (free chips). */
export function FreeChipsCard({ tagline = 0, className }: { tagline?: number; className?: string }) {
  const b = useBalance();
  const [a, b2] = TAGLINES[tagline % TAGLINES.length]!;
  return (
    <BalanceCard className={className ?? ''}
      amount={b.balance === null ? <Skeleton className="h-6 w-24" /> : formatMoney(b.balance, 'PLAY')}
      label="Free chips"
      tagline={<>{a}<br />{b2}</>} />
  );
}

function Tab({ to, label, icon, end }: { to: string; label: string; icon: (active: boolean) => ReactNode; end?: boolean }) {
  return (
    <NavLink to={to} end={end ?? false}
      className={({ isActive }) => cx('flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium', isActive ? 'text-accent' : 'text-muted hover:text-ink')}>
      {({ isActive }) => (
        <>
          <span className="grid h-7 place-items-center">{icon(isActive)}</span>
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

/** Lobby · Clubs · Table · Activity · Profile (docs/15). */
export function TabBar() {
  const loc = useLocation();
  const lastTable = readString(KEYS.lastTable) ?? 'green-room';
  const onTable = loc.pathname.startsWith('/app/table');
  const fill = (a: boolean) => (a ? { fill: 'currentColor', fillOpacity: 0.22 } : {});
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto flex max-w-[480px] px-2">
        <Tab to="/app" end label="Lobby" icon={(a) => <House className="h-6 w-6" strokeWidth={1.7} {...fill(a)} />} />
        <Tab to="/app/clubs" label="Clubs" icon={(a) => <Building2 className="h-6 w-6" strokeWidth={1.7} {...fill(a)} />} />
        <Tab to={onTable ? loc.pathname : `/app/table/${lastTable}`} label="Table"
          icon={(a) => <ChipIcon size={24} className={cx(!a && 'opacity-60 grayscale')} />} />
        <Tab to="/app/activity" label="Activity" icon={() => <Activity className="h-6 w-6" strokeWidth={1.7} />} />
        <Tab to="/app/profile" label="Profile" icon={(a) => <User className="h-6 w-6" strokeWidth={1.7} {...fill(a)} />} />
      </div>
    </nav>
  );
}

export function AppLayout() {
  return (
    <div className="mx-auto min-h-dvh max-w-[480px] pb-24">
      <TopBar />
      <main>
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}
