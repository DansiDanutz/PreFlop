import { Badge, Button, Card, EmptyState, cx, formatMoney, formatOdds } from '@preflop/ui';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { MiniFlop } from '../../components/MiniFlop.tsx';
import { PageHeader } from '../../components/AppShell.tsx';
import { ErrorState, Select, Skeleton, Tabs } from '../../components/ui.tsx';
import { ALL_WALLETS, activityQuery, nextCursor, walletFilters } from '../../lib/activity.ts';
import { api } from '../../lib/api.ts';
import { resolveOption } from '../../lib/bets.ts';
import { resultLine, roundLabel } from '../../lib/flop.ts';
import { qk, useBook, useWallets } from '../../lib/queries.ts';
import { balanceLabel } from '../../lib/rooms.ts';
import { groupByRound, summarizeRound } from '../../lib/rounds.ts';
import { type StatsResponse, statsBlocks } from '../../lib/stats.ts';

type Tab = 'all' | 'won' | 'lost' | 'ledger';

const STATUS: Record<string, { tone: 'accent' | 'muted' | 'warn' | 'info'; label: string }> = {
  won: { tone: 'accent', label: 'Won' },
  lost: { tone: 'muted', label: 'Lost' },
  void: { tone: 'warn', label: 'Void' },
  accepted: { tone: 'info', label: 'Open' },
};

const LEDGER_KIND: Record<string, string> = {
  'play.grant': 'Welcome free chips',
  'play.reset': 'Free chips reset',
  'bet.stake': 'Prediction placed',
  'bet.payout': 'Prediction won',
  'bet.refund': 'Refund (void round)',
  'bet.void': 'Refund (void round)',
};

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function ActivityPage() {
  const [tab, setTab] = useState<Tab>('all');
  const stats = useQuery({ queryKey: qk.stats, queryFn: (): Promise<StatsResponse> => api.myStats() });
  return (
    <div>
      <PageHeader eyebrow="Every round, in the open" title="Your activity." subtitle="A clear record of your predictions, with the locked odds and every chip movement." />
      <StatsStrip stats={stats.data} loading={stats.isLoading} />
      <Tabs className="mt-7 flex-wrap" label="Filter activity" value={tab} onChange={setTab} options={[
        { id: 'all', label: 'All rounds' }, { id: 'won', label: 'Correct' }, { id: 'lost', label: 'Not matched' }, { id: 'ledger', label: 'Ledger' },
      ]} />
      <div className="mt-5">{tab === 'ledger' ? <LedgerList /> : <BetsList filter={tab} />}</div>
    </div>
  );
}

function StatsStrip({ stats, loading }: { stats: StatsResponse | undefined; loading: boolean }) {
  if (loading) return <Skeleton className="mt-8 h-[120px]" />;
  const blocks = statsBlocks(stats);
  if (!blocks.length) return null;
  return (
    <div className="mt-8 space-y-5">
      {blocks.map((b) => (
        <section key={b.key} aria-label={`${b.title} totals`}>
          <h2 className="mb-2 text-[12px] font-bold uppercase tracking-[0.16em] text-ink/85">{b.title}</h2>
          <div className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-line-strong/60 bg-surface lg:grid-cols-4">
            {b.cells.map(({ label, value, accent }, i) => (
              <div key={label} className={cx('min-w-0 px-6 py-6', i % 2 === 1 && 'border-l border-line', i >= 2 && 'border-t border-line lg:border-t-0', i === 2 && 'lg:border-l')}>
                <div className="text-[13px] text-ink/85">{label}</div>
                <div className={cx('mt-3 break-words font-serif text-[clamp(22px,6vw,32px)] leading-none', accent && 'text-accent')}>{value}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function BetsList({ filter }: { filter: 'all' | 'won' | 'lost' }) {
  const book = useBook();
  const wallets = useWallets();
  const [walletId, setWalletId] = useState(ALL_WALLETS.id);
  const walletOptions = walletFilters(wallets.data?.wallets);
  const wallet = walletOptions.find((w) => w.id === walletId) ?? ALL_WALLETS;
  // Pages of 50, newest first: "Load more" fetches the page before the last bet shown.
  const bets = useInfiniteQuery({
    queryKey: [...qk.bets, 'activity', filter, wallet.id],
    queryFn: ({ pageParam }) => api.myBets(activityQuery(filter, wallet, pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => nextCursor(last),
    refetchInterval: 10_000,
  });
  const walletPicker = walletOptions.length > 2 && (
    <Select label="Wallet" className="mb-4 max-w-[280px]" value={wallet.id} onChange={(e) => setWalletId(e.target.value)}>
      {walletOptions.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
    </Select>
  );
  if (bets.isLoading) return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>;
  if (bets.isError) return <ErrorState title="Could not load your predictions" onRetry={() => void bets.refetch()} />;
  const all = bets.data?.pages.flatMap((p) => p.bets) ?? [];
  const groups = groupByRound(all);
  if (!groups.length) {
    return filter !== 'all' || wallet.id !== ALL_WALLETS.id ? (
      <>{walletPicker}<EmptyState title={filter === 'won' ? 'No correct predictions yet' : 'Nothing here yet'}>Your next flop could change that.</EmptyState></>
    ) : (
      <div className="flex flex-col items-center rounded-[12px] border border-dashed border-line-strong px-6 py-14 text-center">
        <span aria-hidden className="text-[34px] text-accent/70">♣</span>
        <p className="mt-3 font-serif text-[26px] tracking-[-0.03em]">Your story starts with three cards.</p>
        <p className="mt-3 max-w-[420px] text-[14px] text-ink/80">Completed rounds appear here, with your selection, the locked odds and the chip receipt.</p>
        <Link to="/app" className="mt-6 inline-flex h-11 items-center rounded-[8px] bg-accent px-5 text-[15px] font-bold text-accent-ink hover:bg-accent-strong">Find a table</Link>
      </div>
    );
  }
  const name = (id: string) => resolveOption(book.index, id)?.name ?? id;
  return (
    <>
    {walletPicker}
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2 [&>li]:min-w-0">
      {groups.map((g) => {
        // One card per round AND wallet: free chips and diamonds on one round are never added up.
        const s = summarizeRound(g.bets)!;
        return (
          <li key={`${g.roundId}|${g.walletKey}`}>
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{s.tableName}</div>
                  <div className="text-xs text-muted">{roundLabel(s.handNo)} · {when(g.bets[0]!.placed_at)}{s.flop ? ` · ${resultLine(s.flop)}` : ''}</div>
                  <div className="mt-0.5 text-xs text-ink/80">{balanceLabel(s.currency)}{s.roomId ? ' · room' : ''}</div>
                </div>
                <MiniFlop cards={s.flop} />
              </div>
              <ul className="mt-3 divide-y divide-line">
                {g.bets.map((b) => {
                  const st = STATUS[b.status] ?? { tone: 'muted' as const, label: b.status };
                  return (
                    <li key={b.bet_id} className="flex items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px]">{name(b.selection_id)}</div>
                        <div className="text-xs text-muted">{formatMoney(b.stake_minor, b.currency)} at {formatOdds(b.odds_centi)}</div>
                      </div>
                      <div className="text-right">
                        <Badge tone={st.tone} className="px-2! py-0.5!">{st.label}</Badge>
                        <div className="mt-1 text-xs">
                          {b.status === 'won' && <span className="font-semibold text-accent">+{formatMoney(b.payout_minor ?? 0, b.currency)}</span>}
                          {b.status === 'void' && <span className="text-muted">{formatMoney(b.payout_minor ?? b.stake_minor, b.currency)} refunded</span>}
                          {b.status === 'accepted' && <span className="text-muted">pays {formatMoney(b.potential_payout_minor, b.currency)}</span>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </li>
        );
      })}
    </ul>
    {bets.hasNextPage && (
      <div className="mt-5 flex justify-center">
        <Button variant="secondary" disabled={bets.isFetchingNextPage} onClick={() => void bets.fetchNextPage()}>
          {bets.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      </div>
    )}
    </>
  );
}

function LedgerList() {
  const ledger = useQuery({ queryKey: qk.ledger, queryFn: () => api.myLedger() });
  if (ledger.isLoading) return <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>;
  if (ledger.isError) return <ErrorState title="Could not load your ledger" onRetry={() => void ledger.refetch()} />;
  const entries = ledger.data?.entries ?? [];
  if (!entries.length) return <EmptyState title="No ledger entries yet" />;
  return (
    <Card className="divide-y divide-line">
      {entries.map((e, i) => {
        const amt = Number(e.amount_minor);
        return (
          <div key={`${e.ref}-${i}`} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px]">{LEDGER_KIND[e.kind] ?? e.kind}</div>
              <div className="truncate text-xs text-muted">{when(e.created_at)} · {e.ref}</div>
            </div>
            <span className={amt > 0 ? 'font-semibold text-accent' : 'font-semibold'}>{amt > 0 ? '+' : ''}{formatMoney(amt, e.currency)}</span>
          </div>
        );
      })}
    </Card>
  );
}
