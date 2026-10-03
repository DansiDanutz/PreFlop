import { Card, StatusDot, cx, formatOdds } from '@preflop/ui';
import {
  ArrowRight, BadgeCheck, Briefcase, Building2, Eye, FileSignature, HeartHandshake, MousePointerClick, Network, ShieldCheck, Sigma, Trophy, Users, type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CtaBand, NewsCardView, SectionHead } from '../../components/site/blocks.tsx';
import { Eyebrow, SiteSection } from '../../components/site/SiteLayout.tsx';
import { StreamView } from '../../components/StreamView.tsx';
import { Skeleton } from '../../components/ui.tsx';
import { resolveOption } from '../../lib/bets.ts';
import { resultLine, roundLabel } from '../../lib/flop.ts';
import { openHandNo, tableStatus } from '../../lib/live.ts';
import { useBook, useLobby } from '../../lib/queries.ts';
import { useNewsList, usePageMeta } from '../../lib/site.ts';

const cta = 'inline-flex h-12 items-center justify-center gap-2 rounded-[14px] px-6 text-[15px] font-semibold transition-colors';

const SAMPLE_PRICES = ['hand-class:pair', 'hand-class:flush', 'hand-class:straight', 'colour:all-red', 'any-ace:yes', 'suit-pattern:rainbow'];

function LiveHero() {
  const lobby = useLobby();
  const t = lobby.data?.tables.find((x) => x.id === 'green-room') ?? lobby.data?.tables[0];
  const st = t ? tableStatus(t) : null;
  const hand = t ? openHandNo(t) : null;
  return (
    <Card className="overflow-hidden p-3 shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
      {t ? (
        <StreamView cards={t.last_flop?.cards} size="lg" revealKey={t.last_flop?.round_id ?? null} className="h-[300px] rounded-[14px] sm:h-[340px]" />
      ) : (
        <Skeleton className="h-[300px] sm:h-[340px]" />
      )}
      <div className="flex items-center justify-between gap-3 px-2 pb-1 pt-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{t ? `${t.name} · ${t.club_name}` : 'Loading live table…'}</div>
          <div className="text-[13px] text-muted">
            {t?.last_flop ? `Last flop · ${roundLabel(t.last_flop.hand_no)} · ${resultLine(t.last_flop.cards)}` : 'Simulated table'}
          </div>
        </div>
        {st && <StatusDot tone={st.tone} label={<span className="text-[13px]">{st.open && hand ? `${roundLabel(hand)} open` : st.label}</span>} />}
      </div>
    </Card>
  );
}

function Step({ n, icon, title, children }: { n: number; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full border border-accent/60 text-accent">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Step {n}</span>
      </div>
      <h3 className="mt-4 font-serif text-2xl">{title}</h3>
      <p className="mt-2 text-[15px] text-muted">{children}</p>
    </Card>
  );
}

function LiveStrip() {
  const lobby = useLobby();
  const tables = lobby.data?.tables ?? [];
  return (
    <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:-mx-5 sm:px-5">
      {lobby.isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[200px] w-[260px] shrink-0" />)}
      {lobby.isError && <p className="text-sm text-muted">Live tables are not reachable right now.</p>}
      {tables.map((t) => {
        const st = tableStatus(t);
        return (
          <Link key={t.id} to={`/app/table/${t.id}`} className="w-[260px] shrink-0 snap-start rounded-[18px]">
            <Card className="overflow-hidden p-2.5 hover:border-line-strong">
              <StreamView cards={t.last_flop?.cards} size="sm" revealKey={t.last_flop?.round_id ?? null} className="h-[130px] rounded-[12px]" />
              <div className="px-1.5 pb-1 pt-2.5">
                <div className="truncate font-semibold">{t.name}</div>
                <div className="truncate text-[13px] text-muted">{t.club_name} · {t.city ?? 'Online'}</div>
                <div className="mt-1.5"><StatusDot tone={st.tone} label={<span className="text-[13px]">{st.label}</span>} /></div>
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

function HonestOdds() {
  const book = useBook();
  return (
    <div className="grid items-start gap-10 lg:grid-cols-[1fr_1.1fr]">
      <div>
        <Eyebrow>Honest odds</Eyebrow>
        <h2 className="font-serif text-4xl leading-tight sm:text-5xl">Every price comes from all 22,100 flops.</h2>
        <p className="mt-5 text-[17px] text-muted">
          A flop is three cards from a 52-card deck, so there are exactly 22,100 possible flops. For every bet we count how many of them win.
          That count is the true probability. The price you see is that probability with a small, published margin. No guesses, no hidden adjustments.
        </p>
        <p className="mt-4 text-[17px] text-muted">The same rule that prices a bet also settles it, so what we publish is what we pay.</p>
        <Link to="/odds" className={cx(cta, 'mt-7 border border-line-strong text-ink hover:border-accent hover:text-accent')}>See the full odds book <ArrowRight className="h-4 w-4" aria-hidden /></Link>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Sample prices from the live odds book</caption>
          <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
            <tr><th scope="col" className="px-5 py-3 font-medium">Bet</th><th scope="col" className="px-3 py-3 text-right font-medium">Winning flops</th><th scope="col" className="px-3 py-3 text-right font-medium">Chance</th><th scope="col" className="px-5 py-3 text-right font-medium">Odds</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {book.isLoading && <tr><td colSpan={4} className="p-5"><Skeleton className="h-40" /></td></tr>}
            {book.isError && <tr><td colSpan={4} className="p-5 text-muted">The odds book is not reachable right now.</td></tr>}
            {SAMPLE_PRICES.map((id) => {
              const o = resolveOption(book.index, id);
              const sel = book.data?.markets.flatMap((m) => m.selections).find((s) => s.id === o?.id);
              if (!o || !sel) return null;
              return (
                <tr key={id}>
                  <td className="px-5 py-3.5"><div className="font-medium text-ink">{o.name}</div><div className="text-xs text-muted">{o.marketName}</div></td>
                  <td className="px-3 py-3.5 text-right tabular-nums text-muted">{sel.wins.toLocaleString('en-US')} / 22,100</td>
                  <td className="px-3 py-3.5 text-right tabular-nums">{(sel.probability * 100).toFixed(2)}%</td>
                  <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-accent">{formatOdds(o.oddsCenti)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">Live prices from the PreFlop odds book. Decimal odds include your stake.</p>
      </Card>
    </div>
  );
}

const TRUST: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Sigma, title: 'Exact odds', body: 'Every price counts the winning flops among all 22,100.' },
  { icon: FileSignature, title: 'Signed evidence', body: 'Each flop is backed by a signed, hash-chained record.' },
  { icon: ShieldCheck, title: '18+ with limits', body: 'Age gate, session limits, reality checks, self-exclusion.' },
  { icon: BadgeCheck, title: 'No cash value', body: 'Free chips are for fun and can never be cashed out.' },
];

function TrustStrip() {
  return (
    <SiteSection className="pb-6">
      <ul className="grid gap-px overflow-hidden rounded-[14px] border border-line-strong/60 bg-line sm:grid-cols-2 lg:grid-cols-4" aria-label="Why PreFlop">
        {TRUST.map(({ icon: I, title, body }) => (
          <li key={title} className="flex gap-3 bg-surface p-5">
            <I className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
            <div><div className="font-semibold text-ink">{title}</div><p className="mt-0.5 text-sm text-muted">{body}</p></div>
          </li>
        ))}
      </ul>
    </SiteSection>
  );
}

function Audience({ icon: I, title, to, children }: { icon: LucideIcon; title: string; to: string; children: ReactNode }) {
  return (
    <Link to={to} className="group block h-full rounded-[12px]">
      <Card className="flex h-full flex-col p-6 transition-colors group-hover:border-accent/60">
        <span className="grid h-11 w-11 place-items-center rounded-[12px] border border-line text-accent"><I className="h-5 w-5" aria-hidden /></span>
        <h3 className="mt-5 font-serif text-2xl">{title}</h3>
        <p className="mt-2 flex-1 text-[15px] text-muted">{children}</p>
        <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-accent">Learn more<span className="sr-only"> about PreFlop {title.toLowerCase()}</span> <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
      </Card>
    </Link>
  );
}

function LatestNews() {
  const news = useNewsList(null, 3);
  const posts = news.data?.posts ?? [];
  if (news.isError || (news.isSuccess && posts.length === 0)) return null;
  return (
    <SiteSection className="py-16" labelledBy="home-news">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <SectionHead eyebrow="News" title="Latest from PreFlop" id="home-news" />
        <Link to="/news" className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:text-accent-strong">All news <ArrowRight className="h-4 w-4" aria-hidden /></Link>
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        {news.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[220px]" />)}
        {posts.map((p) => <NewsCardView key={p.id} post={p} />)}
      </div>
    </SiteSection>
  );
}

export function LandingPage() {
  usePageMeta(null, 'PreFlop: predict the three-card flop at poker tables. Exact odds over all 22,100 flops, a signed evidence chain and free chips with no cash value. 18+.');
  return (
    <>
      <SiteSection className="grid items-center gap-12 pb-12 pt-10 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
        <div>
          <Eyebrow>Poker tables · Three cards · Exact odds</Eyebrow>
          <h1 className="font-serif text-[52px] leading-[1.02] tracking-tight sm:text-[76px]">Predict the flop.</h1>
          <p className="mt-6 max-w-[520px] text-lg text-muted">
            Watch a poker table and call the next three community cards: a pair, a flush, a straight, all red. 42 markets, every price calculated over all 22,100 possible flops.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register" className={cx(cta, 'bg-accent text-accent-ink hover:bg-accent-strong')}>Play free <ArrowRight className="h-4 w-4" aria-hidden /></Link>
            <Link to="/demo" className={cx(cta, 'border border-line-strong text-ink hover:border-accent hover:text-accent')}>Watch a live table</Link>
            <Link to="/players" className={cx(cta, 'border border-line-strong text-ink hover:border-accent hover:text-accent')}>How to play</Link>
          </div>
          <p className="mt-4 text-sm text-muted">18+ only. Free chips to start; they have no cash value and can never be cashed out.</p>
        </div>
        <LiveHero />
      </SiteSection>

      <TrustStrip />

      <SiteSection className="py-16">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="max-w-[860px] font-serif text-4xl leading-tight sm:text-5xl">Three steps, one flop at a time.</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          <Step n={1} icon={<Users className="h-5 w-5" />} title="Pick a table">Choose a live table in the lobby. Every table today is a simulated table, dealing around the clock.</Step>
          <Step n={2} icon={<MousePointerClick className="h-5 w-5" />} title="Predict the next flop">Choose a pair, a flush, a straight, a colour and more, then set your stake. Betting closes before any card is dealt.</Step>
          <Step n={3} icon={<Eye className="h-5 w-5" />} title="Watch the reveal">The flop is revealed, results settle in seconds and your free-chip balance updates at once.</Step>
        </div>
      </SiteSection>

      <SiteSection className="py-16">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Live tables</Eyebrow>
            <h2 className="font-serif text-4xl leading-tight sm:text-5xl">Dealing right now.</h2>
          </div>
          <p className="max-w-[420px] text-sm text-muted">Physical-table play is switched off while clubs are certified, so every table here is a simulated table.</p>
        </div>
        <LiveStrip />
      </SiteSection>

      <SiteSection className="py-16"><HonestOdds /></SiteSection>

      <SiteSection className="py-16">
        <SectionHead eyebrow="Who PreFlop is for" title="One game, built for everyone around the table." />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Audience icon={Trophy} title="Players" to="/players">Live tables, 42 markets, free-chip tournaments, leaderboards and an app you can install on your phone.</Audience>
          <Audience icon={Building2} title="Poker clubs" to="/clubs">Certified tables, a PreFlop Table Box and a revenue share measured from what your tables produce.</Audience>
          <Audience icon={Briefcase} title="Betting partners" to="/partners">A partner API, an embeddable widget you can style, signed webhooks and idempotent deposits.</Audience>
          <Audience icon={HeartHandshake} title="Organizers" to="/organizers">Run rooms for your community with chips or diamonds, tournaments and leaderboards.</Audience>
          <Audience icon={Network} title="Agents" to="/agents">A two-level referral programme for licensed real-money markets, applied for from your profile.</Audience>
          <Audience icon={ShieldCheck} title="Fairness & security" to="/fairness">Exact odds, the Trusted Shuffler, signed tablets and a review for every round that needs one.</Audience>
        </div>
      </SiteSection>

      <LatestNews />

      <SiteSection className="py-16">
        <Card className="felt felt-vignette grid gap-8 overflow-hidden p-8 sm:p-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <Eyebrow>Responsible play</Eyebrow>
            <h2 className="font-serif text-4xl leading-tight">Play for fun. Stay in control.</h2>
            <p className="mt-4 max-w-[560px] text-[17px] text-ink/80">
              PreFlop is for adults only. Set a session limit, get reality checks, set limits, take a break or self-exclude from your profile at any time. Free chips can be reset whenever you like and never turn into money.
            </p>
            <Link to="/responsible-gaming" className={cx(cta, 'mt-6 bg-ink text-bg hover:bg-white')}>Our approach <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </div>
          <ul className="space-y-3 self-center text-[15px]">
            {['18+ only, with a date-of-birth check', 'Session limits and reality checks', 'Self-exclusion that cannot be shortened', 'Free chips have no cash value'].map((x) => (
              <li key={x} className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-accent" aria-hidden /> {x}</li>
            ))}
          </ul>
        </Card>
      </SiteSection>

      <CtaBand title="Take a seat." primary={{ to: '/register', label: 'Play free' }} secondary={{ to: '/odds', label: 'See the odds' }}>
        Create a free account in a minute. You start with free chips, which have no cash value.
      </CtaBand>
    </>
  );
}
