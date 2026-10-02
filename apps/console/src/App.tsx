import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './lib/auth.tsx';
import { session } from './lib/api.ts';
import { pickLandingPortal } from './lib/portals.ts';
import { Shell } from './components/Shell.tsx';
import { Loading, ErrorBox } from './components/ui.tsx';
import { DesignPage } from './pages/Design.tsx';
import { LoginPage } from './pages/Login.tsx';
import { PortalsPage, NoAccessPage, NotFoundPage } from './pages/Portals.tsx';
import * as A from './portals/admin/index.ts';
import * as O from './portals/org/index.ts';
import * as C from './portals/club/index.tsx';
import * as P from './portals/partner/index.tsx';
import * as G from './portals/organizer/index.tsx';
import * as W from './portals/growth/index.tsx';

function RequireAuth({ children }: { children: ReactNode }) {
  const { token, loading, me, error } = useAuth();
  const loc = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (loading) return <div className="grid min-h-screen place-items-center"><Loading label="Signing you in…" /></div>;
  if (!me) return <div className="mx-auto max-w-lg p-10"><ErrorBox error={error} /></div>;
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
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/design" element={<DesignPage />} />
      <Route path="/" element={<RequireAuth><Landing /></RequireAuth>} />
      <Route path="/portals" element={<RequireAuth><PortalsPage /></RequireAuth>} />

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
        <Route path="promotions" element={<W.Promotions />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route path="/club/:orgId" element={shell}>
        <Route index element={<O.OrgOverviewPage />} />
        <Route path="tables" element={<C.Tables />} />
        <Route path="staff" element={<C.Staff />} />
        <Route path="hands" element={<O.HandLog />} />
        <Route path="rooms" element={<O.Rooms />} />
        <Route path="leaderboards" element={<W.Leaderboards />} />
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
  );
}
