import type { NewsCard as NewsCardData } from '@preflop/client';
import { Card, cx } from '@preflop/ui';
import { ArrowRight, Check, ChevronDown, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { newsDate, tagLabel } from '../../lib/site.ts';
import { StreamView } from '../StreamView.tsx';
import { Eyebrow, SiteSection } from './SiteLayout.tsx';

/** Building blocks shared by every public page: hero, feature grid, steps, FAQ, call to action. */

export const cta = 'inline-flex h-12 items-center justify-center gap-2 rounded-[14px] px-6 text-[15px] font-semibold transition-colors';
export const ctaPrimary = cx(cta, 'bg-accent text-accent-ink hover:bg-accent-strong');
export const ctaSecondary = cx(cta, 'border border-line-strong text-ink hover:border-accent hover:text-accent');

export interface Action { to: string; label: string; external?: boolean }

function ActionLink({ a, primary }: { a: Action; primary: boolean }) {
  const cls = primary ? ctaPrimary : ctaSecondary;
  const inner = <>{a.label}{primary && <ArrowRight className="h-4 w-4" aria-hidden />}</>;
  if (a.external || a.to.startsWith('#') || a.to.startsWith('mailto:')) return <a href={a.to} className={cls}>{inner}</a>;
  return <Link to={a.to} className={cls}>{inner}</Link>;
}

export function PageHero({ eyebrow, title, children, primary, secondary, cards, aside, note }: {
  eyebrow: string; title: ReactNode; children: ReactNode; primary?: Action; secondary?: Action; cards?: string[]; aside?: ReactNode; note?: ReactNode;
}) {
  return (
    <SiteSection className="grid items-center gap-10 pb-12 pt-10 sm:pt-14 lg:grid-cols-[1.15fr_1fr] lg:pt-20">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="font-serif text-[40px] leading-[1.05] tracking-tight sm:text-6xl">{title}</h1>
        <div className="mt-5 max-w-[620px] space-y-3 text-[17px] text-muted">{children}</div>
        {(primary || secondary) && (
          <div className="mt-8 flex flex-wrap gap-3">
            {primary && <ActionLink a={primary} primary />}
            {secondary && <ActionLink a={secondary} primary={false} />}
          </div>
        )}
        {note && <p className="mt-4 text-sm text-muted">{note}</p>}
      </div>
      {aside ?? (cards && <StreamView cards={cards} size="lg" className="hidden h-[320px] rounded-[18px] sm:block" badge={false} />)}
    </SiteSection>
  );
}

export function SectionHead({ eyebrow, title, children, id }: { eyebrow: string; title: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <div className="max-w-[820px]">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className="font-serif text-[32px] leading-tight sm:text-[44px]">{title}</h2>
      {children && <div className="mt-4 space-y-3 text-[17px] text-muted">{children}</div>}
    </div>
  );
}

export function Feature({ icon: I, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <Card className="h-full p-6">
      <span className="grid h-11 w-11 place-items-center rounded-[12px] border border-line text-accent"><I className="h-5 w-5" strokeWidth={1.7} aria-hidden /></span>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <div className="mt-1.5 text-[15px] text-muted">{children}</div>
    </Card>
  );
}

export function FeatureSection({ eyebrow, title, intro, children, id, cols = 3 }: { eyebrow: string; title: string; intro?: ReactNode; children: ReactNode; id?: string; cols?: 2 | 3 }) {
  const hid = id ? `${id}-title` : undefined;
  return (
    <SiteSection id={id} labelledBy={hid} className="scroll-mt-24 py-14">
      <SectionHead eyebrow={eyebrow} title={title} {...(hid ? { id: hid } : {})}>{intro}</SectionHead>
      <div className={cx('mt-8 grid gap-5 sm:grid-cols-2', cols === 3 && 'lg:grid-cols-3')}>{children}</div>
    </SiteSection>
  );
}

export function Steps({ eyebrow = 'How it works', title, steps, id }: { eyebrow?: string; title: string; steps: { title: string; body: ReactNode }[]; id?: string }) {
  return (
    <SiteSection id={id} className="scroll-mt-24 py-14">
      <SectionHead eyebrow={eyebrow} title={title} />
      <ol className={cx('mt-8 grid gap-5 sm:grid-cols-2', steps.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
        {steps.map((s, i) => (
          <li key={s.title}>
            <Card className="h-full p-6">
              <span className="grid h-10 w-10 place-items-center rounded-full border border-accent/60 font-serif text-lg text-accent" aria-hidden>{i + 1}</span>
              <h3 className="mt-4 font-serif text-2xl">{s.title}</h3>
              <div className="mt-2 text-[15px] text-muted">{s.body}</div>
            </Card>
          </li>
        ))}
      </ol>
    </SiteSection>
  );
}

export function Checklist({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={cx('space-y-2.5', className)}>
      {items.map((x, i) => <li key={i} className="flex gap-3 text-[15px]"><Check className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden /> <span>{x}</span></li>)}
    </ul>
  );
}

/** Split section: heading and text on one side, a card on the other. */
export function Split({ eyebrow, title, children, side, id }: { eyebrow: string; title: string; children: ReactNode; side: ReactNode; id?: string }) {
  return (
    <SiteSection id={id} className="grid scroll-mt-24 grid-cols-1 gap-8 py-14 lg:grid-cols-2 lg:items-start">
      <SectionHead eyebrow={eyebrow} title={title}>{children}</SectionHead>
      <Card className="p-6 sm:p-7">{side}</Card>
    </SiteSection>
  );
}

/** Trust and safety band shown on every audience page. */
export function TrustBand({ title = 'Safe by design', items }: { title?: string; items: { icon: LucideIcon; title: string; body: ReactNode }[] }) {
  return (
    <SiteSection className="py-14">
      <Card className="felt felt-vignette relative overflow-hidden p-6 sm:p-10">
        <Eyebrow>Trust and safety</Eyebrow>
        <h2 className="font-serif text-[32px] leading-tight sm:text-4xl">{title}</h2>
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(({ icon: I, title: t, body }) => (
            <li key={t}>
              <I className="h-6 w-6 text-accent" strokeWidth={1.7} aria-hidden />
              <h3 className="mt-3 font-semibold text-ink">{t}</h3>
              <p className="mt-1 text-[15px] text-ink/80">{body}</p>
            </li>
          ))}
        </ul>
      </Card>
    </SiteSection>
  );
}

export function Faq({ items, title = 'Frequently asked questions' }: { items: { q: string; a: ReactNode }[]; title?: string }) {
  return (
    <SiteSection className="py-14">
      <div className="grid gap-8 lg:grid-cols-[1fr_1.6fr]">
        <SectionHead eyebrow="FAQ" title={title} />
        <div className="divide-y divide-line rounded-[12px] border border-line-strong/60 bg-surface">
          {items.map((f) => (
            <details key={f.q} className="group px-5 py-1 sm:px-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[16px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {f.q}
                <ChevronDown className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="pb-5 text-[15px] leading-relaxed text-muted">{f.a}</div>
            </details>
          ))}
        </div>
      </div>
    </SiteSection>
  );
}

export function CtaBand({ title, children, primary, secondary }: { title: string; children: ReactNode; primary: Action; secondary?: Action }) {
  return (
    <SiteSection className="py-14">
      <Card className="grid gap-6 p-8 sm:p-12 lg:grid-cols-[1.5fr_auto] lg:items-center">
        <div>
          <h2 className="font-serif text-[32px] leading-tight sm:text-4xl">{title}</h2>
          <div className="mt-3 max-w-[640px] text-[17px] text-muted">{children}</div>
        </div>
        <div className="flex flex-wrap gap-3">
          <ActionLink a={primary} primary />
          {secondary && <ActionLink a={secondary} primary={false} />}
        </div>
      </Card>
    </SiteSection>
  );
}

/** A note that keeps the operating status in view: free to play, real money off. */
export function StatusNote({ children }: { children?: ReactNode }) {
  return (
    <p className="rounded-[12px] border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-ink/90">
      {children ?? <>Today PreFlop is free to play on simulated tables. Real-money play is switched off and would only ever be offered where licensed, through licensed operators.</>}
    </p>
  );
}

export function NewsCardView({ post, headingLevel = 'h3' }: { post: NewsCardData; headingLevel?: 'h2' | 'h3' }) {
  const H = headingLevel;
  return (
    <Link to={`/news/${post.slug}`} className="group block h-full rounded-[12px]">
      <Card className="flex h-full flex-col p-6 transition-colors group-hover:border-accent/60">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <time dateTime={post.published_at}>{newsDate(post.published_at)}</time>
          {post.tags.slice(0, 2).map((t) => <span key={t} className="rounded-full border border-line-strong px-2 py-0.5">{tagLabel(t)}</span>)}
        </div>
        <H className="mt-3 font-serif text-2xl leading-snug text-ink">{post.title}</H>
        {post.summary && <p className="mt-2 flex-1 text-[15px] text-muted">{post.summary}</p>}
        <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-accent">Read more<span className="sr-only">: {post.title}</span> <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
      </Card>
    </Link>
  );
}
