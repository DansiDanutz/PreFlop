import type { Promotion } from '@preflop/client';
import { Button, ChipIcon, EmptyState, cx } from '@preflop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Gift, Megaphone, Trophy } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/AppShell.tsx';
import { ErrorState, Notice, Skeleton } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { errorText } from '../../lib/problems.ts';
import { money } from './Leaderboards.tsx';

const until = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function KindIcon({ p }: { p: Promotion }) {
  const cls = 'grid h-11 w-11 shrink-0 place-items-center rounded-full border';
  if (p.kind === 'free-chips') return <span className={cx(cls, 'border-accent/40 bg-accent-deep')}><ChipIcon size={28} /></span>;
  if (p.kind === 'org-drop') return <span aria-hidden className={cx(cls, p.currency === 'DIAMOND' ? 'border-info/40 bg-info/10 text-info' : 'border-accent/40 bg-accent-deep text-accent')}>{p.currency === 'DIAMOND' ? '◆' : <Gift className="h-5 w-5" />}</span>;
  if (p.kind === 'leaderboard') return <span className={cx(cls, 'border-accent/40 bg-accent-deep text-accent')}><Trophy className="h-5 w-5" aria-hidden /></span>;
  return <span className={cx(cls, 'border-line-strong bg-surface-3 text-ink/85')}><Megaphone className="h-5 w-5" aria-hidden /></span>;
}

function PromoCard({ p }: { p: Promotion }) {
  const qc = useQueryClient();
  const claim = useMutation({
    mutationFn: () => api.claimPromotion(p.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['promotions'] }); void qc.invalidateQueries({ queryKey: ['me'] }); },
  });
  const claimable = p.kind === 'free-chips' || p.kind === 'org-drop';
  const claimed = p.claimed || claim.isSuccess;
  return (
    <article className="flex h-full flex-col rounded-[12px] border border-line-strong/60 bg-surface p-5">
      <div className="flex items-start gap-4">
        <KindIcon p={p} />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-muted">{p.owner_name ?? 'PreFlop'} · until {until(p.ends_at)}</div>
          <h3 className="mt-1 font-serif text-[21px] leading-tight tracking-[-0.03em]">{p.title}</h3>
        </div>
      </div>
      {p.body && <p className="mt-3 text-[14px] leading-relaxed text-ink/80">{p.body}</p>}
      <div className="min-h-4 flex-1" />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        {claimable ? (
          <>
            <span className="text-[14px] font-semibold">{money(p.amount_minor ?? 0, p.currency ?? 'PLAY')}</span>
            {claimed ? (
              <span className="inline-flex items-center gap-1.5 text-[14px] text-accent"><Check className="h-4 w-4" aria-hidden /> Claimed</span>
            ) : p.eligible === false ? (
              <span className="text-right text-[12px] text-muted">For players in {p.owner_name}’s rooms</span>
            ) : (
              <Button size="sm" disabled={claim.isPending} onClick={() => claim.mutate()}>{claim.isPending ? 'Claiming…' : 'Claim'}</Button>
            )}
          </>
        ) : p.kind === 'leaderboard' && p.leaderboard_id ? (
          <Link to={`/app/leaderboards/${p.leaderboard_id}`} className="inline-flex items-center gap-1 text-[14px] text-accent hover:underline">See the leaderboard <ChevronRight className="h-4 w-4" aria-hidden /></Link>
        ) : p.link ? (
          <a href={p.link} className="inline-flex items-center gap-1 text-[14px] text-accent hover:underline">Find out more <ChevronRight className="h-4 w-4" aria-hidden /></a>
        ) : <span />}
      </div>
      {claim.isError && <Notice tone="warn" className="mt-3">{errorText(claim.error)}</Notice>}
    </article>
  );
}

export function PromotionsPage() {
  const q = useQuery({ queryKey: ['promotions'], queryFn: () => api.promotions() });
  return (
    <div>
      <PageHeader eyebrow="On the house" title="Promotions." subtitle="Offers from PreFlop and from your clubs. Free chips and organizer chips or diamonds have no cash value." />
      <div className="mt-8 border-t border-line pt-6">
        {q.isError && <ErrorState title="Could not load promotions" onRetry={() => void q.refetch()} />}
        {q.data && q.data.promotions.length === 0 && <EmptyState title="Nothing running right now">New offers appear here. Leaderboards are always open.</EmptyState>}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2 xl:grid-cols-3 [&>li]:min-w-0">
          {q.isLoading && [0, 1, 2].map((i) => <li key={i}><Skeleton className="h-[210px]" /></li>)}
          {q.data?.promotions.map((p) => <li key={p.id}><PromoCard p={p} /></li>)}
        </ul>
      </div>
    </div>
  );
}
