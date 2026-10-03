import { Markdown, markdownText, parseInline, parseMarkdown, safeHref } from '@preflop/ui/markdown';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

const html = (src: string) => renderToStaticMarkup(<Markdown source={src} />);

describe('news Markdown subset', () => {
  it('renders paragraphs, headings and lists', () => {
    const out = html('Intro line one\nline two.\n\n## How it works\n\n1. Register\n2. Bet\n\n### Notes\n\n- one\n- two\n  continued\n\nEnd.');
    expect(out).toContain('<p>Intro line one line two.</p>');
    expect(out).toMatch(/<h2[^>]*>How it works<\/h2>/);
    expect(out).toMatch(/<ol[^>]*><li>Register<\/li><li>Bet<\/li><\/ol>/);
    expect(out).toMatch(/<h3[^>]*>Notes<\/h3>/);
    expect(out).toMatch(/<ul[^>]*><li>one<\/li><li>two continued<\/li><\/ul>/);
    expect(out).toContain('<p>End.</p>');
  });

  it('a single # becomes h2 (the page owns h1) and deep headings become h3', () => {
    expect(parseMarkdown('# Top').map((b) => b.t)).toEqual(['h2']);
    expect(parseMarkdown('#### Deep').map((b) => b.t)).toEqual(['h3']);
    expect(html('# Top')).not.toContain('<h1');
  });

  it('renders bold, italic, code and nested emphasis', () => {
    const out = html('A **bold *and italic*** word, *just italic*, and `code **not bold**`.');
    expect(out).toContain('<strong class="font-semibold text-ink">bold <em>and italic</em></strong>');
    expect(out).toContain('<em>just italic</em>');
    expect(out).toMatch(/<code[^>]*>code \*\*not bold\*\*<\/code>/);
  });

  it('links only to https, opening safely in a new tab', () => {
    const out = html('See [the rules](https://example.org/rules?a=1&b=2).');
    expect(out).toContain('href="https://example.org/rules?a=1&amp;b=2"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
  });

  it('never renders a script, an event handler or a dangerous link', () => {
    const attack = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(2)>',
      '[click](javascript:alert(3))',
      '[data](data:text/html,<script>alert(4)</script>)',
      '[plain](http://insecure.example)',
      '[relative](/app/profile)',
      '[proto](//evil.example)',
      '[quote](https://ok.example/"onmouseover="alert(5))',
      '**<iframe src="https://evil.example"></iframe>**',
      '## <svg onload=alert(6)>',
    ].join('\n\n');
    const out = html(attack);
    expect(out).not.toMatch(/<script|<img|<iframe|<svg/i);
    // No element carries an event handler (the words only survive as escaped text).
    expect(out).not.toMatch(/<[a-z][^>]*\son\w+=/i);
    expect(out).not.toContain('href="javascript');
    expect(out).not.toContain('href="data');
    expect(out).not.toContain('href="http:');
    expect(out).not.toContain('href="/');
    expect(out).not.toContain('<a ');
    // The text survives, escaped.
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('click');
  });

  it('safeHref accepts only well-formed https URLs', () => {
    expect(safeHref('https://preflop.test/news')).toBe('https://preflop.test/news');
    expect(safeHref(' https://a.test ')).toBe('https://a.test/');
    for (const bad of ['http://a.test', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'https://', 'https://a b.test', 'ftp://a.test', '/x', 'https://a.test/<x>', "https://a.test/'x"]) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });

  it('keeps unmatched markers and escapes as text', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ t: 'text', v: '2 * 3 = 6' }]);
    expect(parseInline('**open')).toEqual([{ t: 'text', v: '**open' }]);
    expect(parseInline('\\*not italic\\*')).toEqual([{ t: 'text', v: '*not italic*' }]);
    expect(parseInline('[no link]')).toEqual([{ t: 'text', v: '[no link]' }]);
  });

  it('survives deeply nested markers without blowing the stack', () => {
    const deep = `${'**'.repeat(200)}x${'**'.repeat(200)}`;
    expect(() => html(deep)).not.toThrow();
    expect(() => html('['.repeat(5000))).not.toThrow();
  });

  it('gives plain text for excerpts', () => {
    expect(markdownText('## Title\n\nSome **bold** and [a link](https://a.test).\n\n- item')).toBe('Title Some bold and a link. item');
  });
});
