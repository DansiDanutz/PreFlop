import { Card, StatusDot, cx, formatOdds } from '@preflop/ui';
import { ArrowRight, Briefcase, Building2, Eye, HeartHandshake, MousePointerClick, ShieldCheck, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Eyebrow, SiteSection } from '../../components/site/SiteLayout.tsx';
import { StreamView } from '../../components/StreamView.tsx';
import { Skeleton } from '../../components/ui.tsx';
import { resolveOption } from '../../lib/bets.ts';
import { resultLine, roundLabel } from '../../lib/flop.ts';
import { openHandNo, tableStatus } from '../../lib/live.ts';
import { useBook, useLobby } from '../../lib/queries.ts';

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
    <div className="no-scrollbar -mx-5 flex snap-x gap-4 overflow-x-auto px-5 pb-2">
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

function Teaser({ icon, title, to, children }: { icon: ReactNode; title: string; to: string; children: ReactNode }) {
  return (
    <Link to={to} className="group block rounded-[18px]">
      <Card className="h-full p-6 transition-colors group-hover:border-accent/60">
        <span className="grid h-11 w-11 place-items-center rounded-[12px] border border-line text-accent">{icon}</span>
        <h3 className="mt-5 font-serif text-2xl">{title}</h3>
        <p className="mt-2 text-[15px] text-muted">{children}</p>
        <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-accent">Learn more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
      </Card>
    </Link>
  );
}

export function LandingPage() {
  return (
    <>
      <SiteSection className="grid items-center gap-12 pb-16 pt-12 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
        <div>
          <Eyebrow>Live poker · Three cards · Exact odds</Eyebrow>
          <h1 className="font-serif text-[56px] leading-[1.02] tracking-tight sm:text-[76px]">Predict the flop.</h1>
          <p className="mt-6 max-w-[520px] text-lg text-muted">
            Watch a live poker table and call the next three community cards: a pair, a flush, a straight, all red. Every price is calculated over all 22,100 possible flops.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register" className={cx(cta, 'bg-accent text-accent-ink hover:bg-accent-strong')}>Play free <ArrowRight className="h-4 w-4" aria-hidden /></Link>
            <Link to="/odds" className={cx(cta, 'border border-line-strong text-ink hover:border-accent hover:text-accent')}>See the odds</Link>
          </div>
          <p className="mt-4 text-sm text-faint">10,000 free chips to start. Free chips have no cash value.</p>
        </div>
        <LiveHero />
      </SiteSection>

      <SiteSection className="py-16">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="max-w-[860px] font-serif text-4xl leading-tight sm:text-5xl">Three steps, one flop at a time.</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          <Step n={1} icon={<Users className="h-5 w-5" />} title="Pick a table">Join a live table from a partner poker club, or practise at The Green Room any time.</Step>
          <Step n={2} icon={<MousePointerClick className="h-5 w-5" />} title="Predict the next flop">Choose a pair, a flush, a straight, a colour and more, then set your stake. Betting closes before any card is dealt.</Step>
          <Step n={3} icon={<Eye className="h-5 w-5" />} title="Watch the reveal">The dealer deals the flop on camera. Results settle in seconds and your balance updates at once.</Step>
        </div>
      </SiteSection>

      <SiteSection className="py-16">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Live tables</Eyebrow>
            <h2 className="font-serif text-4xl leading-tight sm:text-5xl">Dealing right now.</h2>
          </div>
          <p className="max-w-[420px] text-sm text-muted">Physical-table play is switched off while we certify clubs, so every table here is a simulated table with a demo stream.</p>
        </div>
        <LiveStrip />
      </SiteSection>

      <SiteSection className="py-16"><HonestOdds /></SiteSection>

      <SiteSection className="py-16">
        <Eyebrow>Work with PreFlop</Eyebrow>
        <h2 className="max-w-[720px] font-serif text-4xl leading-tight sm:text-5xl">Built for the people who run the game.</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          <Teaser icon={<Building2 className="h-5 w-5" />} title="For poker clubs" to="/clubs">Turn every hand you deal into content. Certified equipment, a live stream of the cards only, and a revenue share.</Teaser>
          <Teaser icon={<Briefcase className="h-5 w-5" />} title="For betting companies" to="/partners">A new live market with an API, a drop-in widget, a seamless wallet and signed webhooks.</Teaser>
          <Teaser icon={<HeartHandshake className="h-5 w-5" />} title="For organizers" to="/organizers">Run your own room with chips or diamonds for your community, with clear rules and collateral.</Teaser>
        </div>
      </SiteSection>

      <SiteSection className="py-16">
        <Card className="felt felt-vignette grid gap-8 overflow-hidden p-8 sm:p-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <Eyebrow>Responsible play</Eyebrow>
            <h2 className="font-serif text-4xl leading-tight">Play for fun. Stay in control.</h2>
            <p className="mt-4 max-w-[560px] text-[17px] text-ink/80">
              PreFlop is for adults only. Set limits, take a break or self-exclude from your profile at any time. Free chips can be reset whenever you like and never turn into money.
            </p>
            <Link to="/responsible-gaming" className={cx(cta, 'mt-6 bg-ink text-bg hover:bg-white')}>Our approach <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </div>
          <ul className="space-y-3 self-center text-[15px]">
            {['18+ only', 'Limits and time-outs in your profile', 'Self-exclusion that cannot be shortened', 'Free chips have no cash value'].map((x) => (
              <li key={x} className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-accent" aria-hidden /> {x}</li>
            ))}
          </ul>
        </Card>
      </SiteSection>
    </>
  );
}
