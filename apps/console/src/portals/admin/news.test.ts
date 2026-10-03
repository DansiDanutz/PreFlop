import { describe, expect, it } from 'vitest';
import { newsFormProblems, parseTags } from './News.tsx';

const form = (p: Partial<{ title: string; summary: string; body: string; tags: string; slug: string }> = {}) =>
  ({ title: 'Tournaments are live', summary: '', body: '', tags: '', slug: '', ...p });

describe('news editor', () => {
  it('turns a comma list into unique lowercase tags', () => {
    expect(parseTags('Tournaments, Free chips, tournaments,  ')).toEqual(['tournaments', 'free-chips']);
    expect(parseTags('')).toEqual([]);
    expect(parseTags('Partner widget!!, <script>')).toEqual(['partner-widget', 'script']);
  });

  it('flags what the API would refuse', () => {
    expect(newsFormProblems(form())).toEqual({});
    expect(newsFormProblems(form({ title: 'ab' })).title).toBeDefined();
    expect(newsFormProblems(form({ summary: 'x'.repeat(301) })).summary).toBeDefined();
    expect(newsFormProblems(form({ body: 'x'.repeat(20_001) })).body).toBeDefined();
    expect(newsFormProblems(form({ tags: 'a,b,c,d,e,f,g,h,i' })).tags).toBe('At most 8 tags.');
    expect(newsFormProblems(form({ slug: 'Not a slug' })).slug).toBeDefined();
    expect(newsFormProblems(form({ slug: 'good-slug-2' }))).toEqual({});
  });
});
