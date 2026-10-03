import { ApiProblem } from './api.ts';
import type { Evidence } from './types.ts';

/**
 * Review evidence, keyed by round id (docs/12 §6). The floor manager can switch between hands in
 * REVIEW while an evidence request is still on its way; an answer for hand A must never be shown
 * for hand B, nor let a Settle/Void for B go ahead on A's image. So every view carries the round
 * id it belongs to, a newer load aborts and ignores the older one, and a decision is only allowed
 * when the evidence on screen belongs to the selected round.
 */

export type EvidenceStatus = 'loading' | 'ok' | 'unavailable' | 'error';

export interface EvidenceView {
  /** The round this view (and its evidence) belongs to. */
  roundId: string;
  status: EvidenceStatus;
  ev: Evidence | null;
  err: string;
}

export const loadingView = (roundId: string): EvidenceView => ({ roundId, status: 'loading', ev: null, err: '' });

/**
 * Checks a 2xx evidence answer for `roundId`: it must be an object, and when it names its round
 * (`round.id`), that must be the one asked for. Throws a plain Error otherwise.
 */
export function checkEvidence(roundId: string, raw: unknown): Evidence {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The evidence answer could not be read. Retry.');
  const ev = raw as Evidence;
  const rid = ev.round?.id;
  if (rid !== undefined && rid !== roundId) throw new Error('The server sent evidence for a different hand. Retry.');
  return ev;
}

/** The view to show for `roundId`: the stored one only if it belongs to that round. */
export const viewFor = (view: EvidenceView | null, roundId: string): EvidenceView =>
  view && view.roundId === roundId ? view : loadingView(roundId);

/**
 * Whether a Settle/Void (or the camera-check confirm) may go ahead for `roundId` with this view:
 * the view must belong to that round and be finished loading, and any evidence in it must name
 * that round too. (Unavailable or failed evidence still allows a decision: the camera check then
 * asks for an explicit hold instead of an image.)
 */
export function decisionAllowed(view: EvidenceView | null, roundId: string): boolean {
  if (!view || view.roundId !== roundId || view.status === 'loading') return false;
  const rid = view.ev?.round?.id;
  return rid === undefined || rid === roundId;
}

type Fetcher = (roundId: string, signal: AbortSignal) => Promise<unknown>;

/**
 * Loads evidence for one round at a time. `load(B)` aborts an earlier `load(A)` still in flight,
 * and an answer that arrives after a newer load started (or after `dispose`) is dropped.
 */
export class EvidenceLoader {
  private seq = 0;
  private ctl: AbortController | null = null;

  constructor(private readonly fetch: Fetcher, private readonly onView: (v: EvidenceView) => void) {}

  async load(roundId: string): Promise<void> {
    this.ctl?.abort();
    const ctl = new AbortController();
    this.ctl = ctl;
    const seq = ++this.seq;
    const current = () => seq === this.seq && !ctl.signal.aborted;
    this.onView(loadingView(roundId));
    let view: EvidenceView;
    try {
      const ev = checkEvidence(roundId, await this.fetch(roundId, ctl.signal));
      view = { roundId, status: 'ok', ev, err: '' };
    } catch (e) {
      const p = e instanceof ApiProblem ? e : null;
      view = p?.status === 404
        ? { roundId, status: 'unavailable', ev: null, err: '' }
        : { roundId, status: 'error', ev: null, err: p?.message ?? (e as Error)?.message ?? String(e) };
    }
    if (!current()) return;
    if (this.ctl === ctl) this.ctl = null;
    this.onView(view);
  }

  /** Stops the current load; its answer will be ignored. */
  dispose(): void {
    this.seq++;
    this.ctl?.abort();
    this.ctl = null;
  }
}
