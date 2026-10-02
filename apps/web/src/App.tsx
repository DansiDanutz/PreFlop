import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { AppLayout } from './components/AppShell.tsx';
import { SiteLayout } from './components/site/SiteLayout.tsx';
import { RequireAuth, useSessionGuard } from './lib/auth.tsx';
import { LeaderboardPage, LeaderboardsPage } from './pages/app/Leaderboards.tsx';
import { PromotionsPage } from './pages/app/Promotions.tsx';
import { ActivityPage } from './pages/app/Activity.tsx';
import { ClubPage } from './pages/app/Club.tsx';
import { ClubsPage } from './pages/app/Clubs.tsx';
import { LobbyPage } from './pages/app/Lobby.tsx';
import { ProfilePage } from './pages/app/Profile.tsx';
import { TablePage } from './pages/app/Table.tsx';
import { LoginPage, RegisterPage } from './pages/Auth.tsx';
import { EmbedTablePage } from './pages/Embed.tsx';
import { ForClubsPage, ForOrganizersPage, ForPartnersPage } from './pages/site/Business.tsx';
import { LandingPage } from './pages/site/Landing.tsx';
import { PrivacyPage, ResponsiblePage, TermsPage } from './pages/site/Legal.tsx';
import { NotFoundPage } from './pages/site/NotFound.tsx';
import { OddsPage } from './pages/site/Odds.tsx';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

export function App() {
  useSessionGuard();
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<SiteLayout />}>
          <Route index element={<LandingPage />} />
          <Route path="odds" element={<OddsPage />} />
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
        <Route path="app" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<LobbyPage />} />
          <Route path="clubs" element={<ClubsPage />} />
          <Route path="clubs/:id" element={<ClubPage />} />
          <Route path="table/:id" element={<TablePage />} />
          <Route path="table/:id/bets" element={<TablePage />} />
          <Route path="leaderboards" element={<LeaderboardsPage />} />
          <Route path="leaderboards/:id" element={<LeaderboardPage />} />
          <Route path="promotions" element={<PromotionsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<NotFoundPage inApp />} />
        </Route>
        <Route path="embed/table/:id" element={<EmbedTablePage />} />
      </Routes>
    </>
  );
}
