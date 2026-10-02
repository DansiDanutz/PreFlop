import type { TableSummary } from '@preflop/client';
import { Card, CardBack, StatusDot, cx } from '@preflop/ui';
import { ChevronRight, MapPin } from 'lucide-react';
import { Link } from 'react-router';
import { roundLabel } from '../lib/flop.ts';
import { openHandNo, tableStatus } from '../lib/live.ts';
import { StreamView } from './StreamView.tsx';

export const PRACTICE_TABLES = ['green-room', 'midnight-room'] as const;

const linkBtn = 'inline-flex h-9 items-center justify-center gap-1 whitespace-nowrap rounded-[12px] px-3.5 text-sm font-semibold transition-colors';

/** Lobby table card (concept "Clubs & tables", screen 1). */
export function TableCard({ t }: { t: TableSummary }) {
  const st = tableStatus(t);
  const unavailable = st.label === 'Stream unavailable';
  return (
    <Card className="flex gap-3.5 p-3">
      <StreamView cards={t.last_flop?.cards} size="sm" cardScale={0.74} unavailable={unavailable} className="min-h-[112px] w-[128px] shrink-0 self-stretch rounded-[12px]" />
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="truncate text-[17px] font-semibold leading-tight">{t.name}</h3>
        <p className="mt-0.5 truncate text-[13px] text-muted">Organized by {t.club_name}</p>
        <p className="mt-1 flex items-center gap-1 text-[13px] text-muted">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{t.city ?? 'Online'}{t.kind === 'simulated' ? ' · Simulated table' : ''}</span>
        </p>
        <div className="mt-1 whitespace-nowrap"><StatusDot tone={st.tone} label={<span className="text-[13px]">{st.label}</span>} /></div>
        <div className="mt-auto flex justify-end pt-2">
          <Link to={`/app/table/${t.id}`}
            className={cx(linkBtn, st.open ? 'bg-accent text-accent-ink hover:bg-accent-strong' : 'border border-line-strong text-ink hover:border-accent hover:text-accent')}>
            {st.open ? 'Open table' : 'View table'} <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </Card>
  );
}

/** Large "Choose your table" card (concept 01, screen 1) — The Green Room. */
export function FeaturedTableCard({ t, copy }: { t: TableSummary; copy: string }) {
  const st = tableStatus(t);
  const hand = openHandNo(t);
  return (
    <Card className="overflow-hidden">
      <div className="felt felt-vignette relative h-[150px]">
        <span aria-hidden className="pf-watermark absolute bottom-2 left-1/2 -translate-x-1/2 text-[40px]">PreFlop</span>
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <CardBack size="md" className="-mr-6 -rotate-[14deg] translate-y-2" />
          <CardBack size="md" className="z-10" />
          <CardBack size="md" className="-ml-6 rotate-[14deg] translate-y-2" />
        </div>
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-serif text-[26px] leading-tight">{t.name}</h3>
            <p className="text-sm text-muted">Simulated table</p>
          </div>
          <span className="pt-1 text-right text-[13px] text-muted">{st.open && hand ? roundLabel(hand) : st.label}</span>
        </div>
        <p className="mt-3 text-[15px] text-ink/90">{copy}</p>
        <Link to={`/app/table/${t.id}`} className="mt-4 flex h-14 items-center justify-center gap-1 rounded-[14px] bg-accent text-lg font-semibold text-accent-ink hover:bg-accent-strong">
          Play <ChevronRight className="h-5 w-5" aria-hidden />
        </Link>
      </div>
    </Card>
  );
}

/** Compact practice card (concept 01, screen 1) — Midnight Room. */
export function CompactTableCard({ t, title, copy }: { t: TableSummary; title: string; copy: string }) {
  const st = tableStatus(t);
  return (
    <Link to={`/app/table/${t.id}`} className="block rounded-[18px] focus-visible:outline-2">
      <Card className="flex items-center gap-4 p-4 hover:border-line-strong">
        <div className="felt relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[12px]" aria-hidden>
          <CardBack size="sm" className="h-12 w-8 -rotate-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-xl leading-tight">{t.name}</h3>
          <p className="truncate text-[13px] text-muted">{title}</p>
          <p className="mt-0.5 truncate text-sm text-ink/80">{copy}</p>
          <div className="mt-1"><StatusDot tone={st.tone} label={<span className="text-[12px]">{st.label}</span>} /></div>
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line-strong text-ink" aria-hidden>
          <ChevronRight className="h-5 w-5" />
        </span>
      </Card>
    </Link>
  );
}
