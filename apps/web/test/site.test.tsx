import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { NAV, SiteLayout } from '../src/components/site/SiteLayout.tsx';
import { pageTitle, tagLabel } from '../src/lib/site.ts';
import { AgentsPage } from '../src/pages/site/Agents.tsx';
import { ForClubsPage, ForOrganizersPage, ForPartnersPage } from '../src/pages/site/Business.tsx';
import { FairnessPage } from '../src/pages/site/Fairness.tsx';
import { LandingPage } from '../src/pages/site/Landing.tsx';
import { ResponsiblePage } from '../src/pages/site/Legal.tsx';
import { NewsPage } from '../src/pages/site/News.tsx';
import { OddsPage } from '../src/pages/site/Odds.tsx';
import { PlayersPage } from '../src/pages/site/Players.tsx';

const PAGES: [string, () => React.JSX.Element][] = [
  ['/', LandingPage], ['/players', PlayersPage], ['/clubs', ForClubsPage], ['/partners', ForPartnersPage], ['/organizers', ForOrganizersPage],
  ['/agents', AgentsPage], ['/fairness', FairnessPage], ['/odds', OddsPage], ['/responsible-gaming', ResponsiblePage], ['/news', NewsPage],
];

function render(path: string, Page: () => React.JSX.Element): string {
  // No fetch in this test: queries stay in their loading state.
  const qc = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route element={<SiteLayout />}><Route path="*" element={<Page />} /></Route></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('public website', () => {
  it('the header reaches every category and News', () => {
    const links = NAV.flatMap((x) => ('links' in x ? x.links.map((l) => l.to) : [x.to]));
    expect(links).toEqual(expect.arrayContaining(['/players', '/odds', '/clubs', '/partners', '/organizers', '/agents', '/fairness', '/responsible-gaming', '/news']));
  });

  it('titles pages consistently', () => {
    expect(pageTitle(null)).toBe('PreFlop: predict the flop');
    expect(pageTitle('News')).toBe('News · PreFlop');
    expect(tagLabel('responsible-play')).toBe('Responsible play');
  });

  for (const [path, Page] of PAGES) {
    it(`${path} has one h1, the 18+ footer and compliant copy`, () => {
      const html = render(path, Page);
      expect(html.match(/<h1[\s>]/g)?.length, 'exactly one h1').toBe(1);
      const t = text(html);
      expect(t).toContain('18+ only.');
      expect(t).toContain('free chips have no cash value');
      expect(t).toMatch(/only ever be offered where licensed, through licensed operators/);
      expect(t).not.toMatch(/(?<!no )guaranteed (win|income|profit|earning)/i);
      expect(t).not.toMatch(/real[- ]money (play |betting )?is (now )?(live|available|on)\b/i);
      expect(t).not.toMatch(/cash out your (chips|diamonds)/i);
      // Every footer link is a real page.
      for (const to of ['/players', '/odds', '/news', '/clubs', '/partners', '/organizers', '/agents', '/fairness', '/responsible-gaming', '/terms', '/privacy']) expect(html).toContain(`href="${to}"`);
      // No inline scripts or styles that the CSP would block.
      expect(html).not.toMatch(/<script|javascript:/i);
    });
  }

  it('the agent page keeps the licensed-markets caveat and promises no income', () => {
    const t = text(render('/agents', AgentsPage));
    expect(t).toMatch(/applies only to licensed real-money markets in the future/);
    expect(t).toMatch(/no guaranteed income/);
  });
});
