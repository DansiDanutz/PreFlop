import { BadgeCheck, CalendarClock, DoorOpen, Gift, Hourglass, LayoutGrid, ShieldCheck, Smartphone, Star, Swords, Trophy, UserX } from 'lucide-react';
import { Link } from 'react-router';
import { Checklist, CtaBand, Faq, Feature, FeatureSection, PageHero, Split, Steps, TrustBand } from '../../components/site/blocks.tsx';
import { usePageMeta } from '../../lib/site.ts';

const link = 'text-accent underline underline-offset-2 hover:text-accent-strong';

export function PlayersPage() {
  usePageMeta('For players', 'How to play PreFlop: predict the flop on live simulated tables across 42 markets, enter free-chip tournaments and leaderboards, and install the app. Free chips have no cash value. 18+.');
  return (
    <>
      <PageHero eyebrow="For players" title="Call the next three cards." cards={['Kh', 'Kd', '7c']}
        primary={{ to: '/register', label: 'Play free' }} secondary={{ to: '/odds', label: 'Browse the markets' }}
        note="18+ only. Free chips have no cash value and can never be cashed out.">
        <p>Pick a table, predict the flop, and watch it land. A pair, a rainbow, all red, a total over 30: every price is calculated from all 22,100 possible flops, so you always know your real chances.</p>
      </PageHero>

      <Steps title="From sign-up to your first flop" steps={[
        { title: 'Create a free account', body: 'Sign up with your email, date of birth and country. You must be 18 or over. You start with free chips.' },
        { title: 'Pick a table', body: 'The lobby lists every table and whether predictions are open. Today all tables are simulated and deal around the clock.' },
        { title: 'Predict and lock', body: 'Choose a selection and a stake. Odds are decimal and include your stake. Betting closes before any card of the hand is dealt.' },
        { title: 'Watch the reveal', body: 'The flop settles in seconds. If a round cannot be verified, it is void and every stake is refunded in full.' },
      ]} />

      <FeatureSection id="features" eyebrow="What you can play" title="More than one way to read a flop">
        <Feature icon={LayoutGrid} title="42 markets, 250 selections">Rank patterns, suits and colours, high and low, face cards, straights, totals and combined bets. Each one has a written rule. <Link to="/odds" className={link}>See the odds book</Link>.</Feature>
        <Feature icon={Swords} title="Tournaments">Everyone gets the same stack and the same number of bets. The biggest stack at the end wins; on the same stack, fewer bets used ranks higher. Standings update live.</Feature>
        <Feature icon={Trophy} title="Leaderboards">Daily, weekly or monthly boards ranked by net result, volume, return per chip or points. Free-chip boards pay free chips and badges only.</Feature>
        <Feature icon={Gift} title="Promotions">Occasional free-chip claims and announcements. No countdowns, no pressure and nothing with cash value.</Feature>
        <Feature icon={DoorOpen} title="Organizer rooms">Join a club or community room with an invite code and play in its chips or diamonds. They are never cashed out on PreFlop.</Feature>
        <Feature icon={Star} title="Your favourite bets">Save the selections you play most so they sit at the top of the bet slip at every table.</Feature>
      </FeatureSection>

      <Split id="free-chips" eyebrow="Free chips" title="Play for fun, never for money." side={
        <Checklist items={[
          'You start with a free-chip balance; no purchase is needed.',
          'Reset your free chips to the starting balance whenever you like.',
          <>Free chips have <strong className="text-ink">no cash value</strong>: they cannot be bought, sold, transferred or cashed out.</>,
          'Free-chip prizes are free chips and badges, never money or goods.',
        ]} />
      }>
        <p>PreFlop runs on free chips today. Real-money play is switched off, and would only ever be offered where licensed, through licensed operators.</p>
      </Split>

      <Split id="install" eyebrow="Install the app" title="PreFlop on your home screen." side={
        <div className="space-y-5 text-[15px]">
          <div>
            <h3 className="font-semibold text-ink">iPhone and iPad (Safari)</h3>
            <p className="mt-1 text-muted">Open PreFlop, tap <strong className="text-ink">Share</strong>, then <strong className="text-ink">Add to Home Screen</strong>.</p>
          </div>
          <div>
            <h3 className="font-semibold text-ink">Android and desktop (Chrome, Edge)</h3>
            <p className="mt-1 text-muted">Open PreFlop and choose <strong className="text-ink">Install app</strong> from the address bar or the browser menu.</p>
          </div>
        </div>
      }>
        <p>PreFlop is an installable web app: it opens full screen like a native app, with no app store download. It never keeps your bets or balances offline; live data always comes straight from PreFlop.</p>
        <p className="flex items-center gap-2 text-sm"><Smartphone className="h-4 w-4 text-accent" aria-hidden /> Works on phones from 360 px wide, tablets and desktops.</p>
      </Split>

      <TrustBand title="Tools that keep play in proportion" items={[
        { icon: Hourglass, title: 'Session limit', body: 'Choose how long a session lasts. Bets stop when it is reached.' },
        { icon: CalendarClock, title: 'Reality checks', body: 'Regular reminders with your time played and your result.' },
        { icon: UserX, title: 'Self-exclusion', body: 'From 24 hours to a year. It cannot be shortened once it starts.' },
        { icon: ShieldCheck, title: '18+ only', body: 'Registration checks your date of birth and country.' },
      ]} />

      <Faq items={[
        { q: 'Is PreFlop real-money betting?', a: 'No. PreFlop is free to play today. Real-money play is switched off, and would only ever be offered where licensed, through licensed operators.' },
        { q: 'Can I cash out free chips?', a: 'No. Free chips have no cash value. They cannot be bought, sold, transferred or cashed out, and you can reset them to the starting balance at any time.' },
        { q: 'Are the tables real poker tables?', a: 'Not yet. Physical-table play is switched off while clubs and equipment are certified, so every table is a simulated table, clearly marked as simulated.' },
        { q: 'When does betting close?', a: 'When the dealer starts the hand, before any card of it is dealt. A prediction is accepted at the price shown; if the price changed, you are asked to accept the new one.' },
        { q: 'What happens if something goes wrong in a round?', a: 'A round that cannot be verified is void and every stake on it is refunded in full.' },
        { q: 'How do tournaments rank players?', a: 'By the biggest stack when the clock ends. On the same stack, the player who used fewer bets ranks higher; the same stack and the same bets used is a tie.' },
        { q: 'How old do I need to be?', a: 'You must be 18 or over. Registration asks for your date of birth and refuses anyone under 18.' },
      ]} />

      <CtaBand title="Ready for the next flop?" primary={{ to: '/register', label: 'Play free' }} secondary={{ to: '/responsible-gaming', label: 'Responsible play' }}>
        <p>Free account, free chips, no cash value. Take a break whenever you like.</p>
        <p className="mt-2 flex items-center gap-2 text-sm"><BadgeCheck className="h-4 w-4 text-accent" aria-hidden /> Every price is published and calculated from all 22,100 flops.</p>
      </CtaBand>
    </>
  );
}
