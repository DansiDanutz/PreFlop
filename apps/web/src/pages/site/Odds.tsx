import { Badge, Card, EmptyState, cx, formatOdds } from '@preflop/ui';
import { useMemo, useState } from 'react';
import { Eyebrow, SiteSection } from '../../components/site/SiteLayout.tsx';
import { ErrorState, Pill, SearchField, Skeleton } from '../../components/ui.tsx';
import { useBook } from '../../lib/queries.ts';

/** /odds — the full odds book from GET /v1/book. */
export function OddsPage() {
  const book = useBook();
  const [family, setFamily] = useState<string>('all');
  const [q, setQ] = useState('');
  const families = book.data ? Object.entries(book.data.families) : [];

  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (book.data?.markets ?? [])
      .filter((m) => family === 'all' || m.family === family)
      .flatMap((m) => m.selections.map((s) => ({ m, s })))
      .filter(({ m, s }) => words.every((w) => `${m.name} ${s.label} ${s.id}`.toLowerCase().includes(w)));
  }, [book.data, family, q]);

  return (
    <SiteSection className="pb-10 pt-12">
      <Eyebrow>Odds book</Eyebrow>
      <h1 className="font-serif text-5xl leading-tight sm:text-6xl">Every market, every price.</h1>
      <p className="mt-4 max-w-[760px] text-[17px] text-muted">
        Probabilities are exact: each one counts the winning flops among all {book.data ? book.data.flop_count.toLocaleString('en-US') : '22,100'} possible flops.
        Odds are decimal and include your stake. A few selections are too rare to offer and are marked as such.
      </p>

      <div className="mt-8 space-y-4">
        <div className="max-w-[520px]"><SearchField value={q} onChange={setQ} placeholder="Search markets or selections" label="Search the odds book" /></div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Market family">
          <Pill active={family === 'all'} onClick={() => setFamily('all')}>All markets</Pill>
          {families.map(([id, name]) => (
            <Pill key={id} active={family === id} onClick={() => setFamily(id)}>{name.replace(/^[A-G]\.\s*/, '')}</Pill>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {book.isLoading && <Skeleton className="h-[480px]" />}
        {book.isError && <ErrorState title="Could not load the odds book" onRetry={() => void book.refetch()} />}
        {book.data && rows.length === 0 && <EmptyState title="Nothing matches">Try another search or market family.</EmptyState>}
        {book.data && rows.length > 0 && (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <caption className="sr-only">PreFlop odds book, {rows.length} selections</caption>
                <thead className="sticky top-0 border-b border-line bg-surface text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">Market</th>
                    <th scope="col" className="px-3 py-3 font-medium">Selection</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">Winning flops</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">Probability</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Odds</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map(({ m, s }, i) => {
                    const firstOfMarket = i === 0 || rows[i - 1]!.m.id !== m.id;
                    return (
                      <tr key={s.id} className={cx(firstOfMarket && i > 0 && 'border-t-2 border-t-line-strong')}>
                        <td className="px-5 py-3 align-top">
                          {firstOfMarket ? (
                            <div>
                              <div className="font-medium text-ink">{m.name}</div>
                              {m.first_release && <Badge tone="accent" className="mt-1 px-2! py-0! text-[10px]!">First release</Badge>}
                            </div>
                          ) : <span className="sr-only">{m.name}</span>}
                        </td>
                        <td className="px-3 py-3">{s.label}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-muted">{s.wins.toLocaleString('en-US')}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{(s.probability * 100).toFixed(s.probability < 0.01 ? 3 : 2)}%</td>
                        <td className={cx('px-5 py-3 text-right font-semibold tabular-nums', s.offered ? 'text-accent' : 'text-faint')}>
                          {s.offered ? formatOdds(s.odds_centi) : 'Not offered'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        {book.data && <p className="mt-3 text-xs text-muted">{rows.length} selections shown · channel “{book.data.channel}”. Organizer rooms may set their own margin within PreFlop’s rules.</p>}
      </div>
    </SiteSection>
  );
}
