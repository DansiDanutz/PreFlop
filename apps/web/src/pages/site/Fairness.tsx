import { Card } from '@preflop/ui';
import {
  Activity, Archive, BadgeCheck, ClipboardCheck, FileSignature, Fingerprint, Hand, KeyRound, Link2, Lock, ScanEye, ShieldCheck, Shuffle, Sigma, Tablet, Undo2,
} from 'lucide-react';
import { Link } from 'react-router';
import { Checklist, CtaBand, Faq, Feature, FeatureSection, PageHero, SectionHead, Split, StatusNote, TrustBand } from '../../components/site/blocks.tsx';
import { SiteSection } from '../../components/site/SiteLayout.tsx';
import { usePageMeta } from '../../lib/site.ts';

const CHAIN: { who: string; what: string }[] = [
  { who: 'Dealer', what: 'Presses Start hand. Bets on this flop close before any deck order exists.' },
  { who: 'PreFlop', what: 'Sends a single-use shuffle command to the Trusted Shuffler.' },
  { who: 'Trusted Shuffler', what: 'Shuffles one fresh deck for that command and signs its completion.' },
  { who: 'PreFlop', what: 'Draws a random cut depth and shows it on the dealer tablet.' },
  { who: 'Dealer', what: 'Cuts, confirms with press-and-hold, and deals the hand and the flop.' },
  { who: 'Table Box', what: 'Signs a hash-chained capture of the board, with the image hash.' },
  { who: 'Dealer and floor', what: 'Each enter the flop on their own signed tablet.' },
  { who: 'PreFlop', what: 'Verifies signature, chain, timing and image, then settles only on a three-way match.' },
];

function EvidenceChain() {
  return (
    <SiteSection id="evidence" className="scroll-mt-24 py-14">
      <SectionHead eyebrow="The evidence chain" title="From deck to settlement, every step is signed.">
        <p>The flop capture is what pays every bet, so the whole chain is treated with the same care as money. Any missing, out-of-order or unsigned step voids the round and refunds every bet.</p>
      </SectionHead>
      <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CHAIN.map((s, i) => (
          <li key={i}>
            <Card className="h-full p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-accent/60 text-sm font-semibold text-accent" aria-hidden>{i + 1}</span>
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{s.who}</span>
              </div>
              <p className="mt-3 text-[15px] text-ink/90">{s.what}</p>
            </Card>
          </li>
        ))}
      </ol>
    </SiteSection>
  );
}

export function FairnessPage() {
  usePageMeta('Fairness & security', 'How PreFlop keeps the game fair: exact odds over all 22,100 flops, a signed evidence chain, the PreFlop Trusted Shuffler, signed dealer tablets, PreFlop review of real-money rounds and audits.');
  return (
    <>
      <PageHero eyebrow="Fairness & security" title="Fair by construction. Checked every round." cards={['As', 'Kd', '2c']}
        primary={{ to: '#odds', label: 'How odds are made' }} secondary={{ to: '#evidence', label: 'The evidence chain' }}>
        <p>Every price is exact, every result is backed by signed evidence, and every round that cannot be verified is void. Here is how it works, including what is still being certified.</p>
      </PageHero>

      <SiteSection className="pb-4"><StatusNote>Physical-table play is switched off in every mode. An external audit in October 2026 showed that a random cut cannot protect against a shuffler that controls the deck order, so PreFlop runs on simulated tables until the Trusted Shuffler and outcome monitoring described below are in place and certified.</StatusNote></SiteSection>

      <Split id="odds" eyebrow="Exact odds" title="Counted, not estimated." side={
        <Checklist items={[
          'A flop is three cards from 52: exactly 22,100 possible flops.',
          'For each selection, PreFlop counts the flops that win. That count is the true probability.',
          'The price is that probability with a small, published margin.',
          'The rule that prices a selection is the same rule that settles it.',
          'Every count is checked again by an independent closed-form calculation in the test suite.',
        ]} />
      }>
        <p>42 markets and 250 selections, each with a written rule. Selections that win on only 4 of 22,100 flops are too rare to offer and are marked as such.</p>
        <p><Link to="/odds" className="text-accent underline underline-offset-2 hover:text-accent-strong">Browse the full odds book</Link></p>
      </Split>

      <EvidenceChain />

      <FeatureSection id="hardware" eyebrow="At the table" title="Equipment PreFlop controls">
        <Feature icon={Shuffle} title="PreFlop Trusted Shuffler">Owned by PreFlop, with no output of the deck order, signed firmware and a hardware random number generator. It shuffles one deck per hand after betting closes, and its model must be certified by an accredited gaming test laboratory.</Feature>
        <Feature icon={Fingerprint} title="Table Box">A locked-down device with a TPM-held signing key. It proves every hour that it runs approved software, and has no open incoming ports.</Feature>
        <Feature icon={Tablet} title="Signed dealer tablets">One person’s non-extractable signing key per tablet, a staff PIN lock, nothing signed while locked, and press-and-hold for every signed step. A lost tablet is revoked at once.</Feature>
        <Feature icon={ScanEye} title="Three independent readings">The board capture, the dealer’s entry and the floor’s entry. A mismatch goes to manual review and is never settled automatically.</Feature>
        <Feature icon={Activity} title="Outcome monitoring">A sequential (CUSUM) test on outcome frequencies per table, watched by the risk team. The certification standard adds an automatic pause and payout holds when it trips.</Feature>
        <Feature icon={Undo2} title="Void and refund">A round that cannot be verified, at any step, is void and every stake on it is refunded in full.</Feature>
      </FeatureSection>

      <Split id="review" eyebrow="Review and approval" title="Real money answers to PreFlop, not the club." side={
        <Checklist items={[
          <><strong className="text-ink">Per-table approval:</strong> each table must be approved by PreFlop before any real-money bet. Changing its mode, currency, kind or club clears the approval.</>,
          <><strong className="text-ink">PreFlop-only review:</strong> a real-money round in review is settled or voided by the PreFlop team; a club can never settle its own real-money round.</>,
          <><strong className="text-ink">Every decision audited:</strong> approvals, revocations and review decisions are written to the audit log.</>,
        ]} />
      }>
        <p>Real-money play is switched off today. These controls are built in so that, where it is ever licensed, the people who run a table are never the ones who decide its disputed results.</p>
      </Split>

      <FeatureSection id="audits" eyebrow="Audits" title="A record of every round" cols={3}>
        <Feature icon={FileSignature} title="Round-by-round evidence">The signed capture, the image hash, the staff entries and the procedure steps of every round, kept for reviewers.</Feature>
        <Feature icon={Archive} title="Write-once storage">Evidence images go to write-once storage, retained for at least five years or as long as a regulator requires.</Feature>
        <Feature icon={Link2} title="Hash-chained audit log">Every sensitive action is appended to a hash-chained log that is re-verified from the first entry on demand.</Feature>
        <Feature icon={ClipboardCheck} title="Certification and checks">Under the certification standard, tables are certified before go-live, checked remotely every shift and inspected by a PreFlop technician every quarter.</Feature>
        <Feature icon={BadgeCheck} title="Balanced ledger">Every movement of value is a balanced ledger entry with a unique reference, so a retry can never pay twice.</Feature>
        <Feature icon={ShieldCheck} title="Independent testing">The standard calls for an independent penetration test of the Table Box, the network and the provider API every year.</Feature>
      </FeatureSection>

      <TrustBand title="Platform security" items={[
        { icon: KeyRound, title: 'Two-factor for staff', body: 'One-time codes protect the PreFlop team console.' },
        { icon: Lock, title: 'Strict headers', body: 'Content Security Policy and HSTS on every site; no third-party scripts.' },
        { icon: Hand, title: 'No secrets in URLs', body: 'Live connections authenticate inside the connection, not in the address.' },
        { icon: Sigma, title: 'Account protection', body: 'Email verification, single-use reset links, login lockout and rate limits.' },
      ]} />

      <Faq items={[
        { q: 'Can PreFlop change a price after I bet?', a: 'No. A bet is accepted at the price shown when you place it. If the price changed in the meantime, the bet is refused unless you accept the new price.' },
        { q: 'Does the random cut make the shuffle safe?', a: 'No, and we say so. The cut makes it harder to aim at one exact card position, but it does not stop a shuffler that controls the deck order. Shuffle integrity rests on the Trusted Shuffler and outcome monitoring, which is why physical-table play stays off until they are certified.' },
        { q: 'Are the tables I see real?', a: 'Not today. Every table is a simulated table and is marked as simulated.' },
        { q: 'What happens when the readings disagree?', a: 'The round goes to manual review and is never settled automatically. A round that cannot be verified is void and every stake is refunded.' },
        { q: 'Does PreFlop ever see hole cards?', a: 'No. PreFlop never reads hole cards, and betting on a flop closes before any hole card of that hand is dealt.' },
      ]} />

      <CtaBand title="See the numbers for yourself." primary={{ to: '/odds', label: 'Open the odds book' }} secondary={{ to: '/responsible-gaming', label: 'Responsible play' }}>
        Every market, every selection and every winning-flop count is published.
      </CtaBand>
    </>
  );
}
