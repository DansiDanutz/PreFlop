import { Badge, Card, EmptyState, Segmented, formatMoney, formatOdds } from '@preflop/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { MiniFlop } from '../../components/MiniFlop.tsx';
import { ErrorState, SerifHeading, Skeleton } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { resolveOption } from '../../lib/bets.ts';
import { resultLine, roundLabel } from '../../lib/flop.ts';
import { qk, useBook } from '../../lib/queries.ts';
import { groupByRound, summarizeRound } from '../../lib/rounds.ts';

type Tab = 'Predictions' | 'Ledger';

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
  const [tab, setTab] = useState<Tab>('Predictions');
  const stats = useQuery({ queryKey: qk.stats, queryFn: () => api.myStats() });
  return (
    <div className="space-y-5 px-5 pb-6">
      <SerifHeading>Activity</SerifHeading>
      <StatsCard stats={stats.data} loading={stats.isLoading} />
      <Segmented options={['Predictions', 'Ledger'] as const} value={tab} onChange={setTab} />
      {tab === 'Predictions' ? <BetsList /> : <LedgerList />}
    </div>
  );
}

function StatsCard({ stats, loading }: { stats: { bets: number; won: number; lost: number; staked_minor: number; returned_minor: number } | undefined; loading: boolean }) {
  if (loading) return <Skeleton className="h-[120px]" />;
  if (!stats) return null;
  const staked = Number(stats.staked_minor);
  const returned = Number(stats.returned_minor);
  const net = returned - staked;
  const settled = stats.won + stats.lost;
  return (
    <Card className="grid grid-cols-3 gap-y-4 p-5 text-center">
      <Stat label="Predictions" value={String(stats.bets)} />
      <Stat label="Won" value={String(stats.won)} />
      <Stat label="Hit rate" value={settled ? `${Math.round((stats.won / settled) * 100)}%` : '—'} />
      <Stat label="Used" value={formatMoney(staked, 'PLAY')} />
      <Stat label="Returned" value={formatMoney(returned, 'PLAY')} />
      <Stat label="Net" value={`${net > 0 ? '+' : ''}${formatMoney(net, 'PLAY')}`} accent={net > 0} />
      <p className="col-span-3 text-xs text-faint">Free chips only. No cash value.</p>
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className={accent ? 'text-lg font-semibold text-accent' : 'text-lg font-semibold'}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function BetsList() {
  const book = useBook();
  const bets = useQuery({ queryKey: qk.bets, queryFn: () => api.myBets({ limit: 100 }), refetchInterval: 10_000 });
  if (bets.isLoading) return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>;
  if (bets.isError) return <ErrorState title="Could not load your predictions" onRetry={() => void bets.refetch()} />;
  const groups = groupByRound(bets.data?.bets ?? []);
  if (!groups.length) {
    return (
      <EmptyState title="No predictions yet">
        Pick a table and predict the next flop. <Link to="/app" className="text-accent underline">Go to the lobby</Link>
      </EmptyState>
    );
  }
  const name = (id: string) => resolveOption(book.index, id)?.name ?? id;
  return (
    <ul className="space-y-3">
      {groups.map((g) => {
        const s = summarizeRound(g.bets)!;
        return (
          <li key={g.roundId}>
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{s.tableName}</div>
                  <div className="text-xs text-muted">{roundLabel(s.handNo)} · {when(g.bets[0]!.placed_at)}{s.flop ? ` · ${resultLine(s.flop)}` : ''}</div>
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
