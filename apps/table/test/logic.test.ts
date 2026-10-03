import { describe, expect, it } from 'vitest';
import { isValidFlop, sameFlop } from '../src/lib/cards.ts';
import { enrollmentMismatch } from '../src/lib/enrollment.ts';
import { entryDone, pendingEntry } from '../src/lib/hooks.ts';
import { normalizeState } from '../src/lib/state.ts';
import { problemMessage } from '../src/lib/problems.ts';
import type { Round, TableState } from '../src/lib/types.ts';
import { dealerTask } from '../src/screens/Dealer.tsx';

const round = (n: number, state: Round['state'], step: Round['step'] = 'open', extra: Partial<Round> = {}): Round => ({
  id: `t:h${n}`, hand_no: n, state, step, cut_depth: null, locked_at: null, deal_start_at: null, flop: null, review_reasons: null,
  entries: [], has_dealer_entry: false, has_floor_entry: false, my_entry: null, ...extra,
});
const st = (rounds: Round[], entries: TableState['entries'] = []): TableState => normalizeState({
  table: { id: 't', name: 'T', status: 'active', pause_reason: null, kind: 'simulated' }, readiness: { ok: true, problems: [] },
  rounds: rounds.map(({ entries: _e, has_dealer_entry: _d, has_floor_entry: _f, my_entry: _m, ...r }) => r), entries,
}, 'me');

describe('cards', () => {
  it('validates flops', () => {
    expect(isValidFlop(['Kh', 'Td', '7c'])).toBe(true);
    expect(isValidFlop(['Kh', 'Kh', '7c'])).toBe(false);
    expect(isValidFlop(['Kh', '10d', '7c'])).toBe(false);
    expect(isValidFlop(['Kh', 'Td'])).toBe(false);
    expect(sameFlop(['Kh', 'Td', '7c'], ['7c', 'Kh', 'Td'])).toBe(true);
  });
});

describe('dealer task', () => {
  it('OPEN → start', () => expect(dealerTask(st([round(1, 'OPEN')]), {}).kind).toBe('start'));
  it('LOCKED before dealing → procedure', () => expect(dealerTask(st([round(1, 'LOCKED', 'cut_instructed', { cut_depth: 27 })]), {}).kind).toBe('procedure'));
  it('dealing without entry → entry', () => expect(dealerTask(st([round(1, 'LOCKED', 'dealing')]), {}).kind).toBe('entry'));
  it('dealing with own entry → waiting', () => expect(dealerTask(st([round(1, 'LOCKED', 'dealing')], [{ source: 'dealer', person_id: 'd', cards: [] }]), {}).kind).toBe('waiting'));
  it('captured hand N still needs the entry before START on N+1', () => {
    const s = st([round(2, 'OPEN'), round(1, 'DEALT')]);
    expect(dealerTask(s, {})).toMatchObject({ kind: 'entry', round: { hand_no: 1 } });
    expect(dealerTask(s, { 't:h1': ['Kh', 'Td', '7c'] }).kind).toBe('start');
  });
  it('floor pending ignores the dealer entry', () => {
    const s = st([round(1, 'LOCKED', 'dealing')], [{ source: 'dealer', person_id: 'd', cards: ['Kh', 'Td', '7c'] }]);
    expect(pendingEntry(s, 'floor', {})?.hand_no).toBe(1);
    expect(pendingEntry(s, 'dealer', {})).toBeUndefined();
  });
});

describe('problem messages', () => {
  it('maps the server codes', () => {
    expect(problemMessage('duplicate_entry')).toMatch(/different people/);
    expect(problemMessage('platform_resume_required')).toMatch(/integrity hold/);
    expect(problemMessage('platform_review_required')).toMatch(/PreFlop team decides/);
    expect(problemMessage('stale_request')).toMatch(/clock/);
    expect(problemMessage('forbidden_role', 'a person who entered the flop cannot resolve its review')).toMatch(/entered this flop/);
    expect(problemMessage('something_new', 'Readable title')).toBe('Readable title');
  });
});

describe('state parsing (per-round entry fields)', () => {
  const table = { id: 't', name: 'T', status: 'active', pause_reason: null, kind: 'simulated' };
  const readiness = { ok: true, problems: [] };

  it('uses the server per-round fields, including for older rounds', () => {
    const s = normalizeState({
      table, readiness, entries: [],
      rounds: [
        { ...round(2, 'OPEN'), entries: [], has_dealer_entry: false, has_floor_entry: false, my_entry: null },
        { ...round(1, 'DEALT'), entries: [{ source: 'dealer', person_id: 'ana', mine: false, cards: null }], has_dealer_entry: true, has_floor_entry: false, my_entry: null },
      ],
    }, 'bogdan');
    const h1 = s.rounds[1]!;
    expect(h1.has_dealer_entry).toBe(true);
    expect(h1.entries[0]!.cards).toBeNull(); // redacted by the server: floor has not entered yet
    expect(entryDone(s, h1, 'dealer', {})).toBe(true);
    expect(entryDone(s, h1, 'floor', {})).toBe(false);
    expect(pendingEntry(s, 'floor', {})?.hand_no).toBe(1);
    expect(pendingEntry(s, 'dealer', {})).toBeUndefined();
    expect(dealerTask(s, {}).kind).toBe('start');
  });

  it('my_entry marks the hand done for this person', () => {
    const s = normalizeState({
      table, readiness, entries: [],
      rounds: [{ ...round(1, 'LOCKED', 'dealing'), entries: [{ source: 'floor', person_id: 'bogdan', mine: true, cards: ['Kh', 'Td', '7c'] }], has_dealer_entry: false, has_floor_entry: true, my_entry: ['Kh', 'Td', '7c'] }],
    }, 'bogdan');
    expect(s.rounds[0]!.my_entry).toEqual(['Kh', 'Td', '7c']);
    expect(pendingEntry(s, 'floor', {})).toBeUndefined();
    expect(s.entries).toBe(s.rounds[0]!.entries);
  });

  it('older server (top-level entries for rounds[0] only) still works', () => {
    const { entries: _e, has_dealer_entry: _d, has_floor_entry: _f, my_entry: _m, ...legacy } = round(1, 'LOCKED', 'dealing');
    const s = normalizeState({ table, readiness, rounds: [legacy], entries: [{ source: 'dealer', person_id: 'ana', cards: ['Kh', 'Td', '7c'] }] }, 'ana');
    expect(s.rounds[0]!.has_dealer_entry).toBe(true);
    expect(s.rounds[0]!.my_entry).toEqual(['Kh', 'Td', '7c']);
  });
});

describe('enrollment check against whoami', () => {
  const c = { tableId: 'tablet-e2e', role: 'floor' as const, personId: 'Bogdan · F-204' };
  it('accepts a matching staff credential', () => {
    expect(enrollmentMismatch(c, { kind: 'staff', credential_id: 'x', role: 'floor', person_id: 'Bogdan · F-204', table_id: 'tablet-e2e' })).toBeNull();
  });
  it('rejects wrong table, role, person or a device credential', () => {
    expect(enrollmentMismatch(c, { kind: 'staff', credential_id: 'x', role: 'floor', person_id: 'Bogdan · F-204', table_id: 'other' })).toMatch(/table "other"/);
    expect(enrollmentMismatch(c, { kind: 'staff', credential_id: 'x', role: 'dealer', person_id: 'Bogdan · F-204', table_id: 'tablet-e2e' })).toMatch(/role Dealer/);
    expect(enrollmentMismatch(c, { kind: 'staff', credential_id: 'x', role: 'floor', person_id: 'Ana', table_id: 'tablet-e2e' })).toMatch(/belongs to "Ana"/);
    expect(enrollmentMismatch(c, { kind: 'device', credential_id: 'box', table_id: 'tablet-e2e' })).toMatch(/device/);
  });
});
