import { Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { AppLayout } from './components/AppShell.tsx';
import { SiteLayout } from './components/site/SiteLayout.tsx';
import { RequireAuth, useSessionGuard } from './lib/auth.tsx';
import { lazyNamed } from './lib/lazy.ts';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from './pages/Auth.tsx';
import { LandingPage } from './pages/site/Landing.tsx';
import { NotFoundPage } from './pages/site/NotFound.tsx';

// Route-level code splitting: the landing page and sign-in load first; the player app, the
// partner widget and the other site pages are separate same-origin chunks.
const leaderboards = () => import('./pages/app/Leaderboards.tsx');
const tournaments = () => import('./pages/app/Tournaments.tsx');
const business = () => import('./pages/site/Business.tsx');
const legal = () => import('./pages/site/Legal.tsx');
const LeaderboardPage = lazyNamed(leaderboards, 'LeaderboardPage');
const LeaderboardsPage = lazyNamed(leaderboards, 'LeaderboardsPage');
const PromotionsPage = lazyNamed(() => import('./pages/app/Promotions.tsx'), 'PromotionsPage');
const TournamentPage = lazyNamed(tournaments, 'TournamentPage');
const TournamentsPage = lazyNamed(tournaments, 'TournamentsPage');
const ActivityPage = lazyNamed(() => import('./pages/app/Activity.tsx'), 'ActivityPage');
const ClubPage = lazyNamed(() => import('./pages/app/Club.tsx'), 'ClubPage');
const ClubsPage = lazyNamed(() => import('./pages/app/Clubs.tsx'), 'ClubsPage');
const LobbyPage = lazyNamed(() => import('./pages/app/Lobby.tsx'), 'LobbyPage');
const ProfilePage = lazyNamed(() => import('./pages/app/Profile.tsx'), 'ProfilePage');
const TablePage = lazyNamed(() => import('./pages/app/Table.tsx'), 'TablePage');
const EmbedTablePage = lazyNamed(() => import('./pages/Embed.tsx'), 'EmbedTablePage');
const ForClubsPage = lazyNamed(business, 'ForClubsPage');
const ForOrganizersPage = lazyNamed(business, 'ForOrganizersPage');
const ForPartnersPage = lazyNamed(business, 'ForPartnersPage');
const PrivacyPage = lazyNamed(legal, 'PrivacyPage');
const ResponsiblePage = lazyNamed(legal, 'ResponsiblePage');
const TermsPage = lazyNamed(legal, 'TermsPage');
const OddsPage = lazyNamed(() => import('./pages/site/Odds.tsx'), 'OddsPage');
const DemoPage = lazyNamed(() => import('./pages/site/Demo.tsx'), 'DemoPage');

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

/** Fallback while a route chunk loads (the layouts keep their chrome with an inner boundary). */
export function PageLoading() {
  return <div role="status" aria-label="Loading" className="grid min-h-[40vh] place-items-center"><span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" /></div>;
}

export function App() {
  useSessionGuard();
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route index element={<LandingPage />} />
          <Route path="odds" element={<OddsPage />} />
          <Route path="demo" element={<DemoPage />} />
          <Route path="clubs" element={<ForClubsPage />} />
          <Route path="partners" element={<ForPartnersPage />} />
          <Route path="organizers" element={<ForOrganizersPage />} />
          <Route path="responsible-gaming" element={<ResponsiblePage />} />
          <Route path="terms" element={<TermsPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="verify-email" element={<VerifyEmailPage />} />
        <Route path="app" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<LobbyPage />} />
          <Route path="clubs" element={<ClubsPage />} />
          <Route path="clubs/:id" element={<ClubPage />} />
          <Route path="table/:id" element={<TablePage />} />
          <Route path="table/:id/bets" element={<TablePage />} />
          <Route path="leaderboards" element={<LeaderboardsPage />} />
          <Route path="leaderboards/:id" element={<LeaderboardPage />} />
          <Route path="tournaments" element={<TournamentsPage />} />
          <Route path="tournaments/:id" element={<TournamentPage />} />
          <Route path="promotions" element={<PromotionsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<NotFoundPage inApp />} />
        </Route>
        <Route path="embed/table/:id" element={<EmbedTablePage />} />
        <Route path="embed" element={<EmbedTablePage />} />
      </Routes>
      </Suspense>
    </>
  );
}
