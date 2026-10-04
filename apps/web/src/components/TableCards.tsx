import type { TableSummary } from '@preflop/client';
import { cx } from '@preflop/ui';
import { ChevronRight, Star } from 'lucide-react';
import { Link } from 'react-router';
import { tableStatus } from '../lib/live.ts';
import { StreamView, feltLabel, feltTheme } from './StreamView.tsx';

/** Two-digit table number for the card heading: "Table 04" → "TABLE 04", otherwise the city. */
function tableCode(t: TableSummary) {
  const code = feltLabel(t.name);
  return code && !/^table\s*\d+$/i.test(t.name.trim()) ? code : t.kind === 'simulated' ? 'PRACTICE TABLE' : t.kind === 'manual' ? 'TEST TABLE' : 'LIVE TABLE';
}

/** A table in the lobby or a club: felt with the last flop, name, club, status and Take a seat. */
export function TableCard({ t, saved, onToggleSave }: { t: TableSummary; saved: boolean; onToggleSave: () => void }) {
  const st = tableStatus(t);
  // Any active table with a live feed can be joined; predictions open with each new round.
  const unavailable = t.status !== 'active' || st.label === 'Stream unavailable';
  const ready = !unavailable;
  return (
    <article className="flex w-full flex-col overflow-hidden rounded-[12px] border border-line-strong/60 bg-surface">
      <StreamView cards={t.last_flop?.cards} size="md" unavailable={unavailable} theme={feltTheme(t.club_id)} label={feltLabel(t.name)} badgeText={t.kind === 'manual' ? 'TEST TABLE' : 'SIMULATED TABLE'}
        className="h-[190px] border-b border-white/5"
        action={
          <button type="button" onClick={onToggleSave} aria-pressed={saved} aria-label={saved ? `Remove ${t.name} from saved tables` : `Save ${t.name}`}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/40 text-white/90 hover:bg-black/60">
            <Star className={cx('h-[18px] w-[18px]', saved && 'fill-accent text-accent')} strokeWidth={1.7} />
          </button>
        } />
      <div className="flex flex-1 flex-col px-[18px] pb-[18px] pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] tracking-[0.06em] text-ink/85">{tableCode(t)}</span>
          <span className={cx('inline-flex items-center gap-1.5 text-[12px]', ready ? 'text-accent' : 'text-muted')}>
            <span className={cx('h-1.5 w-1.5 rounded-full', ready ? 'bg-accent' : 'bg-faint')} />
            {ready ? 'Ready to play' : t.status === 'paused' ? 'Paused' : 'Offline'}
          </span>
        </div>
        <h3 className="mt-2.5 font-serif text-[21px] leading-tight tracking-[-0.03em]">{t.name}</h3>
        <Link to={`/app/clubs/${t.club_id}`} className="mt-2 inline-flex w-fit items-center gap-0.5 text-[14px] text-muted hover:text-ink">
          {t.club_name} <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
        <div className="mt-4 flex flex-1 items-end justify-between gap-3 border-t border-line pt-4">
          <span className="pb-0.5 text-[12px] text-ink/80">
            {t.city ?? 'Online'} <span className="mx-1 text-faint">/</span> {t.kind === 'simulated' ? 'Practice' : t.kind === 'manual' ? 'Test' : 'Live'}
          </span>
          {unavailable ? (
            <span className="pb-0.5 text-[12px] text-ink/80">Check back later</span>
          ) : (
            <Link to={`/app/table/${t.id}`}
              className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-accent px-3.5 text-[14px] font-bold text-accent-ink hover:bg-accent-strong">
              Take a seat <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

export const tableGrid = 'grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 xl:grid-cols-3 [&>li]:min-w-0';
