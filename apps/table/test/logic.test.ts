import { describe, expect, it } from 'vitest';
import { isValidFlop, sameFlop } from '../src/lib/cards.ts';
import { pendingEntry } from '../src/lib/hooks.ts';
import { problemMessage } from '../src/lib/problems.ts';
import type { Round, TableState } from '../src/lib/types.ts';
import { dealerTask } from '../src/screens/Dealer.tsx';

const round = (n: number, state: Round['state'], step: Round['step'] = 'open', extra: Partial<Round> = {}): Round => ({
  id: `t:h${n}`, hand_no: n, state, step, cut_depth: null, locked_at: null, deal_start_at: null, flop: null, review_reasons: null, ...extra,
});
const st = (rounds: Round[], entries: TableState['entries'] = []): TableState => ({
  table: { id: 't', name: 'T', status: 'active', pause_reason: null, kind: 'simulated' }, readiness: { ok: true, problems: [] }, rounds, entries,
});

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
    expect(problemMessage('stale_request')).toMatch(/clock/);
    expect(problemMessage('forbidden_role', 'a person who entered the flop cannot resolve its review')).toMatch(/entered this flop/);
    expect(problemMessage('something_new', 'Readable title')).toBe('Readable title');
  });
});
