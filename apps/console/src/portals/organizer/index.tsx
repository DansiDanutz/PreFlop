import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { DiamondPack } from '@preflop/client';
import { Button, Card, cx, formatMoney } from '@preflop/ui';
import { Gem } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { nf } from '../../lib/format.ts';
import { BarChart, SERIES } from '../../components/charts.tsx';
import { PeriodPicker, thisPeriod } from '../../components/statements.tsx';
import { useCanWrite, useOrgId, usePortal } from '../../components/Shell.tsx';
import { ConfirmDialog, Field, Kpi, PageHeader, QueryView, Section, Select, useAction } from '../../components/ui.tsx';

type PayWith = 'EUR' | 'USDT' | 'USDC';

export function Diamonds() {
  const portal = usePortal();
  const id = useOrgId();
  const write = useCanWrite();
  const packs = useQuery({ queryKey: ['org', id, 'packs'], queryFn: () => api.diamondPacks(id), staleTime: 5 * 60_000 });
  const [period, setPeriod] = useState(thisPeriod());
  const dil = useQuery({ queryKey: ['org', id, 'dilution', period], queryFn: () => api.orgDilution(id, period), placeholderData: keepPreviousData, refetchInterval: 30_000 });
  const [pick, setPick] = useState<DiamondPack | null>(null);
  const [payWith, setPayWith] = useState<PayWith>('EUR');
  const payments = useQuery({ queryKey: ['org', id, 'payments'], queryFn: () => api.orgPayments(id), refetchInterval: 30_000 });
  const pending = payments.data?.payments.filter((p) => p.status === 'pending') ?? [];
  const buy = useAction((x: { pack: DiamondPack; pay: PayWith }) => api.buyDiamonds(id, { diamonds: x.pack.diamonds, pay_with: x.pay }), {
    invalidate: [['org', id, 'dilution'], ['org', id, 'treasury'], ['org', id, 'payments']],
    success: (p, x) => `${nf(x.pack.diamonds)} ◆ — payment ${p.status}${p.status === 'pending' ? (p.redirect_url ? ': finish the checkout in the tab that opened' : ', credited once the provider confirms') : ''}.`,
    onSuccess: (p) => {
      setPick(null);
      // A provider with a hosted checkout continues there; the link stays in "Pending payments" too.
      if (p.redirect_url) window.open(p.redirect_url, '_blank', 'noopener');
    },
  });

  return (
    <>
      <PageHeader eyebrow={portal.name} title="Diamonds" subtitle="Buy diamond packs from PreFlop, transfer them to your players, and watch how fast your economy turns over. PreFlop's 1 ◆ fee per bet leaves your economy; you rebuy." />
      <div className="space-y-4">
        <Section title="Buy a pack" subtitle="Volume discounts apply. Sandbox: no real payment is taken."
          actions={<Field label="Pay with" className="w-32">{(p) => <Select {...p} value={payWith} onChange={(e) => setPayWith(e.target.value as PayWith)}><option value="EUR">EUR</option><option value="USDT">USDT</option><option value="USDC">USDC</option></Select>}</Field>}>
          <QueryView q={packs} what="diamond packs">
            {(d) => (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {d.packs.map((p, i) => {
                  const best = i > 0 && p.unit_price_minor < d.packs[0]!.unit_price_minor;
                  return (
                    <Card key={p.diamonds} className={cx('flex flex-col gap-3 bg-surface-2 p-5', best && 'border-accent/40')}>
                      <div className="flex items-center gap-2 text-accent"><Gem size={18} aria-hidden /><span className="text-2xl font-semibold tabular-nums text-ink">{nf(p.diamonds)}</span><span className="text-sm text-muted">◆</span></div>
                      <div className="text-xl font-semibold">{formatMoney(p.price_minor, p.currency)}</div>
                      <div className="text-xs text-muted">{p.tier}{best && <span className="ml-1 text-accent">· {Math.round((1 - p.unit_price_minor / d.packs[0]!.unit_price_minor) * 100)}% off</span>}</div>
                      <Button size="sm" variant={best ? 'primary' : 'secondary'} disabled={!write} onClick={() => setPick(p)} className="mt-auto">Buy with {payWith}</Button>
                    </Card>
                  );
                })}
              </div>
            )}
          </QueryView>
        </Section>

        {pending.length > 0 && (
          <Section title="Pending payments" subtitle="Purchases the payment provider has not confirmed yet. Diamonds land in your treasury when it does.">
            <ul className="divide-y divide-line text-sm">
              {pending.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span>{p.product === 'diamonds' ? 'Diamonds' : 'Chips'} · {formatMoney(p.amount_minor, p.currency)} · {new Date(p.created_at).toLocaleString()}</span>
                  {p.redirect_url ? <a className="text-accent underline" href={p.redirect_url} target="_blank" rel="noopener noreferrer">Continue checkout</a> : <span className="text-muted">awaiting confirmation</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section title="Dilution tracker" subtitle="Where your diamonds went this period." actions={<PeriodPicker value={period} onChange={setPeriod} />}>
          <QueryView q={dil} what="the dilution tracker">
            {(d) => (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <Kpi label="Bought" value={`${nf(d.bought)} ◆`} />
                  <Kpi label="Transferred to players" value={`${nf(d.transferred)} ◆`} />
                  <Kpi label="Sunk · PreFlop fee" value={`${nf(d.sunk_preflop_fee)} ◆`} hint="1 ◆ per bet, leaves your economy" />
                  <Kpi label="Rake collected" value={`${nf(d.rake)} ◆`} />
                  <Kpi label="House net" value={`${d.house_net > 0 ? '+' : ''}${nf(d.house_net)} ◆`} tone={d.house_net < 0 ? 'danger' : d.house_net > 0 ? 'accent' : undefined} />
                  <Kpi label="Bets until empty" value={d.bets_until_empty === null ? '—' : nf(d.bets_until_empty)} hint={d.bets_until_empty === null ? 'Needs betting activity to estimate' : 'At the current average stake'} tone={d.bets_until_empty !== null && d.bets_until_empty < 1000 ? 'warn' : undefined} />
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                  <div>
                    <div className="mb-2 text-sm text-muted">Flows this period (◆)</div>
                    <BarChart ariaLabel="Diamond flows this period" data={[
                      { label: 'Bought', value: d.bought, color: SERIES[0] },
                      { label: 'Transferred', value: d.transferred, color: SERIES[1] },
                      { label: 'PreFlop fee', value: d.sunk_preflop_fee, color: SERIES[2] },
                      { label: 'Rake', value: d.rake, color: SERIES[1] },
                      { label: 'House net', value: d.house_net, color: SERIES[0] },
                      { label: 'Circulating', value: d.circulating, color: SERIES[0] },
                    ]} format={(v) => nf(v)} />
                  </div>
                  <div className="space-y-3 rounded-[10px] border border-line bg-surface-2 p-4 text-sm">
                    <div className="font-serif text-lg">Reading the tracker</div>
                    <p className="text-muted"><strong className="text-ink">Circulating</strong> is every diamond still in your economy: your treasury, your collateral and your players' wallets.</p>
                    <p className="text-muted">Each bet burns the fixed <strong className="text-ink">1 ◆</strong> PreFlop fee. <strong className="text-ink">Bets until empty</strong> estimates how many more bets your circulating supply carries before you need to rebuy.</p>
                    {d.bought > 0 && <p className="text-muted">So far <strong className="text-ink">{((d.sunk_preflop_fee / d.bought) * 100).toFixed(2)}%</strong> of what you bought has been consumed by fees.</p>}
                  </div>
                </div>
              </div>
            )}
          </QueryView>
        </Section>
      </div>
      <ConfirmDialog open={!!pick} onClose={() => setPick(null)} danger={false} busy={buy.isPending} confirmLabel="Buy pack" title={`Buy ${pick ? nf(pick.diamonds) : ''} ◆?`}
        onConfirm={() => pick && buy.mutate({ pack: pick, pay: payWith })}>
        You pay <strong>{pick ? formatMoney(pick.price_minor, pick.currency) : ''}</strong>{payWith !== 'EUR' && <> in <strong>{payWith}</strong> at the equivalent rate</>}. Diamonds land in your treasury and can never be cashed out on PreFlop.
      </ConfirmDialog>
    </>
  );
}
