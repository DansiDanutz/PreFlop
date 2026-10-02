import { Link, useNavigate } from 'react-router';
import { ArrowRight, LogOut } from 'lucide-react';
import { Button, Card, Wordmark, cx } from '@preflop/ui';
import { useAuth } from '../lib/auth.tsx';
import { KIND_LABEL } from '../lib/portals.ts';
import { session } from '../lib/api.ts';
import { PORTAL_ICON } from '../components/nav.ts';
import { EnvBadge } from '../components/Shell.tsx';

export function PortalsPage() {
  const { portals, me, logout } = useAuth();
  const nav = useNavigate();
  const last = session.lastPortal;
  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between border-b border-line px-4 md:px-8">
        <div className="flex items-baseline gap-2"><Wordmark /><span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">Console</span></div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex"><EnvBadge /></span>
          <Button variant="ghost" size="sm" onClick={async () => { await logout(); nav('/login'); }}><LogOut size={14} aria-hidden />Sign out</Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="font-serif text-4xl">Choose a portal</h1>
        <p className="mt-2 text-muted">Signed in as <span className="text-ink">{me?.email}</span>. You have access to {portals.length} {portals.length === 1 ? 'portal' : 'portals'}.</p>
        {portals.length === 0 ? (
          <Card className="mt-8 p-8 text-center">
            <div className="font-serif text-2xl">No console access yet</div>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Your account is not a member of any club, partner or organizer, and has no PreFlop team role. Ask an owner of your organization to add you under <strong className="text-ink">Members</strong>, or apply on the PreFlop website.
            </p>
          </Card>
        ) : (
          <ul className="mt-8 grid gap-3">
            {portals.map((p) => {
              const Icon = PORTAL_ICON[p.kind];
              const inner = (
                <>
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent-soft text-accent ring-1 ring-accent/50"><Icon size={20} aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-xl">{p.name}</span>
                    <span className="block text-sm text-muted">{KIND_LABEL[p.kind]} · {p.role}{!p.enabled && ` · ${p.status}`}{p.key === last && ' · last used'}</span>
                  </span>
                  {p.enabled && <ArrowRight size={18} className="text-faint transition-colors group-hover:text-accent" aria-hidden />}
                </>
              );
              return (
                <li key={p.key} className="min-w-0">
                  {p.enabled ? (
                    <Link to={p.key} className={cx('group flex items-center gap-4 rounded-[12px] border bg-surface px-5 py-4 transition-colors hover:border-accent/60', p.key === last ? 'border-accent/40' : 'border-line')}>{inner}</Link>
                  ) : (
                    <div className="flex items-center gap-4 rounded-[12px] border border-line bg-surface px-5 py-4 opacity-55" aria-disabled>{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}

export function NoAccessPage() {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <Card className="max-w-md p-8 text-center">
        <div className="font-serif text-3xl">No access</div>
        <p className="mt-2 text-sm text-muted">You are not a member of this portal, or it is suspended. Pick one of the portals you can open.</p>
        <Link to="/portals" className="mt-6 inline-flex h-11 items-center rounded-[12px] bg-accent px-5 font-semibold text-accent-ink">Choose a portal</Link>
      </Card>
    </div>
  );
}

export function NotFoundPage({ standalone }: { standalone?: boolean }) {
  const body = (
    <div className="py-16 text-center">
      <div className="font-serif text-4xl">Page not found</div>
      <p className="mt-2 text-sm text-muted">This page does not exist in the console.</p>
      <Link to="/" className="mt-6 inline-block text-accent hover:underline">Go to your portal</Link>
    </div>
  );
  return standalone ? <div className="grid min-h-screen place-items-center">{body}</div> : body;
}
