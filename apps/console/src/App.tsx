import { type ReactNode, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './lib/auth.tsx';
import { session } from './lib/api.ts';
import { pickLandingPortal } from './lib/portals.ts';
import { Shell } from './components/Shell.tsx';
import { Loading, ErrorBox } from './components/ui.tsx';
import { lazyNamed } from './lib/lazy.ts';
import { LoginPage } from './pages/Login.tsx';
import { ClaimPage } from './pages/Claim.tsx';
import { SecurityPage } from './pages/Security.tsx';
import { PortalsPage, NoAccessPage, NotFoundPage } from './pages/Portals.tsx';

// Route-level code splitting: each portal group is its own chunk, loaded when first opened.
const admin = () => import('./portals/admin/index.ts');
const org = () => import('./portals/org/index.ts');
const club = () => import('./portals/club/index.tsx');
const partner = () => import('./portals/partner/index.tsx');
const organizer = () => import('./portals/organizer/index.tsx');
const growth = () => import('./portals/growth/index.tsx');
const tournaments = () => import('./portals/growth/Tournaments.tsx');
const DesignPage = lazyNamed(() => import('./pages/Design.tsx'), 'DesignPage');
const A = {
  Overview: lazyNamed(admin, 'Overview'), Tables: lazyNamed(admin, 'Tables'), ReviewQueue: lazyNamed(admin, 'ReviewQueue'), ReviewDetail: lazyNamed(admin, 'ReviewDetail'),
  Rounds: lazyNamed(admin, 'Rounds'), Risk: lazyNamed(admin, 'Risk'), Alerts: lazyNamed(admin, 'Alerts'), Users: lazyNamed(admin, 'Users'), Orgs: lazyNamed(admin, 'Orgs'),
  Ledger: lazyNamed(admin, 'Ledger'), Audit: lazyNamed(admin, 'Audit'), Statements: lazyNamed(admin, 'Statements'), Book: lazyNamed(admin, 'Book'),
  Payments: lazyNamed(admin, 'Payments'), Settings: lazyNamed(admin, 'Settings'),
};
const O = {
  OrgOverviewPage: lazyNamed(org, 'OrgOverviewPage'), Members: lazyNamed(org, 'Members'), Players: lazyNamed(org, 'Players'), Statements: lazyNamed(org, 'Statements'),
  Transfers: lazyNamed(org, 'Transfers'), Chips: lazyNamed(org, 'Chips'), Treasury: lazyNamed(org, 'Treasury'), Rooms: lazyNamed(org, 'Rooms'),
  HandLog: lazyNamed(org, 'HandLog'), OrgSettings: lazyNamed(org, 'OrgSettings'),
};
const C = { Tables: lazyNamed(club, 'Tables'), Staff: lazyNamed(club, 'Staff') };
const P = { Keys: lazyNamed(partner, 'Keys'), Webhooks: lazyNamed(partner, 'Webhooks'), Widget: lazyNamed(partner, 'Widget'), Docs: lazyNamed(partner, 'Docs'), Bets: lazyNamed(partner, 'Bets') };
const G = { Diamonds: lazyNamed(organizer, 'Diamonds') };
const W = { Leaderboards: lazyNamed(growth, 'Leaderboards'), Promotions: lazyNamed(growth, 'Promotions') };
const Agents = lazyNamed(() => import('./portals/growth/Agents.tsx'), 'Agents');
const Tournaments = lazyNamed(tournaments, 'Tournaments');
const TournamentDetailPage = lazyNamed(tournaments, 'TournamentDetailPage');
const AgentOverview = lazyNamed(() => import('./portals/agent/index.tsx'), 'AgentOverview');

function RequireAuth({ children }: { children: ReactNode }) {
  const { token, loading, me, error } = useAuth();
  const loc = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (loading) return <div className="grid min-h-screen place-items-center"><Loading label="Signing you in…" /></div>;
  if (!me) return <div className="mx-auto max-w-lg p-10"><ErrorBox error={error} /></div>;
  // require_staff_mfa: a PreFlop team account without 2FA can only enrol.
  if (me.mfa_enrollment_required && loc.pathname !== '/account/security') return <Navigate to="/account/security" replace />;
  return <>{children}</>;
}

function Landing() {
  const { portals } = useAuth();
  const p = pickLandingPortal(portals, session.lastPortal);
  return <Navigate to={p ? p.key : '/portals'} replace />;
}

export function App() {
  const shell = <RequireAuth><Shell noAccess={<NoAccessPage />} /></RequireAuth>;
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center"><Loading /></div>}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/design" element={<DesignPage />} />
      <Route path="/" element={<RequireAuth><Landing /></RequireAuth>} />
      <Route path="/portals" element={<RequireAuth><PortalsPage /></RequireAuth>} />
      <Route path="/claim/:token" element={<RequireAuth><ClaimPage /></RequireAuth>} />
      <Route path="/account/security" element={<RequireAuth><SecurityPage /></RequireAuth>} />

      <Route path="/admin" element={shell}>
        <Route index element={<A.Overview />} />
        <Route path="tables" element={<A.Tables />} />
        <Route path="review" element={<A.ReviewQueue />} />
        <Route path="review/:roundId" element={<A.ReviewDetail />} />
        <Route path="rounds" element={<A.Rounds />} />
        <Route path="risk" element={<A.Risk />} />
        <Route path="alerts" element={<A.Alerts />} />
        <Route path="users" element={<A.Users />} />
        <Route path="orgs" element={<A.Orgs />} />
        <Route path="ledger" element={<A.Ledger />} />
        <Route path="audit" element={<A.Audit />} />
        <Route path="statements" element={<A.Statements />} />
        <Route path="book" element={<A.Book />} />
        <Route path="payments" element={<A.Payments />} />
        <Route path="settings" element={<A.Settings />} />
        <Route path="leaderboards" element={<W.Leaderboards />} />
        <Route path="tournaments" element={<Tournaments />} />
        <Route path="tournaments/:id" element={<TournamentDetailPage />} />
        <Route path="promotions" element={<W.Promotions />} />
        <Route path="agents" element={<Agents />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route path="/agent" element={shell}>
        <Route index element={<AgentOverview />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route path="/club/:orgId" element={shell}>
        <Route index element={<O.OrgOverviewPage />} />
        <Route path="tables" element={<C.Tables />} />
        <Route path="staff" element={<C.Staff />} />
        <Route path="hands" element={<O.HandLog />} />
        <Route path="rooms" element={<O.Rooms />} />
        <Route path="leaderboards" element={<W.Leaderboards />} />
        <Route path="tournaments" element={<Tournaments />} />
        <Route path="tournaments/:id" element={<TournamentDetailPage />} />
        <Route path="promotions" element={<W.Promotions />} />
        <Route path="chips" element={<O.Chips />} />
        <Route path="players" element={<O.Players />} />
        <Route path="revenue" element={<O.Statements variant="revenue" />} />
        <Route path="members" element={<O.Members />} />
        <Route path="settings" element={<O.OrgSettings />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route path="/partner/:orgId" element={shell}>
        <Route index element={<O.OrgOverviewPage />} />
        <Route path="keys" element={<P.Keys />} />
        <Route path="webhooks" element={<P.Webhooks />} />
        <Route path="widget" element={<P.Widget />} />
        <Route path="docs" element={<P.Docs />} />
        <Route path="bets" element={<P.Bets />} />
        <Route path="statements" element={<O.Statements />} />
        <Route path="members" element={<O.Members />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route path="/organizer/:orgId" element={shell}>
        <Route index element={<O.OrgOverviewPage />} />
        <Route path="rooms" element={<O.Rooms />} />
        <Route path="leaderboards" element={<W.Leaderboards />} />
        <Route path="tournaments" element={<Tournaments />} />
        <Route path="tournaments/:id" element={<TournamentDetailPage />} />
        <Route path="promotions" element={<W.Promotions />} />
        <Route path="diamonds" element={<G.Diamonds />} />
        <Route path="chips" element={<O.Chips />} />
        <Route path="treasury" element={<O.Treasury />} />
        <Route path="transfers" element={<O.Transfers />} />
        <Route path="players" element={<O.Players />} />
        <Route path="statements" element={<O.Statements />} />
        <Route path="members" element={<O.Members />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route path="*" element={<RequireAuth><NotFoundPage standalone /></RequireAuth>} />
    </Routes>
    </Suspense>
  );
}
