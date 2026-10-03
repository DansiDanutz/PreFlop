import { describe, expect, it } from 'vitest';
import { ApiProblem } from '../src/lib/api.ts';
import { EvidenceLoader, type EvidenceView, checkEvidence, decisionAllowed, loadingView, viewFor } from '../src/lib/evidence.ts';
import type { Evidence } from '../src/lib/types.ts';

/** A fetcher whose answers are released by hand, in any order. */
function deferredFetcher() {
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void; signal: AbortSignal }>();
  const fetch = (roundId: string, signal: AbortSignal) => new Promise<unknown>((resolve, reject) => { pending.set(roundId, { resolve, reject, signal }); });
  return { fetch, pending };
}
const evidenceOf = (roundId: string, image: string): Evidence => ({ round: { id: roundId }, capture: { cards: ['As', 'Kd', '2c'] }, image_data_url: image, entries: [] });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('F06: evidence is keyed by round id', () => {
  it('A then B, B answers first and A late: A\'s evidence is never shown for B, and only B can be decided', async () => {
    const f = deferredFetcher();
    const views: EvidenceView[] = [];
    let latest: EvidenceView | null = null;
    const loader = new EvidenceLoader(f.fetch, (v) => { views.push(v); latest = v; });

    const a = loader.load('t:h1');
    const b = loader.load('t:h2'); // the manager switched to hand 2
    expect(f.pending.get('t:h1')!.signal.aborted).toBe(true); // A's request was cancelled

    f.pending.get('t:h2')!.resolve(evidenceOf('t:h2', 'data:image/png;base64,B'));
    await b;
    f.pending.get('t:h1')!.resolve(evidenceOf('t:h1', 'data:image/png;base64,A')); // late answer
    await a;
    await flush();

    // No view carrying A's evidence was ever published.
    expect(views.some((v) => v.ev?.image_data_url?.endsWith('A'))).toBe(false);
    const shown = viewFor(latest, 't:h2');
    expect(shown.roundId).toBe('t:h2');
    expect(shown.ev?.image_data_url).toBe('data:image/png;base64,B');
    expect(decisionAllowed(shown, 't:h2')).toBe(true);
    // A view for another round never allows a decision on the selected one.
    expect(decisionAllowed(shown, 't:h1')).toBe(false);
  });

  it('A late after B failed: still nothing of A, and B shows its own error', async () => {
    const f = deferredFetcher();
    let latest: EvidenceView | null = null;
    const loader = new EvidenceLoader(f.fetch, (v) => { latest = v; });
    const a = loader.load('t:h1');
    const b = loader.load('t:h2');
    f.pending.get('t:h2')!.reject(new ApiProblem(0, 'network'));
    await b;
    f.pending.get('t:h1')!.resolve(evidenceOf('t:h1', 'A'));
    await a;
    expect(latest).toMatchObject({ roundId: 't:h2', status: 'error', ev: null });
    expect(decisionAllowed(latest, 't:h2')).toBe(true); // void / no-image settle path stays open
  });

  it('an answer after dispose (panel unmounted) is ignored', async () => {
    const f = deferredFetcher();
    const views: EvidenceView[] = [];
    const loader = new EvidenceLoader(f.fetch, (v) => views.push(v));
    const a = loader.load('t:h1');
    loader.dispose();
    f.pending.get('t:h1')!.resolve(evidenceOf('t:h1', 'A'));
    await a;
    expect(views).toEqual([loadingView('t:h1')]);
  });

  it('evidence the server labels with another round is refused', async () => {
    expect(() => checkEvidence('t:h2', evidenceOf('t:h1', 'A'))).toThrow(/different hand/);
    expect(() => checkEvidence('t:h2', null)).toThrow();
    expect(() => checkEvidence('t:h2', [])).toThrow();
    expect(checkEvidence('t:h2', { image_data_url: null })).toEqual({ image_data_url: null });
    const f = deferredFetcher();
    let latest: EvidenceView | null = null;
    const loader = new EvidenceLoader(f.fetch, (v) => { latest = v; });
    const b = loader.load('t:h2');
    f.pending.get('t:h2')!.resolve(evidenceOf('t:h1', 'A'));
    await b;
    expect(latest).toMatchObject({ roundId: 't:h2', status: 'error', ev: null });
  });

  it('404 means no evidence viewer (a decision is still possible after the camera check)', async () => {
    const f = deferredFetcher();
    let latest: EvidenceView | null = null;
    const loader = new EvidenceLoader(f.fetch, (v) => { latest = v; });
    const p = loader.load('t:h3');
    f.pending.get('t:h3')!.reject(new ApiProblem(404, 'not_found'));
    await p;
    expect(latest).toMatchObject({ roundId: 't:h3', status: 'unavailable' });
  });

  it('decisions wait for the selected round\'s evidence to finish loading', () => {
    expect(decisionAllowed(null, 'r')).toBe(false);
    expect(decisionAllowed(loadingView('r'), 'r')).toBe(false);
    expect(decisionAllowed({ roundId: 'r', status: 'ok', ev: evidenceOf('other', 'x'), err: '' }, 'r')).toBe(false);
    expect(decisionAllowed({ roundId: 'r', status: 'ok', ev: evidenceOf('r', 'x'), err: '' }, 'r')).toBe(true);
    // A stored view for another round shows as loading for the selected one.
    expect(viewFor({ roundId: 'a', status: 'ok', ev: evidenceOf('a', 'x'), err: '' }, 'b')).toEqual(loadingView('b'));
  });
});
