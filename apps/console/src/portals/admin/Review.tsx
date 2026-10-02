import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Ban, Info, Tablet } from 'lucide-react';
import { Button, Card, Flop, cx } from '@preflop/ui';
import { api } from '../../lib/api.ts';
import { fmtDateTime, pad3, relTime } from '../../lib/format.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { Callout, ConfirmDialog, KeyVal, PageHeader, QueryView, Section, useAction } from '../../components/ui.tsx';
import { FlopText, RoundStateBadge } from '../../components/domain.tsx';

const FLOOR_NOTE = 'Settling a review is done by a floor manager on the club tablet, with a floor_manager credential belonging to someone who did not submit either entry. The PreFlop team can only void.';

export function ReviewQueue() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['admin', 'review'], queryFn: api.adminReviewQueue, refetchInterval: 10_000 });
  return (
    <>
      <PageHeader eyebrow="Integrity" title="Review queue" subtitle="Rounds whose signed capture disagrees with the dealer or floor entry. They are never settled automatically." />
      <div className="mb-4"><Callout tone="info" icon={<Tablet size={16} />} title="Who settles a review">{FLOOR_NOTE}</Callout></div>
      <Section>
        <QueryView q={q} what="the review queue">
          {(d) => (
            <DataTable rows={d.rounds} rowKey={(r) => r.id} onRowClick={(r) => nav(`/admin/review/${encodeURIComponent(r.id)}`)} caption="Rounds in review"
              empty="The review queue is empty. Every recent capture matched both entries."
              initialSort={{ key: 'locked', dir: 'asc' }}
              columns={[
                { key: 'table', header: 'Table', sort: (r) => r.table_name, cell: (r) => <span className="font-medium">{r.table_name}</span> },
                { key: 'hand', header: 'Hand', sort: (r) => r.hand_no, cell: (r) => `#${pad3(r.hand_no)}` },
                { key: 'state', header: 'State', sort: (r) => r.state, cell: (r) => <RoundStateBadge state={r.state} /> },
                { key: 'reasons', header: 'Reasons', cell: (r) => <span className="text-xs text-muted">{r.review_reasons?.join(' · ') || '—'}</span> },
                { key: 'locked', header: 'Locked', sort: (r) => r.locked_at, cell: (r) => <span title={fmtDateTime(r.locked_at)}>{relTime(r.locked_at)}</span> },
                { key: 'mode', header: 'Mode', sort: (r) => r.mode, cell: (r) => <span className="text-xs text-muted">{r.mode}</span> },
              ]} />
          )}
        </QueryView>
      </Section>
    </>
  );
}

export function ReviewDetail() {
  const { roundId = '' } = useParams();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['admin', 'evidence', roundId], queryFn: () => api.adminEvidence(roundId) });
  const [voiding, setVoiding] = useState(false);
  const voidRound = useAction((reason: string) => api.adminVoidRound(roundId, reason), {
    invalidate: [['admin', 'review'], ['admin', 'evidence', roundId]],
    success: 'Round voided. Every accepted bet is refunded.',
    onSuccess: () => { setVoiding(false); nav('/admin/review'); },
  });

  return (
    <>
      <Link to="/admin/review" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={14} aria-hidden />Review queue</Link>
      <QueryView q={q} what="round evidence">
        {(ev) => {
          const r = ev.round;
          const terminal = r.state === 'SETTLED' || r.state === 'VOID';
          const captureCards = Array.isArray(ev.capture?.cards) ? (ev.capture.cards as string[]) : null;
          return (
            <>
              <PageHeader eyebrow="Evidence" title={<>Hand #{pad3(r.hand_no)} <span className="align-middle"><RoundStateBadge state={r.state} /></span></>}
                subtitle={<span className="font-mono">{r.id}</span>}
                actions={<Button variant="danger" size="sm" disabled={terminal} onClick={() => setVoiding(true)}><Ban size={14} aria-hidden />Void round</Button>} />
              <div className="mb-6"><Callout tone="info" icon={<Info size={16} />} title="Admins can only void">{FLOOR_NOTE}</Callout></div>
              {r.review_reasons?.length ? <div className="mb-6"><Callout tone="warn" title="Review reasons">{r.review_reasons.join(' · ')}</Callout></div> : null}

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                <Section title="Evidence image" subtitle="Board camera C1, stored only if its SHA-256 matches the signed capture.">
                  {ev.image_data_url
                    ? <img src={ev.image_data_url} alt={`Board capture for hand ${r.hand_no}`} className="w-full rounded-[12px] border border-line" />
                    : <div className="grid aspect-video place-items-center rounded-[12px] border border-dashed border-line-strong text-sm text-muted">No verified image uploaded</div>}
                </Section>
                <div className="space-y-4">
                  <Section title="Three-way match">
                    <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                      <Card className="bg-surface-2 p-3">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Signed capture</div>
                        <Flop cards={captureCards} size="sm" className="justify-start !gap-1.5" />
                      </Card>
                      {(['dealer', 'floor'] as const).map((src) => {
                        const e = ev.entries.find((x) => x.source === src);
                        const differs = !!(e && captureCards && e.cards.join() !== captureCards.join());
                        return (
                          <Card key={src} className={cx('bg-surface-2 p-3', differs && 'border-warn/60')}>
                            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-faint"><span>{src} entry</span>{differs && <span className="text-warn">differs</span>}</div>
                            {e ? <><Flop cards={e.cards} size="sm" className="justify-start !gap-1.5" /><div className="mt-2 text-xs text-muted">by <span className="font-mono">{e.person_id}</span></div></> : <div className="py-4 text-sm text-faint">Not entered</div>}
                          </Card>
                        );
                      })}
                    </div>
                    {ev.entries.filter((e) => e.source !== 'dealer' && e.source !== 'floor').map((e, i) => (
                      <div key={i} className="mt-2 text-xs text-muted">{e.source}: <FlopText cards={e.cards} /> by {e.person_id}</div>
                    ))}
                  </Section>
                  <Section title="Round">
                    <KeyVal items={[
                      ['Table', <span className="font-mono">{r.table_id}</span>], ['Mode', `${r.mode} · ${r.currency}`], ['Step', <span className="font-mono">{r.step}</span>],
                      ['Opened', fmtDateTime(r.opened_at)], ['Locked', fmtDateTime(r.locked_at)], ['Settled', fmtDateTime(r.settled_at)],
                      ['Voided', r.voided_at ? `${fmtDateTime(r.voided_at)} — ${r.void_reason ?? ''}` : '—'],
                    ]} />
                  </Section>
                </div>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <Section title="Procedure events" subtitle="Server-assigned ordinals; any gap or out-of-order step voids the hand.">
                  {ev.events.length === 0 ? <p className="text-sm text-muted">No procedure events recorded.</p> : (
                    <ol className="relative space-y-3 border-l border-line pl-5">
                      {ev.events.map((e) => (
                        <li key={e.ord} className="relative">
                          <span className="absolute -left-[27px] top-0.5 grid h-5 w-5 place-items-center rounded-full bg-surface-3 text-[10px] font-semibold ring-1 ring-line-strong">{e.ord}</span>
                          <div className="font-mono text-sm">{e.step}</div>
                          <div className="text-xs text-muted">{fmtDateTime(e.at)}</div>
                        </li>
                      ))}
                    </ol>
                  )}
                </Section>
                <Section title="Capture record" subtitle="As signed by the Table Box (Ed25519).">
                  {ev.capture ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-[12px] border border-line bg-bg p-4 font-mono text-[12px] leading-relaxed">{JSON.stringify(ev.capture, null, 2)}</pre> : <p className="text-sm text-muted">No authentic capture.</p>}
                </Section>
              </div>

              <ConfirmDialog open={voiding} onClose={() => setVoiding(false)} busy={voidRound.isPending} title={`Void hand #${pad3(r.hand_no)}?`} confirmLabel="Void and refund"
                reason={{ label: 'Void reason (audited)', placeholder: 'e.g. capture unreadable, entries irreconcilable', min: 5 }} typePhrase="VOID"
                onConfirm={(reason) => voidRound.mutate(reason)}>
                Every accepted bet on this flop is refunded. This cannot be undone. If the evidence supports a result, ask the club's floor manager to settle it on the tablet instead.
              </ConfirmDialog>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
