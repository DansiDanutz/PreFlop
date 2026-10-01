import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bookJson, buildBook, renderBookMarkdown } from '../src/book.ts';

const read = (name: string) => readFileSync(new URL(`../../../docs/${name}`, import.meta.url), 'utf8');

describe('generated odds book', () => {
  const book = buildBook();
  it('docs/odds-book.md is up to date (run `pnpm book`)', () => {
    expect(read('odds-book.md')).toBe(renderBookMarkdown(book));
  });
  it('docs/odds-book.json is up to date (run `pnpm book`)', () => {
    expect(read('odds-book.json')).toBe(bookJson(book));
  });
  it('shows gross margin and net EV separately', () => {
    const md = renderBookMarkdown(book);
    expect(md).toContain('| Margin | Odds | Gross edge | Net EV |');
  });
});
