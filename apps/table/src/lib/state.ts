import type { Entry, Round, TableState } from './types.ts';

/**
 * Normalises GET /state. Current servers send per-round `entries`, `has_dealer_entry`,
 * `has_floor_entry` and `my_entry` (other people's cards redacted until this person has entered).
 * An older server sent entries for rounds[0] only; those are mapped onto rounds[0] so the tablet
 * keeps working, and the other rounds get "unknown" (false / null).
 */
export function normalizeState(raw: unknown, personId: string): TableState {
  const s = raw as TableState & { rounds: (Partial<Round> & Pick<Round, 'id'>)[]; entries?: Entry[] };
  const top = Array.isArray(s.entries) ? s.entries : [];
  const rounds: Round[] = (s.rounds ?? []).map((r, i) => {
    const entries: Entry[] = Array.isArray(r.entries) ? r.entries : i === 0 ? top : [];
    const mine = entries.find((e) => e.mine ?? e.person_id === personId);
    return {
      ...(r as Round),
      flop: r.flop ?? null,
      review_reasons: r.review_reasons ?? null,
      entries,
      has_dealer_entry: typeof r.has_dealer_entry === 'boolean' ? r.has_dealer_entry : entries.some((e) => e.source === 'dealer'),
      has_floor_entry: typeof r.has_floor_entry === 'boolean' ? r.has_floor_entry : entries.some((e) => e.source === 'floor'),
      my_entry: r.my_entry !== undefined ? r.my_entry : mine?.cards ?? null,
    };
  });
  return { table: s.table, readiness: s.readiness, rounds, entries: rounds[0]?.entries ?? [] };
}
