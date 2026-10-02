import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Eyebrow, SiteSection } from '../../components/site/SiteLayout.tsx';
import { Notice } from '../../components/ui.tsx';

function LegalPage({ eyebrow, title, updated, children, draft = true }: { eyebrow: string; title: string; updated: string; children: ReactNode; draft?: boolean }) {
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
    <LegalPage eyebrow="Responsible play" title="Play for fun. Stay in control." updated="2 October 2026" draft={false}>
      <p>PreFlop is entertainment for adults. Predicting a flop should be a few minutes of fun around a real poker table, never a way to make money or to chase losses.</p>
      <h2>Our commitments</h2>
      <ul>
        <li>18+ only. Accounts that appear to belong to minors are closed.</li>
        <li><strong>Free chips have no cash value.</strong> They can be reset at any time and can never be cashed out. Virtual chips and diamonds cannot be cashed out on PreFlop either.</li>
        <li>Every price is published and calculated from all 22,100 possible flops, so you always know your real chances.</li>
        <li>Betting on a flop closes before any card of that hand is dealt.</li>
      </ul>
      <h2>Tools in your profile</h2>
      <ul>
        <li><strong>Limits:</strong> daily loss and deposit limits, and a session reminder. Lowering a limit applies at once; raising one waits 24 hours.</li>
        <li><strong>Self-exclusion:</strong> from 24 hours to a year. It cannot be shortened once it starts.</li>
        <li><strong>Reset:</strong> reset your free chips whenever you like.</li>
      </ul>
      <h2>Signs to take a break</h2>
      <ul>
        <li>Playing longer or with more than you planned.</li>
        <li>Trying to win back what you lost.</li>
        <li>Feeling anxious, irritable or secretive about play.</li>
      </ul>
      <h2>Get support</h2>
      <p>If gambling is causing you or someone close to you harm, talk to a free, confidential support service in your country, such as GambleAware (UK), BeGambleAware or Gamblers Anonymous. You can self-exclude from your <Link to="/app/profile" className="text-accent underline">profile</Link> at any time.</p>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage eyebrow="Legal" title="Terms of use" updated="2 October 2026">
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
    <LegalPage eyebrow="Legal" title="Privacy notice" updated="2 October 2026">
      <h2>What we collect</h2>
      <ul>
        <li>Account details: display name, email, an optional country and a hashed password.</li>
        <li>Activity: predictions, balances and ledger entries needed to run the game and audit it.</li>
        <li>Identity documents only if you choose real-money play where it is available.</li>
        <li>Technical data such as device type and IP address for security and fraud prevention.</li>
      </ul>
      <h2>What we never stream</h2>
      <p>Table cameras show the dealer, the shuffler, the cards and the flop. Players at the table are never shown on the stream.</p>
      <h2>How we use it</h2>
      <p>To provide the service, keep it secure, meet legal obligations (including anti-money-laundering rules where real money applies) and support responsible play. We do not sell personal data.</p>
      <h2>Storage on your device</h2>
      <p>The app keeps your session token and preferences such as favorite bets and clubs in your browser’s local storage. Partner widgets keep their token only for the browser session.</p>
      <h2>Your rights</h2>
      <p>Depending on where you live, you can ask to access, correct, export or delete your data, or object to processing. Some records must be kept for legal and audit reasons.</p>
    </LegalPage>
  );
}
