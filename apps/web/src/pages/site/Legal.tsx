import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Eyebrow, SiteSection } from '../../components/site/SiteLayout.tsx';
import { Notice } from '../../components/ui.tsx';
import { usePageMeta } from '../../lib/site.ts';

function LegalPage({ eyebrow, title, updated, children, draft = true, meta }: { eyebrow: string; title: string; updated: string; children: ReactNode; draft?: boolean; meta: [string, string] }) {
  usePageMeta(meta[0], meta[1]);
  return (
    <SiteSection className="max-w-[820px] pb-10 pt-12">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="font-serif text-5xl leading-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted">Last updated {updated}</p>
      {draft && (
        <Notice tone="warn" className="mt-6">
          <strong>Draft for review by counsel.</strong> This text is a placeholder that describes how PreFlop intends to work. It is not yet a binding legal document.
        </Notice>
      )}
      <div className="prose-legal mt-8 space-y-6 text-[16px] leading-relaxed text-ink/85 [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
        {children}
      </div>
    </SiteSection>
  );
}

export function ResponsiblePage() {
  return (
    <LegalPage eyebrow="Responsible play" title="Play for fun. Stay in control." updated="3 October 2026" draft={false}
      meta={['Responsible play', 'PreFlop responsible play: 18+ age gate, territory rules, session limits with reality checks, deposit and loss limits, self-exclusion, and free chips with no cash value.']}>
      <p>PreFlop is entertainment for adults. Predicting a flop should be a few minutes of fun around a poker table, never a way to make money or to chase losses.</p>
      <h2>Our commitments</h2>
      <ul>
        <li><strong>18+ only.</strong> Registration asks for your date of birth and refuses anyone under 18. A recorded age under 18 also refuses every bet.</li>
        <li><strong>Free chips have no cash value.</strong> They can be reset at any time and can never be cashed out. Organizer chips and diamonds cannot be cashed out on PreFlop either.</li>
        <li><strong>Real money is switched off.</strong> It would only ever be offered where licensed, through licensed operators, with identity checks.</li>
        <li>Every price is published and calculated from all 22,100 possible flops, so you always know your real chances.</li>
        <li>Betting on a flop closes before any card of that hand is dealt. There is no auto-replay and no countdown pressure.</li>
        <li>Promotions never use pressure wording such as “last chance”.</li>
      </ul>
      <h2>Tools in your profile</h2>
      <ul>
        <li><strong>Session limit:</strong> choose how many minutes a session lasts. When it is reached, bets stop until you sign in again, so you stop and decide.</li>
        <li><strong>Reality checks:</strong> a regular reminder (at your session limit, or every 60 minutes) showing your time played and your net result for the session, with <em>Continue</em> or <em>Take a break</em>.</li>
        <li><strong>Deposit and loss limits:</strong> daily limits for real-money play, wherever it is available. Lowering a limit applies at once; raising one waits 24 hours.</li>
        <li><strong>Self-exclusion:</strong> from 24 hours to a year. It cannot be shortened once it starts, and you are left out of leaderboards while it lasts.</li>
        <li><strong>Reset:</strong> reset your free chips whenever you like.</li>
      </ul>
      <h2>Where PreFlop is available</h2>
      <p>Registration asks for your country. Some countries are blocked entirely and cannot register or play. Real-money play, if it is ever enabled, would be accepted only from countries where it is licensed. Free chips work from any country that is not blocked.</p>
      <h2>Signs to take a break</h2>
      <ul>
        <li>Playing longer or with more than you planned.</li>
        <li>Trying to win back what you lost.</li>
        <li>Feeling anxious, irritable or secretive about play.</li>
        <li>Play getting in the way of work, sleep, money or the people around you.</li>
      </ul>
      <h2>Get support</h2>
      <p>If gambling is causing you or someone close to you harm, talk to a free, confidential support service in your country, such as GamCare or Gamblers Anonymous. You can set limits or self-exclude from your <Link to="/app/profile" className="text-accent underline">profile</Link> at any time.</p>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage eyebrow="Legal" title="Terms of use" updated="2 October 2026" meta={['Terms of use', 'The terms of use of the PreFlop website and app (draft for review by counsel).']}>
      <h2>1. Who we are</h2>
      <p>PreFlop operates a platform where players predict the three community cards (“the flop”) dealt at participating poker tables. These terms govern your use of the PreFlop website and app.</p>
      <h2>2. Eligibility</h2>
      <p>You must be at least 18 years old and allowed to use services like PreFlop where you live. Real-money play, where offered, is limited to licensed territories and requires identity verification.</p>
      <h2>3. Play modes</h2>
      <ul>
        <li><strong>Free chips</strong> are for entertainment only, have no cash value and cannot be exchanged, transferred or cashed out.</li>
        <li><strong>Virtual chips and diamonds</strong> are closed-loop currencies issued for rooms run by organizers. They cannot be cashed out on PreFlop.</li>
        <li><strong>Real money</strong> modes are switched off and are only offered where PreFlop or a partner holds the required licence.</li>
      </ul>
      <h2>4. Predictions</h2>
      <p>A prediction is accepted at the odds shown when it is placed. If the price changed, it is rejected unless you accept the new price. Betting closes before the hand is dealt. Rounds that cannot be verified are void and every stake is refunded in full.</p>
      <h2>5. Simulated tables</h2>
      <p>While physical-table play is switched off, tables are simulated and marked “Simulated table” and “Demo stream”.</p>
      <h2>6. Fair use</h2>
      <p>No automated play, collusion, multiple accounts or use of inside information. We may suspend accounts and void affected predictions.</p>
      <h2>7. Changes and contact</h2>
      <p>We may update these terms and will tell you about material changes. Questions can be sent through support in the app.</p>
    </LegalPage>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage eyebrow="Legal" title="Privacy notice" updated="3 October 2026" meta={['Privacy notice', 'How PreFlop collects and uses personal data (draft for review by counsel).']}>
      <p>This draft describes the personal data the PreFlop service collects today and why. Items marked <em>to be confirmed</em> are open for counsel and will be completed before this notice is final.</p>
      <h2>Who is responsible</h2>
      <p>The data controller, its registered address and the contact for data-protection requests are <em>to be confirmed</em>. Until then, privacy questions can be sent through support in the app.</p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account details (required to register):</strong> your email address, a display name, your date of birth, your country of residence and your password, which we store only as a salted hash.</li>
        <li><strong>Email verification and password resets:</strong> the address each link was sent to, when it was sent and whether it was used. To check a link we keep only a hash of it. The full link is also in the email waiting to be sent: it is kept only until that email is sent, expires, is replaced by a newer one or fails for good, and is then deleted (we keep the date, subject and outcome of the email).</li>
        <li><strong>Sign-in and sessions:</strong> when each session starts and expires and how long you have played in it (for session limits and reality checks), and failed sign-in attempts with the email address and IP address they came from (to stop password guessing).</li>
        <li><strong>Two-factor authentication:</strong> if you turn it on, the secret your authenticator app uses. It is required for PreFlop team accounts.</li>
        <li><strong>Play activity:</strong> your predictions, balances, ledger entries, rooms and tournaments you joined, favorites, and leaderboard results.</li>
        <li><strong>Responsible-play settings:</strong> your limits, self-exclusion and when they change.</li>
        <li><strong>Identity documents:</strong> only if you choose real-money play where it is available. Real money is switched off today.</li>
        <li><strong>Technical data:</strong> your IP address and basic request details, used for security, rate limiting and fraud prevention.</li>
      </ul>
      <h2>Why we use it</h2>
      <ul>
        <li><strong>To run your account and the game:</strong> sign-in, balances, settling predictions and showing your history.</li>
        <li><strong>Age and territory checks:</strong> your date of birth keeps PreFlop 18+ only, and your country decides whether you may register and which play modes are open to you.</li>
        <li><strong>Security:</strong> email verification, two-factor authentication, sign-in protection and an audit trail of account and money events.</li>
        <li><strong>Responsible play:</strong> session limits, reality checks, limits and self-exclusion.</li>
        <li><strong>Legal obligations:</strong> including anti-money-laundering and identity checks wherever real money applies.</li>
      </ul>
      <p>The legal basis for each purpose (for example contract, legal obligation or legitimate interest) is <em>to be confirmed</em>. We do not sell personal data.</p>
      <h2>Who can see it</h2>
      <ul>
        <li>Your display name and results appear on leaderboards and tournament standings you take part in. Your email, date of birth and country are never shown to other players.</li>
        <li>If you play in an organizer’s or club’s room, that organizer sees the transfers and bets made in its room.</li>
        <li>Service providers that host the service and send our emails process data on our behalf. Their names and locations are <em>to be confirmed</em>.</li>
      </ul>
      <h2>How long we keep it</h2>
      <p>Retention periods are <em>to be confirmed</em>: account data while your account is open and for <em>[period to be confirmed]</em> after it closes; play, ledger and audit records for <em>[period to be confirmed]</em>, as legal and audit obligations require; failed sign-in attempts and expired links for <em>[period to be confirmed]</em>.</p>
      <h2>What we never stream</h2>
      <p>Table cameras show the dealer, the shuffler, the cards and the flop. Players at the table are never shown on the stream.</p>
      <h2>Storage on your device</h2>
      <p>The app keeps your session token and preferences such as favorite bets and clubs in your browser’s local storage. A prediction you have confirmed but whose result has not yet reached the app is kept in session storage until it is confirmed, so it is never placed twice. Partner widgets keep their token only for the browser session.</p>
      <h2>Your rights</h2>
      <p>Depending on where you live, you can ask to access, correct, export or delete your data, or object to processing, and you can complain to your data-protection authority. Some records must be kept for legal and audit reasons. How to send a request is <em>to be confirmed</em>; until then, use support in the app.</p>
    </LegalPage>
  );
}
