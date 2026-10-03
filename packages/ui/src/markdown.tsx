import type { ReactNode } from 'react';

/**
 * A small Markdown subset for news posts, shared by the website and the console preview:
 * paragraphs, `##` and `###` headings, bullet (`-` or `*`) and numbered lists, **bold**, *italic*,
 * `code` and [links](https://…) to https addresses only.
 *
 * It parses into a tiny tree and renders React elements, so the text is always escaped by React.
 * There is no raw HTML and no dangerouslySetInnerHTML: `<script>` in a post shows as text, and a
 * link to anything but https (javascript:, data:, http:, relative paths) renders as plain text.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h2' | 'h3'; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] };

const MAX_DEPTH = 6;

/** An https URL without spaces, quotes or angle brackets, or null. */
export function safeHref(raw: string): string | null {
  const s = raw.trim();
  if (!/^https:\/\/[^\s<>"'`\\]+$/i.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && u.hostname ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The next single `*` at or after `from` that is not part of a `**`. */
function nextSingleStar(s: string, from: number): number {
  for (let j = from; j < s.length; j++) {
    if (s[j] !== '*') continue;
    if (s[j + 1] === '*') { j++; continue; }
    if (s[j - 1] === '*') continue;
    return j;
  }
  return -1;
}

export function parseInline(s: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  if (depth > MAX_DEPTH) return [{ t: 'text', v: s }];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '\\' && i + 1 < s.length && /[\\`*_[\]()#\-.!]/.test(s[i + 1]!)) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        flush();
        out.push({ t: 'code', v: s.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    if (ch === '*' && s[i + 1] === '*') {
      let j = s.indexOf('**', i + 2);
      // In a run like "***", the closing pair is the last two stars ("**a *b***").
      while (j !== -1 && s[j + 2] === '*') j++;
      if (j > i + 2 && s[i + 2] !== ' ') {
        flush();
        out.push({ t: 'strong', c: parseInline(s.slice(i + 2, j), depth + 1) });
        i = j + 2;
        continue;
      }
    }
    if (ch === '*' && s[i + 1] !== '*' && s[i + 1] !== ' ') {
      const j = nextSingleStar(s, i + 1);
      if (j > i + 1) {
        flush();
        out.push({ t: 'em', c: parseInline(s.slice(i + 1, j), depth + 1) });
        i = j + 1;
        continue;
      }
    }
    if (ch === '[') {
      const close = s.indexOf('](', i + 1);
      const end = close > i ? s.indexOf(')', close + 2) : -1;
      if (close > i + 1 && end > close + 2) {
        flush();
        const label = parseInline(s.slice(i + 1, close), depth + 1);
        const href = safeHref(s.slice(close + 2, end));
        if (href) out.push({ t: 'link', href, c: label });
        else out.push(...label);
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const BULLET = /^\s{0,3}[-*]\s+(.*)$/;
const NUMBER = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; items: string[] } | null = null;
  const endPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ')) });
    para = [];
  };
  const endList = () => {
    if (list) blocks.push({ t: list.t, items: list.items.map((x) => parseInline(x)) });
    list = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { endPara(); endList(); continue; }
    const h = HEADING.exec(line);
    if (h) {
      endPara(); endList();
      // A post sits under the page's own h1, so "#" and "##" are h2; anything deeper is h3.
      blocks.push({ t: h[1]!.length <= 2 ? 'h2' : 'h3', c: parseInline(h[2]!) });
      continue;
    }
    const b = BULLET.exec(line);
    const n = b ? null : NUMBER.exec(line);
    if (b || n) {
      const kind = b ? 'ul' : 'ol';
      endPara();
      if (list && list.t !== kind) endList();
      if (!list) list = { t: kind, items: [] };
      list.items.push((b ?? n)![1]!);
      continue;
    }
    if (list && /^\s+\S/.test(raw)) {
      // An indented line continues the last list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    endList();
    para.push(line.trim());
  }
  endPara();
  endList();
  return blocks;
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return n.v;
      case 'code': return <code key={i} className="rounded-[6px] bg-surface-3 px-1.5 py-0.5 font-mono text-[0.9em] text-ink">{n.v}</code>;
      case 'strong': return <strong key={i} className="font-semibold text-ink">{renderInline(n.c)}</strong>;
      case 'em': return <em key={i}>{renderInline(n.c)}</em>;
      case 'link': return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2 hover:text-accent-strong">{renderInline(n.c)}</a>;
    }
  });
}

/** Renders the news Markdown subset. Text only ever reaches the page as React text nodes. */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={['space-y-4 text-[16px] leading-relaxed text-ink/85', className].filter(Boolean).join(' ')}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p': return <p key={i}>{renderInline(b.c)}</p>;
          case 'h2': return <h2 key={i} className="pt-4 font-serif text-2xl leading-snug text-ink">{renderInline(b.c)}</h2>;
          case 'h3': return <h3 key={i} className="pt-2 text-lg font-semibold text-ink">{renderInline(b.c)}</h3>;
          case 'ul': return <ul key={i} className="ml-5 list-disc space-y-1.5 marker:text-accent">{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>;
          case 'ol': return <ol key={i} className="ml-5 list-decimal space-y-1.5 marker:text-accent">{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ol>;
        }
      })}
    </div>
  );
}

/** Plain text of a Markdown source (for excerpts and meta descriptions). */
export function markdownText(src: string): string {
  const text = (nodes: Inline[]): string => nodes.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : text(n.c))).join('');
  return parseMarkdown(src).map((b) => ('items' in b ? b.items.map(text).join(' ') : text(b.c))).join(' ').replace(/\s+/g, ' ').trim();
}
