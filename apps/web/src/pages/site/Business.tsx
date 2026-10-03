import { Card } from '@preflop/ui';
import {
  Activity, BadgeCheck, Camera, Code2, Cpu, Eye, FileCheck2, Fingerprint, Gauge, Gem, KeyRound, LayoutPanelTop, Lock, Palette, Radio, Repeat, Scale,
  ScrollText, Shield, ShieldCheck, Shuffle, Swords, Tablet, Trophy, Users, Wallet, Webhook, Wifi, Coins, Megaphone, DoorOpen,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ApplicationForm } from '../../components/site/ApplicationForm.tsx';
import { Checklist, Faq, Feature, FeatureSection, PageHero, SectionHead, Split, StatusNote, Steps, TrustBand } from '../../components/site/blocks.tsx';
import { SiteSection } from '../../components/site/SiteLayout.tsx';
import { usePageMeta } from '../../lib/site.ts';

function Apply({ children }: { children: ReactNode }) {
  return <SiteSection id="apply" className="scroll-mt-24 py-14">{children}</SiteSection>;
}

function Code({ children, label }: { children: string; label: string }) {
  return (
    <figure>
      <figcaption className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</figcaption>
      <pre className="overflow-x-auto rounded-[10px] border border-line bg-bg p-4 font-mono text-[12.5px] leading-relaxed text-ink/90"><code>{children}</code></pre>
    </figure>
  );
}

// ======================================================================= clubs

export function ForClubsPage() {
  usePageMeta('For poker clubs', 'Bring your poker tables to PreFlop: certification requirements, the PreFlop Table Box and Trusted Shuffler, signed dealer tablets, a measured revenue share and the onboarding steps.');
  return (
    <>
      <PageHero eyebrow="For poker clubs" title="Every hand you deal becomes a market." cards={['Qs', 'Qd', '4c']}
        primary={{ to: '#apply', label: 'Apply as a club' }} secondary={{ to: '#requirements', label: 'See the requirements' }}>
        <p>PreFlop players predict the flop at your tables while your games run as usual. You keep dealing; PreFlop handles pricing, risk, settlement and the evidence behind every result.</p>
        <p>Your club earns a share measured from what your tables produce and the players you bring.</p>
      </PageHero>

      <SiteSection className="pb-4"><StatusNote>Physical-table play is switched off today: PreFlop runs on simulated tables while the certification standard and the PreFlop Trusted Shuffler are completed. Clubs can apply now; no table goes live until PreFlop enables it.</StatusNote></SiteSection>

      <Steps title="Onboarding, step by step" steps={[
        { title: 'Apply', body: 'Tell us about your club, city and tables. The PreFlop team reviews every application.' },
        { title: 'Agree and set up', body: 'Your organization and owner account are created, with a single-use link to take ownership of the club portal.' },
        { title: 'Install and certify', body: 'PreFlop ships the Table Box and the Trusted Shuffler; cameras are installed, the connection is tested and dealers are trained.' },
        { title: 'Go live when enabled', body: 'A certified table opens rounds only when PreFlop enables physical play. Real money needs a licence and PreFlop’s approval of each table.' },
      ]} />

      <FeatureSection id="requirements" eyebrow="Requirements" title="What a certified table needs">
        <Feature icon={Shuffle} title="PreFlop Trusted Shuffler">Owned by PreFlop and paired with the table. It shuffles one deck per hand after betting closes, on a single-use command, and signs its completion. A signal typed in by staff never counts.</Feature>
        <Feature icon={Scale} title="A random cut every hand">PreFlop picks the cut depth after betting closes; the dealer cuts and confirms on the tablet. The order is enforced: shuffle, lock, cut, deal.</Feature>
        <Feature icon={Radio} title="Mandatory live stream">Betting only opens while the table is on air. Viewers see the dealer, the shuffler, the cards and the flop, and never the players.</Feature>
        <Feature icon={Wifi} title="Stable internet with a backup">At least 20 Mbps upload per table, round trip up to 150 ms, jitter up to 30 ms, loss up to 1%, video delay up to 3 s, and an automatic 4G/5G or second-line failover.</Feature>
        <Feature icon={Camera} title="Approved cameras">A board camera overhead, a dealer camera and a shuffler camera. The flop must be clear and hole cards must never be visible.</Feature>
        <Feature icon={Users} title="Trained dealers">Correct Start hand, cut and flop entry, signed off for each dealer. Dealers rotate and staff never bet.</Feature>
      </FeatureSection>

      <FeatureSection id="hardware" eyebrow="Table Box and hardware" title="The machine that connects your table to PreFlop" intro={<p>PreFlop owns, configures and ships the Table Box. The club never has administrator access, so the evidence it signs can be trusted by everyone.</p>}>
        <Feature icon={Cpu} title="Locked-down device">TPM 2.0, Secure Boot, a read-only signed system, disk encryption and an intrusion switch. USB, Wi-Fi and Bluetooth are disabled.</Feature>
        <Feature icon={Lock} title="Outgoing-only connection">No open incoming ports and no remote desktop. It talks to PreFlop over mutual TLS and proves at every boot and every hour that it runs approved software.</Feature>
        <Feature icon={Fingerprint} title="Signed, chained captures">Every flop capture is signed by a key that never leaves the TPM and chained to the one before. Images go to write-once storage.</Feature>
        <Feature icon={Eye} title="Privacy masks before encoding">Every seat area is blacked out on the device, so pictures of players never leave the table. A bumped camera switches the stream to the board only.</Feature>
        <Feature icon={Tablet} title="Signed staff tablets">Each dealer and floor tablet holds one person’s signing key. It locks with a staff PIN, signs nothing while locked, and every signed step is press-and-hold.</Feature>
        <Feature icon={ShieldCheck} title="Sealed shuffler">Ports sealed with numbered tamper-evident seals checked every shift, a locked enclosure and quarterly inspections by a PreFlop technician.</Feature>
      </FeatureSection>

      <Split id="certification" eyebrow="Certification" title="Nine checks before a round opens." side={
        <Checklist items={[
          'Shuffler paired with the Table Box', 'Connection test passed (30 minutes)', 'Cameras approved', 'Dealers trained',
          'Shuffler seals verified this shift', 'Board camera calibrated this shift', 'Table Box attested', 'UPS ready', 'Privacy masks verified',
        ]} />
      }>
        <p>Each item records who confirmed it and when. Per-shift items expire after 12 hours. A table with any item missing, or a link that is not healthy, cannot open a round.</p>
        <p>Certification is reviewed every six months and after any equipment change.</p>
      </Split>

      <Split id="revenue" eyebrow="Revenue share" title="Paid for what your tables produce." side={
        <Checklist items={[
          <><strong className="text-ink">Content:</strong> the hands your tables deal, on a progressive ladder with no cliffs.</>,
          <><strong className="text-ink">Distribution:</strong> the active players you bring who play in the period.</>,
          'Fixed-odds shares are a share of gross gaming revenue (stakes minus payouts); pool shares are a share of rake.',
          'A losing month pays no share, and the loss carries forward to the next period.',
          'Statements every period, computed from the ledger and never edited by hand.',
        ]} />
      }>
        <p>Shares are not a fixed percentage. Each period your share is calculated from measured contribution, so a club that deals more hands and brings more players earns a larger share.</p>
        <p>Rates and tiers are set out in your agreement. Revenue share applies to modes with a value: free-chip play produces no revenue for anyone.</p>
      </Split>

      <TrustBand items={[
        { icon: FileCheck2, title: 'Three-way match', body: 'A flop settles only when the signed capture matches both the dealer’s and the floor’s entries.' },
        { icon: Activity, title: 'Live monitoring', body: 'Heartbeat and link checks every second; a degraded table opens no new round.' },
        { icon: Shield, title: 'Void, never guess', body: 'A round that cannot be verified is void and every stake is refunded.' },
        { icon: BadgeCheck, title: 'PreFlop review', body: 'Real-money rounds that need a review are decided by PreFlop, never by the club.' },
      ]} />

      <Faq items={[
        { q: 'Can my tables go live today?', a: 'No. Physical-table play is switched off in every mode while the certification standard and the Trusted Shuffler are completed. You can apply and prepare now.' },
        { q: 'Who owns the equipment?', a: 'PreFlop owns and configures the Table Box and the Trusted Shuffler. Cameras, network and tablets are installed to the PreFlop standard and registered to the table.' },
        { q: 'Are my players filmed?', a: 'No. Cameras frame the dealer zone, the shuffler and the board only, and every seat area is masked on the Table Box before the video is encoded.' },
        { q: 'What if a tablet is lost?', a: 'Revoke its credential in the club portal; every later request signed with that key is refused at once. Then enroll a replacement tablet with a new key and PIN.' },
        { q: 'How is our share calculated?', a: 'From measured contribution each period: hands dealt and active players, on the ladders in your agreement, as a share of gross gaming revenue. Statements come straight from the ledger.' },
      ]} />

      <Apply>
        <ApplicationForm kind="club" title="Apply as a poker club" nameLabel="Club name" extra={[
          { key: 'city', label: 'City', required: true },
          { key: 'country', label: 'Country', required: true },
          { key: 'tables', label: 'Number of tables', type: 'number' },
          { key: 'website', label: 'Website', type: 'url', placeholder: 'https://' },
        ]} />
      </Apply>
    </>
  );
}

// ======================================================================= partners

const WIDGET = `<iframe
  src="https://<preflop-web>/embed/table/<table-id>?accent=%23ff8800&markets=hand-class,colour&stakes=10,50,200#token=<PLAYER_SESSION_TOKEN>"
  title="PreFlop" style="width:100%;max-width:440px;height:820px;border:0"></iframe>`;

const SIGNATURE = `X-PreFlop-Signature: t=<unix>, v1=<hex>
v1 = HMAC-SHA256(webhook_secret, "<t>.<raw body>")`;

export function ForPartnersPage() {
  usePageMeta('For betting partners', 'Integrate PreFlop flop markets with the Partner API, an embeddable widget you can customize, signed webhooks and idempotent deposits. For licensed operators.');
  return (
    <>
      <PageHero eyebrow="For betting partners" title="A live market your players have never seen." cards={['9h', 'Th', 'Jh']}
        primary={{ to: '#apply', label: 'Apply as a partner' }} secondary={{ to: '#api', label: 'Explore the API' }}>
        <p>Offer flop predictions inside your product: fast rounds, exact probabilities and a clean integration, either server to server or with a drop-in widget.</p>
      </PageHero>

      <SiteSection className="pb-4"><StatusNote>Partners are licensed operators: you verify your players’ age, identity and location. Today integrations run with free chips on simulated tables; real-money play is switched off and would only be offered where licensed.</StatusNote></SiteSection>

      <Steps title="Going live with PreFlop" steps={[
        { title: 'Apply', body: 'Tell us where you are licensed and how you would like to integrate.' },
        { title: 'Get credentials', body: 'Create API clients in the partner portal. Each secret is shown once; revoking a client also ends its players’ sessions.' },
        { title: 'Integrate', body: 'Create players and sessions, credit deposits and place bets through the API, or embed the widget.' },
        { title: 'Subscribe to webhooks', body: 'Receive signed round and bet events and reconcile against statements in the portal.' },
      ]} />

      <FeatureSection id="api" eyebrow="Partner API" title="Server to server, built to be retried safely">
        <Feature icon={KeyRound} title="Client credentials">Exchange your client id and secret for a one-hour bearer token. Token requests are rate-limited per IP.</Feature>
        <Feature icon={Users} title="Players and sessions">Create a player with your own reference, then a session token for the widget. A recorded date of birth under 18 is refused.</Feature>
        <Feature icon={Repeat} title="Idempotent deposits">Every deposit carries an Idempotency-Key. A retry returns the original answer and never credits twice; the same key with a different request is refused.</Feature>
        <Feature icon={Code2} title="Bets on your channel">Place and list bets on the partner channel, also with idempotency keys, at the prices of the published book.</Feature>
        <Feature icon={Scale} title="Exact pricing">Every price comes from all 22,100 flops, with a published margin per channel.</Feature>
        <Feature icon={Gauge} title="Risk controls">Per-round exposure limits, a per-player payout cap, an outcome monitor and automatic voids when a table cannot be verified.</Feature>
      </FeatureSection>

      <SiteSection id="widget" className="grid scroll-mt-24 grid-cols-1 gap-8 py-14 lg:grid-cols-2 lg:items-start">
        <SectionHead eyebrow="Embeddable widget" title="Your colours, your markets, your stakes.">
          <p>Embed the table screen in an iframe with your player’s session. No website chrome, mobile-first, and set up from the Widget page of the partner portal.</p>
          <Checklist items={[
            <><strong className="text-ink">Accent colour</strong>: any hex colour; hover shades and a readable text colour are derived for you.</>,
            <><strong className="text-ink">Markets</strong>: show every market or only the ones you pick.</>,
            <><strong className="text-ink">Stakes</strong>: up to five stake buttons.</>,
            <><strong className="text-ink">Table</strong>: the table the widget opens on.</>,
            'Every option is validated; anything invalid falls back to the default.',
            'The session travels in the URL fragment, never sent to a server, and stays only for the browser session.',
          ]} />
        </SectionHead>
        <Card className="min-w-0 p-5 sm:p-6"><Code label="Widget snippet">{WIDGET}</Code></Card>
      </SiteSection>

      <SiteSection id="webhooks" className="grid scroll-mt-24 grid-cols-1 gap-8 py-14 lg:grid-cols-2 lg:items-start">
        <SectionHead eyebrow="Webhooks" title="Events you can trust and replay.">
          <Checklist items={[
            'round.voided goes to every subscribed partner; bet.settled and bet.voided to the partner whose player bet.',
            'Each delivery is written in the same transaction as the settlement or void, so no event is lost.',
            'Signed with HMAC-SHA256 over the timestamp and the raw body.',
            'Failed deliveries retry with exponential backoff for 24 hours; deduplicate by event_id.',
            'A delivery log and a test button in the partner portal.',
          ]} />
        </SectionHead>
        <Card className="min-w-0 p-5 sm:p-6"><Code label="Signature header">{SIGNATURE}</Code></Card>
      </SiteSection>

      <TrustBand title="Security from the first request" items={[
        { icon: Lock, title: 'No secrets in URLs', body: 'Live updates authenticate inside the connection; widget sessions use the URL fragment.' },
        { icon: Shield, title: 'Strict headers', body: 'Content Security Policy, HSTS and no third-party scripts on every PreFlop site.' },
        { icon: Wallet, title: 'Balanced ledger', body: 'Every movement of value is a balanced, idempotent ledger entry.' },
        { icon: Webhook, title: 'Suspension controls', body: 'A suspended partner’s tokens stop at once and its players’ sessions end.' },
      ]} />

      <Faq items={[
        { q: 'Who is responsible for KYC and age checks?', a: 'You are: as the licensed operator, you verify your players’ age, identity and location. PreFlop still refuses a recorded age under 18 and blocked countries.' },
        { q: 'Can we offer real money today?', a: 'No. Real-money play is switched off. It would only be offered where licensed, after PreFlop approves each table for real money.' },
        { q: 'What happens if we retry a deposit?', a: 'With the same Idempotency-Key, you get the original response and the player is never credited twice. Reusing a key for a different request is refused.' },
        { q: 'Can we style the widget?', a: 'Yes: accent colour, visible markets, stake buttons and the default table, all from the partner portal, which gives you the snippet to paste.' },
      ]} />

      <Apply>
        <ApplicationForm kind="partner" title="Apply as a partner" nameLabel="Company name" extra={[
          { key: 'licences', label: 'Licensed jurisdictions', required: true, placeholder: 'e.g. MT' },
          { key: 'website', label: 'Website', type: 'url', placeholder: 'https://' },
          { key: 'monthly_players', label: 'Monthly active players', type: 'number' },
          { key: 'integration', label: 'Preferred integration', placeholder: 'API, widget or both' },
        ]} />
      </Apply>
    </>
  );
}

// ======================================================================= organizers

function ChipsVsDiamonds() {
  const rows: [string, string, string][] = [
    ['How players get it', 'Bought from PreFlop, or transferred to them by their club or organizer', 'Transferred to them by the organizer, who buys packs from PreFlop'],
    ['Fees', 'The organizer sets a margin or rake within PreFlop’s limits', 'A fixed 1 ◆ PreFlop fee per bet, plus the organizer’s rake'],
    ['Who is the house', 'PreFlop, the organizer or a player pool', 'The organizer or a player pool'],
    ['Cash out', 'Never on PreFlop: no cash value', 'Never on PreFlop: no cash value'],
  ];
  return (
    <SiteSection id="currencies" className="scroll-mt-24 py-14">
      <SectionHead eyebrow="Chips or diamonds" title="Two closed-loop currencies.">
        <p>Each room runs in one currency, with its own wallets. Balances never move between modes, and neither currency is ever cashed out on PreFlop.</p>
      </SectionHead>
      <Card className="mt-8 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-[15px]">
            <caption className="sr-only">Chips compared with diamonds</caption>
            <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
              <tr><th scope="col" className="px-5 py-3 font-medium"> </th><th scope="col" className="px-5 py-3 font-medium"><Coins className="mr-1.5 inline h-4 w-4 text-accent" aria-hidden />Chips</th><th scope="col" className="px-5 py-3 font-medium"><Gem className="mr-1.5 inline h-4 w-4 text-accent" aria-hidden />Diamonds</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(([k, a, b]) => <tr key={k}><th scope="row" className="px-5 py-3.5 font-semibold text-ink">{k}</th><td className="px-5 py-3.5 text-muted">{a}</td><td className="px-5 py-3.5 text-muted">{b}</td></tr>)}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-4 text-sm text-muted">Purchased currencies that cannot be cashed out are treated as social gaming in many territories, but not all. Check local rules for each territory before you launch.</p>
    </SiteSection>
  );
}

export function ForOrganizersPage() {
  usePageMeta('For organizers', 'Run PreFlop rooms for your community in chips or diamonds, with tournaments, leaderboards and promotions. Chips and diamonds have no cash value and are never cashed out on PreFlop.');
  return (
    <>
      <PageHero eyebrow="For organizers" title="Your room. Your community. Your rules." cards={['Ac', 'Ad', '7s']}
        primary={{ to: '#apply', label: 'Apply as an organizer' }} secondary={{ to: '#currencies', label: 'Chips or diamonds?' }}>
        <p>Clubs, communities, streamers and brands can run their own PreFlop rooms on the live tables, in chips or diamonds, inside PreFlop’s guard rails.</p>
      </PageHero>

      <Steps title="From application to your first room" steps={[
        { title: 'Apply', body: 'Tell us about your community, where it plays and which currency suits it.' },
        { title: 'Open a room', body: 'Choose a table, public or invite-only. Players join with a code.' },
        { title: 'Fund your economy', body: 'Buy chips or diamond packs from PreFlop and transfer them to your players. Every transfer is in the ledger.' },
        { title: 'Grow it', body: 'Run tournaments, leaderboards and promotions. PreFlop reviews each promotion before players see it.' },
      ]} />

      <ChipsVsDiamonds />

      <FeatureSection id="features" eyebrow="What you get" title="Tools for running a room">
        <Feature icon={DoorOpen} title="Rooms">Public or invite-only rooms on a table you choose, with their own book: set your margin or run a player pool with a rake, within global limits.</Feature>
        <Feature icon={Lock} title="Collateral">When your room is the house, your collateral must cover the worst case of every open round before a bet is accepted.</Feature>
        <Feature icon={Gauge} title="Dilution tracker">Diamonds bought, in circulation and sunk in fees, your rake, the house result and how many bets your remaining stock supports.</Feature>
        <Feature icon={Swords} title="Tournaments">Chip and diamond tournaments in your closed loop: same stack and same bets for everyone, ranked by stack then fewer bets used.</Feature>
        <Feature icon={Trophy} title="Leaderboards">Rank players at your tables or rooms, with prize pools funded from your treasury and paid out automatically.</Feature>
        <Feature icon={Megaphone} title="Promotions">Drops of chips or diamonds within a budget, and announcements. No pressure wording, no countdowns.</Feature>
      </FeatureSection>

      <TrustBand title="Inside PreFlop’s guard rails" items={[
        { icon: Gem, title: 'No cash value', body: 'Chips and diamonds are never cashed out on PreFlop.' },
        { icon: ScrollText, title: 'Every transfer recorded', body: 'Transfers to players are ledger entries with limits per sender.' },
        { icon: Palette, title: 'Reviewed promotions', body: 'PreFlop approves organizer promotions before they go live.' },
        { icon: LayoutPanelTop, title: 'Same fair book', body: 'Room prices start from the exact odds of all 22,100 flops.' },
      ]} />

      <Faq items={[
        { q: 'Can players cash out chips or diamonds?', a: 'No. Chips and diamonds are closed-loop currencies with no cash value. They are never cashed out on PreFlop.' },
        { q: 'What does PreFlop charge on diamonds?', a: 'A fixed fee of 1 ◆ on every diamond bet, which leaves your economy, plus the rake you set for your room within global limits.' },
        { q: 'Can I run a free-chip room?', a: 'Free-chip play belongs to PreFlop’s own lobby. Organizer rooms run in chips or diamonds.' },
        { q: 'Do I need legal advice?', a: 'Yes. Currencies that cannot be cashed out are treated as social gaming in many territories, but not all. Check the rules for each territory before launching.' },
      ]} />

      <Apply>
        <ApplicationForm kind="organizer" title="Apply as an organizer" nameLabel="Organization or community" extra={[
          { key: 'community', label: 'Where is your community?', placeholder: 'Discord, club, stream…' },
          { key: 'expected_players', label: 'Expected players', type: 'number' },
          { key: 'currency', label: 'Chips or diamonds?', placeholder: 'Diamonds' },
          { key: 'country', label: 'Country' },
        ]} />
      </Apply>
    </>
  );
}
