import { Card } from '@preflop/ui';
import { CalendarCheck, Eye, GitBranch, Link2, Scale, ShieldCheck, UserCheck, Users } from 'lucide-react';
import { Checklist, CtaBand, Faq, Feature, FeatureSection, PageHero, SectionHead, StatusNote, Steps, TrustBand } from '../../components/site/blocks.tsx';
import { SiteSection } from '../../components/site/SiteLayout.tsx';
import { useToken } from '../../lib/auth.tsx';
import { usePageMeta } from '../../lib/site.ts';

function Levels() {
  return (
    <SiteSection id="levels" className="grid scroll-mt-24 grid-cols-1 gap-8 py-14 lg:grid-cols-2 lg:items-start">
      <SectionHead eyebrow="Two levels, no more" title="How commission is calculated.">
        <p>Commission is a share of <strong className="text-ink">net gaming revenue (NGR)</strong>: settled stakes, minus payouts, minus the value of promotions claimed, per month and currency.</p>
        <p>Only modes with cash value count. Free chips, chips and diamonds never earn commission.</p>
      </SectionHead>
      <div className="grid gap-4">
        <Card className="p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Level 1</div>
          <h3 className="mt-2 font-serif text-2xl">Players you refer</h3>
          <p className="mt-2 text-[15px] text-muted">A rate on the NGR of the players who registered with your code, capped at 40%. A negative month carries forward against the next one.</p>
        </Card>
        <Card className="p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Level 2</div>
          <h3 className="mt-2 font-serif text-2xl">Agents you recruit</h3>
          <p className="mt-2 text-[15px] text-muted">A rate on the NGR of the players referred by agents you recruited, capped at 10%. Commission never reaches a third level.</p>
        </Card>
        <p className="text-sm text-muted">Each agent’s rates are set by the PreFlop team at approval, within these caps. Commission depends entirely on the activity of the players referred; there is no guaranteed income.</p>
      </div>
    </SiteSection>
  );
}

export function AgentsPage() {
  usePageMeta('Agents', 'The PreFlop agent programme: a two-level referral programme on net gaming revenue, for licensed real-money markets only. Apply from your profile.');
  const token = useToken();
  const apply = token ? { to: '/app/profile', label: 'Apply from your profile' } : { to: '/register', label: 'Create an account to apply' };
  return (
    <>
      <PageHero eyebrow="Agent programme" title="Refer players. Build a network." cards={['5s', '6s', '7s']}
        primary={apply} secondary={{ to: '#levels', label: 'How commission works' }}>
        <p>Agents introduce players to PreFlop with a personal referral link, and can recruit other agents. The programme pays on two levels, on net gaming revenue.</p>
      </PageHero>

      <SiteSection className="pb-4">
        <StatusNote>The agent programme applies only to licensed real-money markets in the future. Real-money play is switched off today, so no commission is earned or paid; statements are computed in a sandbox only.</StatusNote>
      </SiteSection>

      <Steps title="Becoming an agent" steps={[
        { title: 'Sign in', body: 'Create a PreFlop account or sign in. You must be 18 or over.' },
        { title: 'Apply', body: <>Open <strong className="text-ink">Profile → Become an agent</strong> and send your application, with an optional note.</> },
        { title: 'Get approved', body: 'The PreFlop team reviews each application and sets your rates. A rejected application can be sent again.' },
        { title: 'Share your link', body: 'Players who register through your link are bound to you for good. Your statements appear in the agent portal.' },
      ]} />

      <Levels />

      <FeatureSection eyebrow="Programme rules" title="Clear, auditable and capped">
        <Feature icon={Link2} title="Referral link">A player who registers through your link is bound to you permanently. Unknown or inactive codes are ignored, so registration never fails because of a code.</Feature>
        <Feature icon={GitBranch} title="Two levels only">An agent may have one parent, who must be a top-level agent. The structure is locked so a third level can never form.</Feature>
        <Feature icon={CalendarCheck} title="Monthly statements">Months close in order, once, after they end. Statements go from draft to approved to paid, and are never edited by hand.</Feature>
        <Feature icon={UserCheck} title="Four eyes">Nobody decides on their own agent account or approves their own statements.</Feature>
        <Feature icon={Scale} title="Carry-forward">A negative level-1 month is carried into the next, so commission is only paid on net revenue over time.</Feature>
        <Feature icon={Eye} title="Agent portal">Your referral link, your players, your sub-agents and every monthly statement in one place.</Feature>
      </FeatureSection>

      <TrustBand title="Responsible by design" items={[
        { icon: ShieldCheck, title: 'Licensed markets only', body: 'Commission exists only where real-money play is licensed.' },
        { icon: Users, title: 'Players come first', body: 'Self-excluded and suspended players are excluded everywhere.' },
        { icon: Scale, title: 'No income promises', body: 'Earnings depend on referred activity; nothing is guaranteed.' },
        { icon: UserCheck, title: 'Approved agents', body: 'Every agent is approved by the PreFlop team and can be suspended.' },
      ]} />

      <Faq items={[
        { q: 'Can I earn commission today?', a: 'No. Commission is only on real-money net gaming revenue, and real-money play is switched off. The programme will only apply in licensed real-money markets.' },
        { q: 'Do free chips, chips or diamonds count?', a: 'No. Only modes with cash value count towards NGR. Free chips, organizer chips and diamonds never earn commission.' },
        { q: 'What rates will I get?', a: 'The PreFlop team sets your rates when it approves you: up to 40% of NGR at level 1 and up to 10% at level 2.' },
        { q: 'What does an agent need to promote responsibly?', a: 'Promote PreFlop to adults only, never promise winnings or income, and point players to the responsible-play tools.' },
      ]} />

      <CtaBand title="Interested in the programme?" primary={apply} secondary={{ to: '/responsible-gaming', label: 'Responsible play' }}>
        <Checklist className="mt-2" items={['Apply from Profile → Become an agent', 'Approval and rates set by the PreFlop team', 'Licensed real-money markets only, in the future']} />
      </CtaBand>
    </>
  );
}
