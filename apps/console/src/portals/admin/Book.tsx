import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Book as BookT, BookMarket } from '@preflop/client';
import { FAMILY_ORDER } from '@preflop/client';
import { cx, formatOdds } from '@preflop/ui';
import { Search } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { errorMessage, isNotAvailable, nf, pctFromProb } from '../../lib/format.ts';
import { ErrorBox, Loading, NotAvailable, PageHeader, Pills, Section, TextInput } from '../../components/ui.tsx';

const CHANNELS = ['direct', 'club', 'partner'] as const;
type Channel = (typeof CHANNELS)[number];

/** Overround of an exhaustive market: Σ 1/odds over offered selections (1.00 = fair). */
export function bookPercent(m: BookMarket): number | null {
  if (!m.exhaustive || m.selections.some((s) => !s.offered)) return null;
  return m.selections.reduce((a, s) => a + 100 / s.odds_centi, 0);
}

export function Book() {
  const qs = useQueries({ queries: CHANNELS.map((c) => ({ queryKey: ['book', c], queryFn: () => api.book(c), staleTime: 5 * 60_000 })) });
  const [family, setFamily] = useState<string>('all');
  const [text, setText] = useState('');
  const [firstOnly, setFirstOnly] = useState(false);

  const books = Object.fromEntries(CHANNELS.map((c, i) => [c, qs[i]!.data])) as Record<Channel, BookT | undefined>;
  const base = books.direct;
  const odds = useMemo(() => {
    const m = new Map<string, Partial<Record<Channel, { odds: number; offered: boolean; reason?: string }>>>();
    for (const c of CHANNELS) for (const mk of books[c]?.markets ?? []) for (const s of mk.selections) {
      const e = m.get(s.id) ?? {};
      e[c] = { odds: s.odds_centi, offered: s.offered, ...(s.reason ? { reason: s.reason } : {}) };
      m.set(s.id, e);
    }
    return m;
  }, [books.direct, books.club, books.partner]); // eslint-disable-line react-hooks/exhaustive-deps

  if (qs[0]!.isPending) return <><PageHeader eyebrow="Money" title="Odds book" /><Loading rows={8} /></>;
  if (qs[0]!.isError) return <><PageHeader eyebrow="Money" title="Odds book" />{isNotAvailable(qs[0]!.error) ? <NotAvailable what="the odds book" /> : <ErrorBox error={qs[0]!.error} />}</>;
  if (!base) return null;

  const families = ['all', ...FAMILY_ORDER.filter((f) => base.markets.some((m) => m.family === f)), ...Object.keys(base.families).filter((f) => !(FAMILY_ORDER as readonly string[]).includes(f))];
  const t = text.trim().toLowerCase();
  const markets = base.markets.filter((m) => (family === 'all' || m.family === family) && (!firstOnly || m.first_release)
    && (!t || m.name.toLowerCase().includes(t) || m.id.includes(t) || m.selections.some((s) => s.label.toLowerCase().includes(t))));
  const failed = CHANNELS.filter((_, i) => qs[i]!.isError);

  return (
    <>
      <PageHeader eyebrow="Money" title="Odds book" subtitle={`Read-only. Exact probabilities over all ${nf(base.flop_count)} flops, with each channel's prices (house edge and tier margins applied). Decimal odds include the stake.`} />
      {failed.length > 0 && <div className="mb-4"><ErrorBox error={new Error(`Could not load the ${failed.join(', ')} channel: ${errorMessage(qs[CHANNELS.indexOf(failed[0]!)]!.error)}`)} /></div>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <TextInput aria-label="Search markets" className="pl-9" placeholder="Search markets or selections" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" className="accent-[var(--color-accent)]" checked={firstOnly} onChange={(e) => setFirstOnly(e.target.checked)} />First-release markets only</label>
      </div>
      <div className="mb-5 overflow-x-auto"><Pills label="Market family" options={families} value={family} onChange={setFamily} render={(f) => f === 'all' ? 'All' : (base.families[f] ?? f).replace(/^[A-G]\.\s*/, '')} /></div>
      <div className="space-y-4">
        {markets.length === 0 && <p className="rounded-[10px] border border-dashed border-line-strong p-8 text-center text-sm text-muted">No markets match.</p>}
        {markets.map((m) => {
          const bp = bookPercent(m);
          return (
            <Section key={m.id} title={<span className="flex flex-wrap items-baseline gap-2">{m.name}{m.first_release && <span className="rounded-full bg-accent-soft px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wider text-accent">first release</span>}</span>}
              subtitle={<>{m.description} <span className="font-mono text-faint">{m.id}</span></>}
              actions={bp !== null ? <span className="text-xs text-muted">Book (direct) <span className="tabular-nums text-ink">{(bp * 100).toFixed(2)}%</span></span> : undefined}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-[0.1em] text-faint">
                      <th scope="col" className="py-2 pr-3 text-left font-semibold">Selection</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Probability</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Winning flops</th>
                      {CHANNELS.map((c) => <th key={c} scope="col" className="px-3 py-2 text-right font-semibold">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {m.selections.map((s) => {
                      const o = odds.get(s.id) ?? {};
                      return (
                        <tr key={s.id} className="border-t border-line/60 tabular-nums">
                          <td className="py-2 pr-3"><div>{s.label}</div><div className="font-mono text-[11px] text-faint">{s.id}</div></td>
                          <td className="px-3 py-2 text-right">{pctFromProb(s.probability)}</td>
                          <td className="px-3 py-2 text-right text-muted">{nf(s.wins)}</td>
                          {CHANNELS.map((c) => {
                            const v = o[c];
                            return (
                              <td key={c} className={cx('px-3 py-2 text-right', c === 'direct' && 'font-semibold')}>
                                {!v ? <span className="text-faint">—</span> : v.offered ? formatOdds(v.odds) : <span className="text-xs text-faint" title={v.reason}>not offered</span>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          );
        })}
      </div>
    </>
  );
}
