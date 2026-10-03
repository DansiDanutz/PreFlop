import { Badge, Card, EmptyState, cx, formatOdds } from '@preflop/ui';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Eyebrow, SiteSection } from '../../components/site/SiteLayout.tsx';
import { ErrorState, Pill, SearchField, Skeleton } from '../../components/ui.tsx';
import { useBook } from '../../lib/queries.ts';
import { usePageMeta } from '../../lib/site.ts';

const RULES: [string, string][] = [
  ['The flop', 'The first three community cards of the hand, as an unordered set. Dealing order never matters.'],
  ['Rank values', '2–10 at face value, J = 11, Q = 12, K = 13, A = 14, for thresholds, totals and parity.'],
  ['Ace in straights', 'High or low: Q-K-A and A-2-3 are straights; K-A-2 is not.'],
  ['Colour and suit', 'Colour means red (♥ ♦) or black (♠ ♣). Markets about one suit say “suit”.'],
  ['Face cards', 'J, Q and K only. The ace is not a face card.'],
  ['Below and above', 'Strict: “all below 8” means every card is 2–7. Ranges are inclusive.'],
  ['Pair', 'Exactly one pair. Trips are not a pair; “paired board” covers pair or trips.'],
  ['Totals', 'The sum of rank values, from 6 to 42.'],
];

/** /odds — the full odds book from GET /v1/book, and the rules that settle it. */
export function OddsPage() {
  usePageMeta('Markets & odds', 'The PreFlop odds book: 42 markets and 250 selections, each priced by counting the winning flops among all 22,100 possible flops, with the rule that settles it.');
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
      <Eyebrow>Markets & odds</Eyebrow>
      <h1 className="font-serif text-5xl leading-tight sm:text-6xl">Every market, every price.</h1>
      <p className="mt-4 max-w-[760px] text-[17px] text-muted">
        {book.data ? `${book.data.markets.length} markets and ${book.data.markets.reduce((a, m) => a + m.selections.length, 0)} selections` : '42 markets and 250 selections'}.
        Probabilities are exact: each one counts the winning flops among all {book.data ? book.data.flop_count.toLocaleString('en-US') : '22,100'} possible flops.
        Odds are decimal and include your stake. A few selections are too rare to offer and are marked as such.
      </p>
      <p className="mt-3 text-sm text-muted">
        The same rule prices and settles each selection. <a href="#rules" className="text-accent underline underline-offset-2 hover:text-accent-strong">Read the rules</a> · <Link to="/fairness" className="text-accent underline underline-offset-2 hover:text-accent-strong">How odds are made</Link>
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
                              {m.description && <div className="mt-0.5 max-w-[280px] text-xs text-muted">{m.description}</div>}
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

      <section id="rules" aria-labelledby="rules-title" className="mt-16 scroll-mt-24">
        <Eyebrow>Rules</Eyebrow>
        <h2 id="rules-title" className="font-serif text-4xl leading-tight">How every market is settled.</h2>
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <Card className="p-6">
            <h3 className="text-lg font-semibold">Conventions</h3>
            <dl className="mt-4 space-y-3 text-[15px]">
              {RULES.map(([k, v]) => <div key={k}><dt className="font-semibold text-ink">{k}</dt><dd className="text-muted">{v}</dd></div>)}
            </dl>
          </Card>
          <div className="space-y-5">
            <Card className="p-6">
              <h3 className="text-lg font-semibold">The betting window</h3>
              <ul className="mt-3 ml-5 list-disc space-y-1.5 text-[15px] text-muted marker:text-accent">
                <li>Opens when the flop of the previous hand has been captured.</li>
                <li>Closes when the dealer presses Start hand for the next hand, before any hole card is dealt.</li>
                <li>A bet is accepted at the price shown; if the price changed, it is refused unless you accept the new one.</li>
              </ul>
            </Card>
            <Card className="p-6">
              <h3 className="text-lg font-semibold">Void and refund</h3>
              <p className="mt-2 text-[15px] text-muted">The round is void and every stake refunded in full when, among other cases:</p>
              <ul className="mt-3 ml-5 list-disc space-y-1.5 text-[15px] text-muted marker:text-accent">
                <li>the hand ends before the flop, or a misdeal reaches the flop;</li>
                <li>a card is exposed before betting has closed;</li>
                <li>the result cannot be verified, or the table goes offline before it is;</li>
                <li>the hand’s procedure was broken (shuffle, cut or steps out of order);</li>
                <li>integrity staff void it after an investigation, with a logged reason.</li>
              </ul>
            </Card>
          </div>
        </div>
      </section>
    </SiteSection>
  );
}
