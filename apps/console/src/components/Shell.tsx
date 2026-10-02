import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { ChevronDown, ChevronsUpDown, LogOut, Menu, X, FlaskConical } from 'lucide-react';
import { Wordmark, cx } from '@preflop/ui';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth.tsx';
import { api, session } from '../lib/api.ts';
import { canWrite, KIND_LABEL, portalForPath, type Portal } from '../lib/portals.ts';
import { NAV, PORTAL_ICON } from './nav.ts';

const PortalCtx = createContext<Portal | null>(null);

/** The portal the current page belongs to (set by the Shell). */
export function usePortal(): Portal {
  const p = useContext(PortalCtx);
  if (!p) throw new Error('usePortal outside a portal');
  return p;
}
export const useOrgId = () => usePortal().orgId ?? '';
export const useCanWrite = () => canWrite(useContext(PortalCtx));

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open, close]);
  return ref;
}

export function PortalMenu({ current }: { current: Portal }) {
  const { portals } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const Icon = PORTAL_ICON[current.kind];
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-[10px] border border-line-strong/70 bg-surface px-3 py-2.5 text-left hover:border-line-strong">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-accent/40 bg-accent-deep text-accent"><Icon size={17} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{current.name}</span>
          <span className="block truncate text-xs text-muted">{KIND_LABEL[current.kind]} · {current.role}</span>
        </span>
        <ChevronsUpDown size={15} className="text-faint" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-[10px] border border-line-strong bg-surface-2 py-1 shadow-2xl">
          {portals.map((p) => {
            const PI = PORTAL_ICON[p.kind];
            return (
              <Link key={p.key} role="menuitem" to={p.enabled ? p.key : '#'} aria-disabled={!p.enabled} onClick={() => setOpen(false)}
                className={cx('flex items-center gap-3 px-3 py-2 text-sm hover:bg-surface-3', p.key === current.key && 'text-accent', !p.enabled && 'pointer-events-none opacity-50')}>
                <PI size={15} aria-hidden /><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="text-[11px] text-faint">{KIND_LABEL[p.kind]}</span>
              </Link>
            );
          })}
          <div className="my-1 border-t border-line" />
          <Link role="menuitem" to="/portals" onClick={() => setOpen(false)} className="block px-3 py-2 text-sm text-muted hover:bg-surface-3 hover:text-ink">All portals…</Link>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const initials = (me?.display_name || me?.email || '?').split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-2 rounded-full border border-line-strong/70 py-1 pl-1 pr-2.5 hover:border-line-strong">
        <span className="grid h-8 w-8 place-items-center rounded-full border border-line-strong bg-surface-3 font-serif text-[13px]">{initials}</span>
        <span className="hidden max-w-[180px] truncate text-sm sm:inline">{me?.display_name}</span>
        <ChevronDown size={14} className="text-faint" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-[10px] border border-line-strong bg-surface-2 shadow-2xl">
          <div className="border-b border-line px-4 py-3">
            <div className="truncate text-sm font-semibold">{me?.display_name}</div>
            <div className="truncate text-xs text-muted">{me?.email}</div>
            {me?.platform_role && <div className="mt-1 text-[11px] uppercase tracking-wider text-accent">PreFlop {me.platform_role}</div>}
          </div>
          <Link role="menuitem" to="/portals" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-sm hover:bg-surface-3">Switch portal</Link>
          <Link role="menuitem" to="/design" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-sm hover:bg-surface-3">Design system</Link>
          <button role="menuitem" type="button" onClick={async () => { await logout(); nav('/login'); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-danger hover:bg-surface-3">
            <LogOut size={14} aria-hidden />Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function EnvBadge() {
  const modes = useQuery({ queryKey: ['modes'], queryFn: api.modes, staleTime: 60_000, retry: false });
  const realOn = modes.data ? modes.data.modes['real-fiat'] || modes.data.modes['real-crypto'] : false;
  return (
    <span title={realOn ? 'Real-money modes are enabled in settings' : 'Sandbox environment — real money is disabled'}
      className="inline-flex items-center gap-1.5 rounded-full border border-warn/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-warn">
      <FlaskConical size={12} aria-hidden />Sandbox<span className="hidden font-medium normal-case tracking-normal text-warn/80 md:inline">· {realOn ? 'real-money modes on' : 'real money disabled'}</span>
    </span>
  );
}

function Sidebar({ portal, onNavigate }: { portal: Portal; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-4 px-4 py-5">
      <Link to={portal.key} className="block px-2 pt-2" onClick={onNavigate}>
        <Wordmark size="lg" />
        <span className="mt-1.5 block text-[10px] font-medium uppercase tracking-[0.2em] text-muted">Console</span>
      </Link>
      <PortalMenu current={portal} />
      <nav aria-label={`${KIND_LABEL[portal.kind]} navigation`} className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
        {NAV[portal.kind].map((g, i) => (
          <div key={i}>
            {g.label && <div className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-muted">{g.label}</div>}
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.to}>
                  <NavLink to={it.to ? `${portal.key}/${it.to}` : portal.key} end={it.end ?? false} onClick={onNavigate}
                    className={({ isActive }) => cx('flex items-center gap-3 rounded-[8px] border px-3 py-[8px] text-[14px] transition-colors',
                      isActive ? 'border-accent/25 bg-accent-deep text-accent' : 'border-transparent text-ink/80 hover:bg-surface-2 hover:text-ink')}>
                    <it.icon size={16} aria-hidden />{it.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <p className="border-t border-line px-2 pt-3 text-[11px] leading-snug text-faint">Physical-table play is disabled until the PreFlop Trusted Shuffler is certified.</p>
    </div>
  );
}

/** Layout for every portal: sidebar, top bar, and the portal context. Renders a "no access" page for portals the user lacks. */
export function Shell({ noAccess }: { noAccess: ReactNode }) {
  const { portals } = useAuth();
  const loc = useLocation();
  const portal = portalForPath(portals, loc.pathname);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { if (portal?.enabled) session.rememberPortal(portal.key); }, [portal?.key, portal?.enabled]);
  useEffect(() => setDrawer(false), [loc.pathname]);

  if (!portal || !portal.enabled) return <>{noAccess}</>;

  return (
    <PortalCtx.Provider value={portal}>
      <div className="min-h-screen lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-screen border-r border-line bg-bg lg:block"><Sidebar portal={portal} /></aside>
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <div className="absolute inset-0 bg-black/70" onClick={() => setDrawer(false)} />
            <aside className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] border-r border-line bg-bg">
              <button type="button" className="absolute right-3 top-4 p-1 text-muted" onClick={() => setDrawer(false)} aria-label="Close navigation"><X size={18} /></button>
              <Sidebar portal={portal} onNavigate={() => setDrawer(false)} />
            </aside>
          </div>
        )}
        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex h-[72px] items-center gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur md:px-10">
            <button type="button" className="rounded-[10px] border border-line p-2 text-muted lg:hidden" onClick={() => setDrawer(true)} aria-label="Open navigation"><Menu size={18} /></button>
            <span className="truncate text-sm text-muted lg:hidden"><Wordmark size="sm" /></span>
            <div className="hidden min-w-0 items-center gap-3 text-sm lg:flex">
              <span className="text-[13px] font-medium uppercase tracking-[0.14em] text-muted">{KIND_LABEL[portal.kind]}</span>
              <span className="rounded-[6px] border border-accent/45 bg-accent-deep px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-accent">{portal.kind === 'admin' ? (portal.role === 'admin' ? 'SUPER ADMIN' : portal.role.toUpperCase()) : portal.role.toUpperCase()}</span>
              <span className="truncate text-ink/85">{portal.kind === 'admin' ? 'Back office' : portal.name}</span>
              {portal.role === 'viewer' && <span className="rounded-full border border-line-strong px-2 py-0.5 text-[11px] text-muted">read-only</span>}
            </div>
            <div className="ml-auto flex items-center gap-3"><EnvBadge /><UserMenu /></div>
          </header>
          <main className="mx-auto w-full max-w-[1400px] px-4 py-8 md:px-10 md:py-10">
            <Outlet />
          </main>
        </div>
      </div>
    </PortalCtx.Provider>
  );
}
