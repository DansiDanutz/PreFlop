import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChoiceHint, ReadingVerdicts } from './decisions.tsx';

/** Decision hints (docs/20) render as advice, and as nothing at all when there is none. */
describe('decision hint components', () => {
  const hint = { model: 'jev-latest', at: '2026-10-04T13:00:00Z', answers: { triage: { type: 'choice' as const, choice: 'pause_table', confidence: 0.82 }, money_at_risk: { type: 'noul' as const, noul: 0.9 } } };

  it('ChoiceHint shows the choice with its confidence, named as advice from the model', () => {
    const html = renderToStaticMarkup(<ChoiceHint hint={hint} question="triage" />);
    expect(html).toContain('pause table');
    expect(html).toContain('82%');
    expect(html).toMatch(/Suggested by jev-latest/);
    expect(html).toMatch(/Advice only/);
  });

  it('ChoiceHint is a dash without a hint or for a question that was not asked', () => {
    expect(renderToStaticMarkup(<ChoiceHint hint={null} question="triage" />)).toContain('—');
    expect(renderToStaticMarkup(<ChoiceHint hint={hint} question="outcome" />)).toContain('—');
    expect(renderToStaticMarkup(<ChoiceHint hint={hint} question="money_at_risk" />)).toContain('—'); // yes/no answers are not choices
  });

  it('ReadingVerdicts marks accepted and doubtful cards, names the ones to check, and renders nothing when the adviser is off', () => {
    const html = renderToStaticMarkup(<ReadingVerdicts check={{ enabled: true, model: 'jev-latest', cards: [{ card: 'Ah', accept: true, confidence: 0.9 }, { card: 'Td', accept: false, confidence: 0.4 }] }} />);
    expect(html).toContain('A♥ ✓');
    expect(html).toContain('10♦ ?');
    expect(html).toMatch(/check 10♦ by eye/);
    expect(renderToStaticMarkup(<ReadingVerdicts check={{ enabled: false, model: null, cards: [] }} />)).toBe('');
    expect(renderToStaticMarkup(<ReadingVerdicts check={null} />)).toBe('');
  });
});
